# goal: lighthouse-90
created: 2026-07-10
kaynak: Faz 1 İş A done_when — lokal prod build'de /, /pricing, /how-it-works için Lighthouse perf/a11y/SEO ≥ 0.9.

## predicate
```predicate
pnpm run --silent lighthouse
```

## on-violation
Şüpheliler: son UI commit'leri (apps/web/app, apps/web/components), yeni bağımlılık eklemeleri, lighthouserc.json değişiklikleri.
Runbook: lhci çıktısındaki başarısız assertion'ı bul (kategori + denetim adı) → ilgili sayfayı `.lighthouseci/` raporundan incele → düzeltmeyi ayrı commit'le. Eşik GEVŞETİLMEZ. Port 4517 doluysa önce çakışan süreci tespit et (lsof -nP -iTCP:4517). Otomatik düzeltme YOK — rapor et.
