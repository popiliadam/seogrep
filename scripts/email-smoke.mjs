// Kullanım: RESEND_API_KEY=... RESEND_FROM_EMAIL=... SMOKE_TO=you@example.com \
//   pnpm email:smoke
// Welcome mailini GERÇEKTEN gönderir (yalnız elle; CI'da koşulmaz — NEVER #5).
// URL tabanı NEXT_PUBLIC_SITE_URL (yoksa canlı site).
import { sendEmail, welcomeEmail } from "@pseo/core";

const { RESEND_API_KEY, RESEND_FROM_EMAIL, SMOKE_TO, NEXT_PUBLIC_SITE_URL } = process.env;
if (!RESEND_API_KEY || !RESEND_FROM_EMAIL || !SMOKE_TO) {
  console.error("Eksik: RESEND_API_KEY + RESEND_FROM_EMAIL + SMOKE_TO");
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
  `KANIT — Resend email id: ${result.id}; "${subject}" -> ${SMOKE_TO}. Resend arayüzünde Emails'ten doğrula.`,
);
