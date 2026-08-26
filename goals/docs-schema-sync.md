# goal: docs-schema-sync
created: 2026-07-20
kaynak: Faz 3 T14 done_when + plan D11 — tools-reference docs sayfaları apps/mcp registry BUILD çıktısından (dist) üretilir.
**ŞERH (2026-08-26, hakem ÖLÇTÜ):** "el yazımı sürüklenme yapısal olarak imkânsız" cümlesi YANLIŞTI. `--check`
yalnız ÜRETİLEBİLİR alanları (şema, tool adı-sırası, türetilmiş `**Cost:**` satırı) karşılaştırır; sayfanın
ELLE YAZILAN prose'una (`DOC_PROSE`) konan bir fiyat cümlesi ondan geçer. Ölçüm: `audit_tech` sayfasında
`**Cost:** 15 credits.` ile `costs 5 credits.` iki satır arayla dururken `--check` **exit 0** verdi.
Bu yüzden predicate artık fiyat-iddiası şeridini de koşuyor.

## predicate
```predicate
pnpm --filter @pseo/mcp build >/dev/null 2>&1
node apps/web/scripts/gen-tool-docs.mjs --check
pnpm --filter @pseo/web exec vitest run lib/tool-docs-price-claims.test.ts
```

## on-violation
Şüpheliler: apps/mcp'de tool ekleme/çıkarma ya da ALL_TOOLS sırası değişimi (index.ts), TOOL_COSTS değişimi (costs.ts), bir tool input şemasına `confirm` alanı sızması (D17), zod şema alan/`.describe()` değişimi, apps/web/content/docs/tools-reference/*.mdx ya da meta.json'un elle düzenlenmesi, parent apps/web/content/docs/meta.json nav'ından tools-reference'ın düşmesi.
Runbook: `--check` çıktısındaki alt-kontrol etiketine bak — (i) MDX yeniden-üret farkı → `node apps/web/scripts/gen-tool-docs.mjs` ile yeniden üret ve commit'le (dist güncel mi: `pnpm --filter @pseo/mcp build`); (ii) `confirm` alanı ilan edilmiş → şemadan çıkar (confirm registry-level bayrak, tools/list'e sızmamalı); (iii) meta.json / parent nav senkron değil → yeniden üret. Kredi rakamı asla elle MDX'e yazılmaz (NEVER #6 — kaynak TOOL_COSTS). Otomatik düzeltme YOK — üreticiyi çalıştır ve farkı gözden geçir.
(iv) fiyat-iddiası şeridi kırmızı → bir metin bir tool'a YANLIŞ kredi rakamı ya da yanlış "free" atfediyor;
kaynak `TOOL_COSTS`'tur, metni ona uydur. Rakamın KENDİSİNİ değiştirmek NEVER#6 imzası ister.
