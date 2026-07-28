import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { buildConsentUrl } from "../../../../lib/gsc/oauth";
import {
  codeChallengeS256,
  createCodeVerifier,
  PKCE_COOKIE,
  PKCE_COOKIE_PATH,
  serializePkceCookie,
} from "../../../../lib/gsc/pkce";
import { resolveBaseUrl } from "../../../../lib/site";
import { freshStatePayload, signState, STATE_TTL_SECONDS } from "../../../../lib/gsc/state";

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

function redirect(path: string, base: string): NextResponse {
  return NextResponse.redirect(new URL(path, base));
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("project_id") ?? "";

  // Canonical origin for every SAME-APP redirect below. url.origin is the request Host, which
  // a proxy can let an attacker spoof, so internal 302 Locations must be built from the
  // canonical WEB_BASE_URL (A-I4) — the same origin the OAuth redirect_uri already uses —
  // never from the request.
  //
  // FAIL-CLOSED (T4, the shape L-06 set for the auth callback): an unset / empty / malformed
  // WEB_BASE_URL is a CONFIGURATION ERROR, not a reason to send the error page through
  // url.origin. That last fallback was still Host-derived, so a broken deploy behind a
  // Host-forwarding proxy answered with a 302 to the attacker's origin — precisely when
  // nothing else was working either. There is no redirect target we can trust here, so we
  // emit none: a generic English message to the user, the diagnostics to the log.
  const base = resolveBaseUrl(process.env.WEB_BASE_URL);
  if (!base) {
    console.error(
      "gsc connect refused: WEB_BASE_URL is not a usable absolute http(s) URL — refusing to " +
        "derive a redirect from the request Host",
    );
    return new NextResponse("Search Console is temporarily unavailable. Please try again later.", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Not signed in: send to login. The user re-opens the connect link once authenticated.
    return redirect("/login", base);
  }

  // A non-uuid can own no project — reject before any DB round-trip.
  if (!UUID_RE.test(projectId)) {
    return redirect("/app?gsc=unknown_project", base);
  }

  // Fail closed on missing configuration (signed lesson #5): a broken deploy must not
  // build an `undefined` Google link. These are read the same way the rest of the app
  // reads env (process.env at request time).
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!clientId || !encryptionKey) {
    console.error("gsc connect: GOOGLE_CLIENT_ID / TOKEN_ENCRYPTION_KEY not configured");
    return redirect("/app?gsc=error", base);
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
    return redirect("/app?gsc=error", base);
  }
  if (!project) {
    return redirect("/app?gsc=unknown_project", base);
  }

  // Mint the state AND the per-flow secret together (L-10). Only the S256 DIGEST of the
  // verifier goes to Google; the verifier itself, plus the state's nonce, stay in an httpOnly
  // cookie this origin alone can read. The callback demands that cookie and destroys it, which
  // is what makes an otherwise-stateless state single-use — and PKCE then binds the returned
  // code to this browser, so a code injected into someone else's callback cannot be redeemed.
  const payload = freshStatePayload(user.id, projectId);
  const codeVerifier = createCodeVerifier();
  const consentUrl = buildConsentUrl({
    clientId,
    redirectUri: `${base}/api/gsc/callback`,
    state: signState(payload, encryptionKey),
    codeChallenge: codeChallengeS256(codeVerifier),
  });

  const response = NextResponse.redirect(consentUrl);
  response.cookies.set(PKCE_COOKIE, serializePkceCookie(payload.nonce, codeVerifier), {
    httpOnly: true, // script-invisible: an XSS cannot lift the verifier
    // Tied to the CANONICAL origin's scheme, not to a NODE_ENV guess: if the app is served over
    // https the cookie must never be sent in clear, and on a plain-http local origin a Secure
    // cookie would simply be dropped by some browsers, breaking the flow for no gain.
    secure: base.startsWith("https://"),
    // Lax, not Strict: the return from Google is a cross-site top-level GET, and Strict would
    // withhold the cookie exactly then. Lax still keeps it off cross-site subrequests.
    sameSite: "lax",
    path: PKCE_COOKIE_PATH,
    maxAge: STATE_TTL_SECONDS, // outlives nothing: it dies with the state it is bound to
  });
  return response;
}
