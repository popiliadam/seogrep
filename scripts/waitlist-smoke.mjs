// Kullanım: RESEND_API_KEY=... RESEND_AUDIENCE_ID=... POSTHOG_API_KEY=... \
//   node scripts/waitlist-smoke.mjs test+faz1@ornek-adres.com
import { createPostHogAnalytics, createResendContactStore, joinWaitlist } from "@pseo/core";

const email = process.argv[2];
const { RESEND_API_KEY, RESEND_AUDIENCE_ID, POSTHOG_API_KEY, POSTHOG_HOST } = process.env;
if (!email || !RESEND_API_KEY || !RESEND_AUDIENCE_ID || !POSTHOG_API_KEY) {
  console.error("Eksik: e-posta argümanı + RESEND_API_KEY + RESEND_AUDIENCE_ID + POSTHOG_API_KEY");
  process.exit(1);
}
const result = await joinWaitlist(
  { email, source: "smoke" },
  {
    store: createResendContactStore({ apiKey: RESEND_API_KEY, audienceId: RESEND_AUDIENCE_ID }),
    analytics: createPostHogAnalytics({ apiKey: POSTHOG_API_KEY, host: POSTHOG_HOST }),
  },
);
console.error(`KANIT — Resend contact id: ${result.id} (alreadyExisted=${result.alreadyExisted}); PostHog event: waitlist_signup gönderildi. PostHog arayüzünde Activity'den doğrula.`);
