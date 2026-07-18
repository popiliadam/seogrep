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
  const html = [
    "<h1>Welcome to SeoGrep</h1>",
    `<p>Your account is ready — we've added <strong>${trialCredits} free trial credits</strong> to get you started.</p>`,
    "<p>SeoGrep is an MCP server for SEO: connect it to Claude, Cursor, or Windsurf and run crawls, audits, quick-win discovery, and Search Console analysis in plain language.</p>",
    `<p><a href="${dashboardUrl}">Set up your connection</a> to add your personal MCP URL to your AI assistant.</p>`,
    `<p>New here? Read the <a href="${docsUrl}">documentation</a> to see everything SeoGrep can do.</p>`,
    "<p>Happy grepping,<br />The SeoGrep team</p>",
  ].join("\n");
  return { subject, html };
}
