import { CREDIT_PACKAGES } from "../billing/packages.js";

export interface WelcomeEmailInput {
  dashboardUrl: string;
  docsUrl: string;
}

export interface WelcomeEmailContent {
  subject: string;
  html: string;
}

/**
 * First-login welcome email content (English copy). Pure + deterministic: no I/O, no
 * env, no clock. The trial credit figure is read from CREDIT_PACKAGES.trial — never
 * hardcoded (CLAUDE.md NEVER #6). Transport (Resend POST) lives in send.ts; the
 * one-time trigger + lock live in apps/web (sendWelcomeIfFirst).
 */
export function welcomeEmail({ dashboardUrl, docsUrl }: WelcomeEmailInput): WelcomeEmailContent {
  const trialCredits = CREDIT_PACKAGES.trial.credits;
  const subject = "Welcome to SeoGrep";
  // Email-safe "manpage" card: tables instead of flex, everything inline, system-font
  // fallbacks (Georgia serif / Courier New mono) since webfonts are unreliable in email.
  const serif = "Georgia, 'Times New Roman', serif";
  const mono = "'Courier New', Courier, monospace";
  const html = [
    `<div style="background:#eae7df;padding:40px 16px;">`,
    `<table role="presentation" width="560" align="center" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;margin:0 auto;">`,
    `<tr><td align="center" style="padding-bottom:24px;"><img src="https://seogrep.com/logo.png" alt="SeoGrep" width="40" height="40" style="display:block;"></td></tr>`,
    `<tr><td style="background:#faf8f3;border:1px solid #e2ddd2;color:#1c1b18;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">`,
    `<tr><td style="padding:16px 36px;border-bottom:1px solid #e2ddd2;font-family:${mono};font-size:11px;color:#a8a294;letter-spacing:0.08em;">SEOGREP</td>`,
    `<td align="right" style="padding:16px 36px;border-bottom:1px solid #e2ddd2;font-family:${mono};font-size:11px;color:#a8a294;letter-spacing:0.08em;">WELCOME(1)</td></tr>`,
    `<tr><td colspan="2" style="padding:40px 36px;">`,
    `<h1 style="margin:0 0 16px;font-family:${serif};font-weight:500;font-size:28px;letter-spacing:-0.01em;">Welcome to SeoGrep</h1>`,
    `<p style="margin:0 0 16px;font-family:${serif};font-size:16px;line-height:1.7;color:#524f48;">Your account is ready — we've added <strong>${trialCredits} free trial credits</strong> to get you started.</p>`,
    `<p style="margin:0 0 28px;font-family:${serif};font-size:16px;line-height:1.7;color:#524f48;">SeoGrep is an MCP server for SEO: connect it to Claude, Cursor, or Windsurf and run crawls, audits, quick-win discovery, and Search Console analysis in plain language.</p>`,
    `<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:0 auto 28px;"><tr><td style="background:#1c1b18;">`,
    `<a href="${dashboardUrl}" style="display:inline-block;font-family:${mono};font-size:14px;font-weight:bold;color:#faf8f3;text-decoration:none;padding:14px 32px;">Set up your connection &rarr;</a>`,
    `</td></tr></table>`,
    `<div style="border-top:1px solid #e2ddd2;padding-top:20px;font-family:${mono};font-size:11.5px;line-height:1.8;color:#a8a294;">`,
    `Button not working? Paste this into your browser:<br>`,
    `<span style="color:#6b6862;">${dashboardUrl}</span><br><br>`,
    `New here? Read the <a href="${docsUrl}" style="color:#6b6862;">documentation</a> to see everything SeoGrep can do.<br><br>`,
    `Happy grepping,<br>The SeoGrep team`,
    `</div>`,
    `</td></tr></table>`,
    `</td></tr>`,
    `<tr><td align="center" style="padding-top:20px;font-family:${mono};font-size:11px;color:#a09a8c;line-height:1.8;">&copy; 2026 SeoGrep &middot; Your site data is never used to train AI models.</td></tr>`,
    `</table>`,
    `</div>`,
  ].join("\n");
  return { subject, html };
}
