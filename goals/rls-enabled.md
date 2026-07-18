# goal: rls-enabled
created: 2026-07-18
kaynak: Faz 2 T1 done_when + NEVER #4 — migrations'taki HER public tablo için ENABLE + FORCE ROW LEVEL SECURITY açıkça yazılı kalır (canlı DB'nin auto-RLS trigger'ına yaslanılmaz; CI lokal stack'te o trigger yok).

## predicate
```predicate
bash guardrails/check-rls.sh
```

## on-violation
Şüpheliler: packages/db/supabase/migrations/ altına eklenen YENİ migration'da RLS'siz CREATE TABLE.
Runbook: check-rls.sh çıktısındaki tabloyu bul → aynı migration'a `alter table ... enable row level security; alter table ... force row level security;` ekleTİR (migration henüz apply edilmediyse) ya da YENİ numaralı düzeltme migration'ı aç (apply edildiyse — uygulanmış migration düzenlenmez). Otomatik düzeltme YOK — rapor et.
