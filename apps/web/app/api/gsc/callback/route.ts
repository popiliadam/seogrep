import { NextResponse } from "next/server";
import { createServiceClient } from "@pseo/db/server";
import { exchangeCodeForTokens, listSites } from "@pseo/mcp/src/gsc/client";
import { encryptToken, toByteaHex } from "@pseo/mcp/src/gsc/crypto";
import { createClient } from "../../../../lib/supabase/server";
import { matchGscProperty } from "../../../../lib/gsc/oauth";
import { upsertGscConnection } from "../../../../lib/gsc/store";
import { verifyState } from "../../../../lib/gsc/state";

/**
 * Step 2 of the GSC OAuth link-out — Google redirects the user back here with a one-time
 * `code` and the `state` we signed at connect time. The flow, fail-closed at each step:
 *
 *   1. require full configuration (secrets present) — else a broken deploy stops here;
 *   2. verify the state signature + expiry, then re-check the LIVE session matches its
 *      user_id (a leaked state alone cannot bind a project to another signed-in user);
 *   3. exchange the code for tokens — the client_secret is server-side inside the client
 *      module and is NEVER logged or returned;
 *   4. SEAL the refresh token (AES-256-GCM) before it touches the DB — plaintext never
 *      reaches storage or a log;
 *   5. list the account's properties and match the project domain to one;
 *   6. upsert the connection and redirect to /app with a status.
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

  // (1) Configuration must be complete; a missing secret must fail loudly, not degrade
  // (signed lesson #5). GOOGLE_CLIENT_SECRET is only presence-checked here — it is used
  // inside the client module, never handled or logged by this route.
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
  const webBaseUrl = process.env.WEB_BASE_URL;
  if (!clientId || !clientSecret || !encryptionKey || !webBaseUrl) {
    console.error("gsc callback: Google OAuth / encryption env is not fully configured");
    return redirect("/app?gsc=error", origin);
  }

  // (2) Trust the state only if it verifies AND matches the live session.
  const state = verifyState(stateParam, encryptionKey);
  if (!state) {
    return redirect("/login?error=gsc", origin);
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== state.user_id) {
    return redirect("/login?error=gsc", origin);
  }

  // The user declined consent (or Google reported an error) — nothing to store.
  if (googleError) {
    return redirect("/app?gsc=denied", origin);
  }
  if (!code) {
    return redirect("/app?gsc=error", origin);
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
      return redirect("/app?gsc=unknown_project", origin);
    }
    const domain = (project as { domain: string }).domain;

    // (3) Exchange the code. redirect_uri MUST match the one used at connect time.
    const tokens = await exchangeCodeForTokens({
      code,
      redirectUri: `${webBaseUrl.replace(/\/+$/, "")}/api/gsc/callback`,
    });

    // (4) Seal the refresh token at rest. Absent on re-consent -> null (keep any stored one).
    const encryptedTokenHex = tokens.refreshToken
      ? toByteaHex(encryptToken(tokens.refreshToken, encryptionKey))
      : null;

    // (5) Match the project domain to a verified property. A listing failure is non-fatal:
    // the connection (token) still stands; the property is simply left unmatched.
    let gscProperty: string | null = null;
    try {
      gscProperty = matchGscProperty(domain, await listSites(tokens.accessToken));
    } catch (listError) {
      console.error("gsc callback: sites.list failed (property left unmatched):", errorMessage(listError));
    }

    // (6) Persist and route to the dashboard with a status the /app page renders.
    const outcome = await upsertGscConnection(service, {
      userId: state.user_id,
      projectId: state.project_id,
      encryptedTokenHex,
      gscProperty,
    });
    if (outcome === "no_token") {
      return redirect("/app?gsc=no_token", origin);
    }
    return redirect(`/app?gsc=connected&property=${gscProperty ? "matched" : "none"}`, origin);
  } catch (caught) {
    // Never log the code, tokens, or secret — only a short message.
    console.error("gsc callback: connection failed:", errorMessage(caught));
    return redirect("/app?gsc=error", origin);
  }
}
