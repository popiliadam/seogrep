# goal: append-only-armor
created: 2026-07-21
kaynak: Faz 3.5 sertleştirme + NEVER #2 — credit_ledger append-only kalır: writer rollerden (özellikle service_role) UPDATE/DELETE/TRUNCATE REVOKE edilir VE reject_mutation satır-tetikleyicisi migration'larda açıkça yazılı durur. Bakiye yalnız ledger toplamından türer; mutasyon = ret. Canlı negatif kanıt (service_role bile UPDATE/DELETE edemez) append-only-armor.db.test.ts'de, verify-db.sh CI'da koşar — bu hedef statik (DB'siz) gate'tir, make goals Supabase stack'i açmaz.

## predicate
```predicate
bash guardrails/check-append-only.sh
```

## on-violation
Şüpheliler: packages/db/supabase/migrations/ altında credit_ledger armor'ını gevşeten YENİ migration — REVOKE satırının kaldırılması/daraltılması, reject_mutation trigger'ının veya fonksiyonunun DROP edilmesi, ya da service_role'e yeniden UPDATE/DELETE GRANT edilmesi.
Runbook: check-append-only.sh çıktısındaki eksik parçayı (function / REVOKE / trigger) bul → migration henüz apply edilmediyse aynı migration'a 0002 armor'ını geri koydur; apply edildiyse uygulanmış migration düzenlenmez, YENİ numaralı düzeltme migration'ı aç. NEVER #2 gereği append-only insan onayı olmadan gevşetilmez. Testi/gate'i zayıflatmak YASAK. Otomatik düzeltme YOK — rapor et.
