import { NextResponse } from "next/server";
import { createServiceClient } from "@pseo/db/server";
import { exchangeCodeForTokens, listSites } from "@pseo/core";
import { createClient } from "../../../../lib/supabase/server";
import { upsertGscAccount } from "../../../../lib/gsc/accounts";
import { parseIdTokenClaims } from "../../../../lib/gsc/oauth";
import {
  matchesNonce,
  parsePkceCookie,
  PKCE_COOKIE,
  PKCE_COOKIE_PATH,
  readCookie,
} from "../../../../lib/gsc/pkce";
import { resolveBaseUrl } from "../../../../lib/site";
import { verifyState } from "../../../../lib/gsc/state";

/**
 * Step 2 of the GSC OAuth link-out — Google redirects the user back here with a one-time
 * `code` and the `state` we signed at connect time. The flow, fail-closed at each step:
 *
 *   1. require full configuration (secrets present) — else a broken deploy stops here;
 *   2. resolve the live session up front, so a broken state can be routed by sign-in
 *      status (a signed-in user returns to /app; an anonymous visitor goes to /login);
 *   3. verify the state signature + expiry, then re-check the LIVE session matches its
 *      user_id (a leaked state alone cannot bind an account to another signed-in user);
 *   4. require the ONE-TIME flow cookie issued beside that state, which makes a stateless
 *      state single-use and carries the PKCE verifier (a replay arrives without it);
 *   5. exchange the code for tokens, sending that verifier — the client_secret is server-side
 *      inside the client module and is NEVER logged or returned;
 *   6. read WHICH Google account consented from the response's `id_token`;
 *   7. prove the grant actually works by calling `sites.list` with it — a token that cannot
 *      be used is never stored;
 *   8. upsert the `gsc_accounts` row (which seals the refresh token to that row) and send
 *      the user to the connection page with the account id.
 *
 * WHAT THIS NO LONGER DOES (migration 0021). It used to look the project up, match its
 * domain against the account's properties, and write `gsc_connections`. The credential is
 * now per-ACCOUNT and this route knows of no project: property mapping returns as a PICKER
 * the user drives after landing on the connection page, fed by `resolveGscProperty` — which
 * is why that function still exists and is simply no longer called from here. Between this
 * change and the picker, a consent creates an account row and no connection row; that gap
 * is intended, not an omission to patch with a guess at which project was meant.
 *
 * No redirect target is ever read from the request. Node runtime: crypto + token exchange.
 */
export const runtime = "nodejs";

/**
 * Consume the one-time flow cookie. EVERY exit from this handler passes through here — success,
 * refusal, or broken deploy — because the flow that issued the cookie is over either way, and a
 * cookie that survives one exit path is a cookie a replay can still present. Clearing it is what
 * turns the stateless state into a single-use one.
 *
 * Not gated on the cookie having verified: a hostile request to this route can therefore wipe an
 * in-flight cookie, but whoever can make a browser hit the callback can equally make it hit
 * connect and start over, so the only cost is a restart.
 */
function endFlow(response: NextResponse): NextResponse {
  response.cookies.set(PKCE_COOKIE, "", { httpOnly: true, sameSite: "lax", path: PKCE_COOKIE_PATH, maxAge: 0 });
  return response;
}

function redirect(path: string, base: string): NextResponse {
  return endFlow(NextResponse.redirect(new URL(path, base)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state") ?? "";
  const googleError = url.searchParams.get("error");

  // (1) Canonical origin for every SAME-APP redirect below. The request Host is
  // proxy-spoofable, so internal 302 Locations are built from the canonical WEB_BASE_URL
  // (A-I4), never the request.
  //
  // FAIL-CLOSED (T4, the shape L-06 set for the auth callback): an unset / empty / malformed
  // WEB_BASE_URL is a CONFIGURATION ERROR. The old url.origin fallback on this one error page
  // was still the request Host, so a broken deploy behind a Host-forwarding proxy handed the
  // user returning from Google a 302 to the attacker's origin. We emit no redirect target at
  // all. The check runs BEFORE the exchange, so the one-time code is not burned: the user can
  // reconnect once the deploy is fixed.
  const base = resolveBaseUrl(process.env.WEB_BASE_URL);
  if (!base) {
    console.error(
      "gsc callback refused: WEB_BASE_URL is not a usable absolute http(s) URL — refusing to " +
        "derive a redirect from the request Host",
    );
    return endFlow(
      new NextResponse("Search Console is temporarily unavailable. Please try again later.", {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
    );
  }

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
  // cannot bind a Google account to another signed-in user). A missing/different session
  // -> /login.
  if (!user || user.id !== state.user_id) {
    return redirect("/login?error=gsc", base);
  }

  // The user declined consent (or Google reported an error) — nothing to store.
  if (googleError) {
    return redirect("/app?gsc=denied", base);
  }

  // (4) ONE-TIME + PKCE (L-10). The state's signature proves who asked; it cannot prove this is
  // the FIRST time it has been presented, because there is no record of it anywhere. The cookie
  // minted beside it is that record, held by the browser and destroyed by endFlow above — so a
  // state captured from a Referer, a proxy log, or a shared screen arrives the second time with
  // no cookie and stops here. The nonce match is what ties this cookie to THIS state rather than
  // to any other flow the same browser may have open, and the verifier it carries is what Google
  // will weigh against the challenge issued at connect time.
  const pkce = parsePkceCookie(readCookie(request.headers.get("cookie"), PKCE_COOKIE));
  if (!pkce || !matchesNonce(pkce.nonce, state.nonce)) {
    // Never log the state or the verifier — just the fact and the shape of the failure.
    console.error("gsc callback: state arrived without its one-time flow cookie (replay, or an expired flow)");
    return redirect("/app?gsc=error", base);
  }

  if (!code) {
    return redirect("/app?gsc=error", base);
  }

  try {
    // (5) Exchange the code. redirect_uri MUST match the one used at connect time, and the
    // PKCE verifier from the cookie must match the challenge sent at connect time — without it
    // Google refuses the code, which is exactly what stops an injected code being redeemed here.
    // The verifier is a plain parameter of the client: it used to be spliced into the request
    // body through the injectable `fetch`, which quietly made that body's wire format a
    // contract between packages — one an ordinary refactor inside the client could have broken
    // here and nowhere else, visible only in production.
    const tokens = await exchangeCodeForTokens({
      code,
      redirectUri: `${base}/api/gsc/callback`,
      codeVerifier: pkce.verifier,
    });

    // (6) WHOSE account is this? The `id_token` Google returned beside the tokens carries
    // the `sub` that `gsc_accounts` is keyed on. Without it the credential cannot be
    // attributed, and storing an unattributable refresh token is worse than storing none:
    // the next consent would be indistinguishable from this one. Refuse instead.
    const claims = tokens.idToken ? parseIdTokenClaims(tokens.idToken) : null;
    if (!claims) {
      console.error("gsc callback: the token response carried no usable id_token identity claims");
      return redirect("/app/connection?error=identity", base);
    }

    // Google issues a refresh token on every consent because connect asks for
    // `access_type=offline` + `prompt=consent`. If one is absent anyway there is nothing to
    // persist — `gsc_accounts.encrypted_refresh_token` is NOT NULL and an access token dies
    // in an hour — so we refuse rather than write a row that would claim a connection this
    // account cannot honour an hour from now.
    if (!tokens.refreshToken) {
      console.error("gsc callback: Google returned no refresh token — nothing to store");
      return redirect("/app/connection?error=no_token", base);
    }

    // (7) THIS CALL IS THE VERIFICATION, and it runs BEFORE the write on purpose. A grant
    // that cannot read `sites.list` is a grant nothing in the product can use, and the
    // previous shape — store first, treat a listing failure as cosmetic — is exactly how two
    // live projects ended up reported as connected while every later call 403'd (2026-08-09,
    // bayder.com.tr and rkturizm.com). A user who sees "connect failed" reconnects; a user
    // who sees "connected" over a dead grant has nothing to act on. So: no usable listing,
    // no stored token.
    //
    // The RESULT of the listing is deliberately discarded here. Mapping properties to
    // projects is the picker's job (Task 6, fed by `resolveGscProperty`); this route only
    // needs to know the call succeeded.
    try {
      await listSites(tokens.accessToken);
    } catch (listError) {
      console.error("gsc callback: sites.list failed — token NOT stored:", errorMessage(listError));
      return redirect("/app/connection?error=verify", base);
    }

    // (8) Persist. `upsertGscAccount` seals the refresh token to the row it is about to
    // occupy (crypto v4 AAD = user_id + account_id), so the plaintext never reaches the DB
    // and a blob lifted into another row stops opening. The service client bypasses RLS, so
    // the `user_id` it writes/filters on — taken from the SIGNED state, re-checked against
    // the live session above — is the tenant guard (NEVER #4).
    const { accountId } = await upsertGscAccount(createServiceClient(), {
      userId: state.user_id,
      sub: claims.sub,
      email: claims.email,
      refreshToken: tokens.refreshToken,
      keyHex: encryptionKey,
    });
    return redirect(`/app/connection?connected=${accountId}`, base);
  } catch (caught) {
    // Never log the code, tokens, or secret — only a short message.
    console.error("gsc callback: connection failed:", errorMessage(caught));
    return redirect("/app?gsc=error", base);
  }
}
