import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { grantTrialCredits } from "../../../lib/billing/trial";
import { createClient } from "../../../lib/supabase/server";

export const runtime = "nodejs";

const EMAIL_OTP_TYPES: readonly EmailOtpType[] = [
  "signup",
  "email",
  "magiclink",
  "recovery",
  "invite",
  "email_change",
];

function isEmailOtpType(value: string | null): value is EmailOtpType {
  return value !== null && (EMAIL_OTP_TYPES as readonly string[]).includes(value);
}

/**
 * Auth callback for both flows:
 *   - `?code=...`           -> exchangeCodeForSession (OAuth / PKCE, e.g. future Google).
 *   - `?token_hash=&type=`  -> verifyOtp (email signup confirmation + magic link).
 * On success it establishes the session cookie, fires the one-time trial grant, then
 * redirects into /app. `next` is constrained to a relative path (no open redirect).
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const nextParam = url.searchParams.get("next");
  const next = nextParam && nextParam.startsWith("/") ? nextParam : "/app";

  const supabase = await createClient();
  let userId: string | null = null;

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      userId = data.user?.id ?? null;
    }
  } else if (tokenHash && isEmailOtpType(type)) {
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      userId = data.user?.id ?? null;
    }
  }

  if (!userId) {
    return NextResponse.redirect(new URL("/login?error=auth", url.origin));
  }

  await grantTrialCredits(userId);
  return NextResponse.redirect(new URL(next, url.origin));
}
