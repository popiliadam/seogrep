import { NextResponse } from "next/server";
import { createServiceClient } from "@pseo/db/server";
import { encryptToken, exchangeCodeForTokens, listSites, toByteaHex } from "@pseo/core";
import { createClient } from "../../../../lib/supabase/server";
import { matchGscProperty } from "../../../../lib/gsc/oauth";
import { upsertGscConnection } from "../../../../lib/gsc/store";
import { verifyState } from "../../../../lib/gsc/state";

/**
 * Step 2 of the GSC OAuth link-out — Google redirects the user back here with a one-time
 * `code` and the `state` we signed at connect time. The flow, fail-closed at each step:
 *
 *   1. require full configuration (secrets present) — else a broken deploy stops here;
 *   2. resolve the live session up front, so a broken state can be routed by sign-in
 *      status (a signed-in user returns to /app; an anonymous visitor goes to /login);
 *   3. verify the state signature + expiry, then re-check the LIVE session matches its
 *      user_id (a leaked state alone cannot bind a project to another signed-in user);
 *   4. exchange the code for tokens — the client_secret is server-side inside the client
 *      module and is NEVER logged or returned;
 *   5. SEAL the refresh token (AES-256-GCM) before it touches the DB — plaintext never
 *      reaches storage or a log;
 *   6. list the account's properties and match the project domain to one;
 *   7. upsert the connection and redirect to /app with a status.
 *
 * No redirect target is ever read from the request. Node runtime: crypto + token exchange.
 */
export const runtime = "nodejs";

function redirect(path: string, origin: string): NextResponse {
  return NextResponse.redirect(new URL(path, origin));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state") ?? "";
  const googleError = url.searchParams.get("error");

  // (1) Canonical origin for every SAME-APP redirect below. origin (the request Host) is
  // proxy-spoofable, so internal 302 Locations are built from the canonical WEB_BASE_URL
  // (A-I4), never the request. WEB_BASE_URL missing = broken deploy: fail closed (signed
  // lesson #5); origin is the fallback for that ONE error page, where no canonical base exists.
  const webBaseUrl = process.env.WEB_BASE_URL;
  if (!webBaseUrl) {
    console.error("gsc callback: WEB_BASE_URL not configured");
    return redirect("/app?gsc=error", origin);
  }
  const base = webBaseUrl.replace(/\/+$/, "");

  // The remaining OAuth/encryption secrets must be present too; a missing one fails loudly,
  // not degrade (signed lesson #5). GOOGLE_CLIENT_SECRET is only presence-checked here — it is
  // used inside the client module, never handled or logged by this route.
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!clientId || !clientSecret || !encryptionKey) {
    console.error("gsc callback: Google OAuth / encryption env is not fully configured");
    return redirect("/app?gsc=error", base);
  }

  // (2) Resolve the live session up front so a broken state can be routed by sign-in
  // status: an already-signed-in user should return to their dashboard (they can retry
  // connect), not be bounced to the login page.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // (3) Trust the state only if it verifies (signature + expiry). A forged/expired state
  // sends a signed-in user to /app with an error, and an anonymous visitor to /login.
  const state = verifyState(stateParam, encryptionKey);
  if (!state) {
    return user ? redirect("/app?gsc=error", base) : redirect("/login?error=gsc", base);
  }

  // (4) The state is valid — the live session must match its user_id (a leaked state alone
  // cannot bind a project to another signed-in user). A missing/different session -> /login.
  if (!user || user.id !== state.user_id) {
    return redirect("/login?error=gsc", base);
  }

  // The user declined consent (or Google reported an error) — nothing to store.
  if (googleError) {
    return redirect("/app?gsc=denied", base);
  }
  if (!code) {
    return redirect("/app?gsc=error", base);
  }

  try {
    // Re-confirm the project still exists and is owned (explicit tenant filter, NEVER #4).
    const service = createServiceClient();
    const { data: project, error } = await service
      .from("projects")
      .select("domain")
      .eq("user_id", state.user_id)
      .eq("id", state.project_id)
      .maybeSingle();
    if (error) {
      throw new Error(`project lookup failed: ${error.message}`);
    }
    if (!project) {
      return redirect("/app?gsc=unknown_project", base);
    }
    const domain = (project as { domain: string }).domain;

    // (4) Exchange the code. redirect_uri MUST match the one used at connect time.
    const tokens = await exchangeCodeForTokens({
      code,
      redirectUri: `${base}/api/gsc/callback`,
    });

    // (5) Seal the refresh token at rest. Absent on re-consent -> null (keep any stored one).
    const encryptedTokenHex = tokens.refreshToken
      ? toByteaHex(encryptToken(tokens.refreshToken, encryptionKey))
      : null;

    // (6) Match the project domain to a verified property. A listing failure is non-fatal:
    // the connection (token) still stands; the property is simply left unmatched.
    let gscProperty: string | null = null;
    try {
      gscProperty = matchGscProperty(domain, await listSites(tokens.accessToken));
    } catch (listError) {
      console.error("gsc callback: sites.list failed (property left unmatched):", errorMessage(listError));
    }

    // (7) Persist and route to the dashboard with a status the /app page renders.
    const outcome = await upsertGscConnection(service, {
      userId: state.user_id,
      projectId: state.project_id,
      encryptedTokenHex,
      gscProperty,
    });
    if (outcome === "no_token") {
      return redirect("/app?gsc=no_token", base);
    }
    return redirect(`/app?gsc=connected&property=${gscProperty ? "matched" : "none"}`, base);
  } catch (caught) {
    // Never log the code, tokens, or secret — only a short message.
    console.error("gsc callback: connection failed:", errorMessage(caught));
    return redirect("/app?gsc=error", base);
  }
}
