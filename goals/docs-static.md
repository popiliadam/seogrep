# goal: docs-static
created: 2026-07-11
kaynak: Faz 1 İş B done_when — /docs route'ları build'de statik üretiliyor (Fumadocs + generateStaticParams).

## predicate
```predicate
[ -f apps/web/.next/prerender-manifest.json ] || (cd apps/web && pnpm build >/dev/null 2>&1); node -e "const m=require('./apps/web/.next/prerender-manifest.json');process.exit(Object.keys(m.routes).some(r=>r.startsWith('/docs'))?0:1)"
```

## on-violation
Şüpheliler: apps/web/source.config.ts, lib/source.ts, app/docs/[[...slug]]/page.tsx (generateStaticParams), content/docs/ silmeleri, fumadocs sürüm güncellemeleri.
Runbook: `pnpm --filter @pseo/web build` çıktısında /docs satırlarının işaretine bak (● SSG / ○ Static beklenir; ƒ Dynamic ihlaldir) → dinamikleştiren değişikliği bul (cookies/headers/searchParams kullanımı ya da generateStaticParams kaybı). Otomatik düzeltme YOK — rapor et.
