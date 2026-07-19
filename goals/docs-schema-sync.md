# goal: docs-schema-sync
created: 2026-07-20
kaynak: Faz 3 T14 done_when + plan D11 — tools-reference docs sayfaları apps/mcp registry BUILD çıktısından (dist) üretilir; el yazımı sürüklenme (kredi maliyeti / input şeması / tool adı-sırası) yapısal olarak imkânsız. Bu kapı üretici `--check` modunu koşar.

## predicate
```predicate
[ -d apps/mcp/dist ] || pnpm --filter @pseo/mcp build >/dev/null 2>&1
node apps/web/scripts/gen-tool-docs.mjs --check
```

## on-violation
Şüpheliler: apps/mcp'de tool ekleme/çıkarma ya da ALL_TOOLS sırası değişimi (index.ts), TOOL_COSTS değişimi (costs.ts), bir tool input şemasına `confirm` alanı sızması (D17), zod şema alan/`.describe()` değişimi, apps/web/content/docs/tools-reference/*.mdx ya da meta.json'un elle düzenlenmesi, parent apps/web/content/docs/meta.json nav'ından tools-reference'ın düşmesi.
Runbook: `--check` çıktısındaki alt-kontrol etiketine bak — (i) MDX yeniden-üret farkı → `node apps/web/scripts/gen-tool-docs.mjs` ile yeniden üret ve commit'le (dist güncel mi: `pnpm --filter @pseo/mcp build`); (ii) `confirm` alanı ilan edilmiş → şemadan çıkar (confirm registry-level bayrak, tools/list'e sızmamalı); (iii) meta.json / parent nav senkron değil → yeniden üret. Kredi rakamı asla elle MDX'e yazılmaz (NEVER #6 — kaynak TOOL_COSTS). Otomatik düzeltme YOK — üreticiyi çalıştır ve farkı gözden geçir.
