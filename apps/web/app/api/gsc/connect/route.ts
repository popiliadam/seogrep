import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { buildConsentUrl } from "../../../../lib/gsc/oauth";
import { freshStatePayload, signState } from "../../../../lib/gsc/state";

/**
 * Step 1 of the GSC OAuth link-out. A signed-in user arrives here (via the connect_gsc
 * tool's link) for one of THEIR projects; we mint a signed, expiring `state` binding
 * {user_id, project_id} and redirect to Google's consent screen. No token or secret is
 * involved yet — only the public client_id, the callback redirect, and the state.
 *
 * Ownership is enforced two ways: the project is read with the CALLER's own RLS-scoped
 * client (another tenant's / a missing project simply returns no row), and the state the
 * callback later trusts is signed here only after that check passes. No redirect target is
 * ever read from the request. Node runtime: state signing uses node:crypto.
 */
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function redirect(path: string, origin: string): NextResponse {
  return NextResponse.redirect(new URL(path, origin));
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("project_id") ?? "";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Not signed in: send to login. The user re-opens the connect link once authenticated.
    return redirect("/login", url.origin);
  }

  // A non-uuid can own no project — reject before any DB round-trip.
  if (!UUID_RE.test(projectId)) {
    return redirect("/app?gsc=unknown_project", url.origin);
  }

  // Fail closed on missing configuration (signed lesson #5): a broken deploy must not
  // build an `undefined` Google link. These are read the same way the rest of the app
  // reads env (process.env at request time).
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
  const webBaseUrl = process.env.WEB_BASE_URL;
  if (!clientId || !encryptionKey || !webBaseUrl) {
    console.error("gsc connect: GOOGLE_CLIENT_ID / TOKEN_ENCRYPTION_KEY / WEB_BASE_URL not configured");
    return redirect("/app?gsc=error", url.origin);
  }

  // Ownership gate via the caller's RLS-scoped client: another tenant's project (or a
  // missing one) returns no row and is indistinguishable.
  const { data: project, error } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (error) {
    console.error("gsc connect: project lookup failed:", error.message);
    return redirect("/app?gsc=error", url.origin);
  }
  if (!project) {
    return redirect("/app?gsc=unknown_project", url.origin);
  }

  const state = signState(freshStatePayload(user.id, projectId), encryptionKey);
  const consentUrl = buildConsentUrl({
    clientId,
    redirectUri: `${webBaseUrl.replace(/\/+$/, "")}/api/gsc/callback`,
    state,
  });
  return NextResponse.redirect(consentUrl);
}
