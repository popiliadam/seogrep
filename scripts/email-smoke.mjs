// Usage: RESEND_API_KEY=... RESEND_FROM_EMAIL=... SMOKE_TO=you@example.com \
//   pnpm email:smoke
// REALLY sends the welcome email (manual only; never runs in CI — NEVER #5).
// URL base comes from NEXT_PUBLIC_SITE_URL (falls back to the live site).
import { sendEmail, welcomeEmail } from "@pseo/core";

const { RESEND_API_KEY, RESEND_FROM_EMAIL, SMOKE_TO, NEXT_PUBLIC_SITE_URL } = process.env;
if (!RESEND_API_KEY || !RESEND_FROM_EMAIL || !SMOKE_TO) {
  console.error("Missing: RESEND_API_KEY + RESEND_FROM_EMAIL + SMOKE_TO");
  process.exit(1);
}

const base = NEXT_PUBLIC_SITE_URL ?? "https://seogrep.com";
const { subject, html } = welcomeEmail({
  dashboardUrl: `${base}/app/connection`,
  docsUrl: `${base}/docs`,
});
const result = await sendEmail({
  apiKey: RESEND_API_KEY,
  from: RESEND_FROM_EMAIL,
  to: SMOKE_TO,
  subject,
  html,
});
console.error(
  `PROOF — Resend email id: ${result.id ?? "(accepted, no id in response)"}; "${subject}" -> ${SMOKE_TO}. Verify it under Emails in the Resend dashboard.`,
);
