# goal: waitlist-works
created: 2026-07-10
kaynak: Faz 1 İş C done_when — waitlist çekirdeği (joinWaitlist + Resend/PostHog adapter'ları) davranışını koruyor.

## predicate
```predicate
pnpm --filter @pseo/core exec vitest run src/waitlist
```

## on-violation
Şüpheliler: packages/core/src/waitlist/* değişiklikleri, zod sürüm güncellemesi, apps/web/app/api/waitlist route değişiklikleri.
Runbook: başarısız testi tek başına çalıştır (`pnpm --filter @pseo/core exec vitest run src/waitlist -t "<test adı>"`) → şema mı adapter mı ayırt et → düzeltmeyi ayrı commit'le. Testi zayıflatmak YASAK. Otomatik düzeltme YOK — rapor et.
