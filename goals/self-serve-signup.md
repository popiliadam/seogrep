# goal: self-serve-signup
created: 2026-08-05
kaynak: Operatör kararı 2026-08-05 — waitlist KALDIRILDI, kayıt açık self-servis. Bu hedef,
`goals/waitlist-works.md`'nin yerine geçer: o hedef artık var olmayan bir özelliği ölçüyordu
(ürün kararıyla silindi, testi geçirmek için değil — CLAUDE.md "testi değiştirme" yasağı
kaldırılan bir ÖZELLİĞİN hedefini emekliye ayırmayı kapsamaz).

Koruduğu davranış üç parça: (1) her CTA `/signup`'a gider ve ölü `#waitlist` çıpası geri gelmez,
(2) parola sıfırlama akışı — PKCE `redirectType` dahil — kullanıcıyı `/reset-password`'e taşır,
(3) Turnstile provision edilmemişken auth formları bayt-özdeş istek gönderir ve submit butonu
kilitlenmez.

## predicate
```predicate
pnpm --filter @pseo/web exec vitest run app/\(marketing\)/page.test.tsx components/site-header.test.tsx components/pricing-table.test.tsx app/auth/callback/route.test.ts app/\(auth\)/auth-form.test.tsx app/\(auth\)/forgot-password app/\(auth\)/reset-password components/turnstile.test.tsx
```

## on-violation
Şüpheliler: bir CTA'nın `/signup` dışına yönlendirilmesi · `#waitlist` çıpasının geri gelmesi ·
`auth/callback/route.ts`'te recovery sinyalinin değişmesi (PKCE `redirectType` ya da token_hash
`type`) · `auth-form.tsx`/`forgot-password-form.tsx`'te captcha `options` bag'ine koşulsuz alan
sızması · submit butonunun captcha yokken kilitlenmesi.

Runbook: kırmızı test adına bak. (i) CTA/anchor → `page.test.tsx` veya `pricing-table.test.tsx`;
href'i düzelt, testi zayıflatma. (ii) recovery yönlendirmesi → `route.test.ts`; **`?type=` tek
başına yeterli sinyal DEĞİLDİR** (@supabase/ssr `flowType: "pkce"` hardcode eder, gerçek reset
linki `?code=` döner) — kod dalında `data.redirectType`, token_hash dalında doğrulanmış `type`
kullanılır. (iii) captcha → `auth-form.test.tsx` "with Turnstile unprovisioned"; kapalıyken
`options` bag'i tam olarak `["emailRedirectTo"]` olmalı ve buton enabled kalmalı. Otomatik
düzeltme YOK — rapor et.
