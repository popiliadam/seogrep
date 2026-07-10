# contract.md — Sınırlar

## Otonom yapar (QA döngüsü + hakem + kapı korumasıyla)
- TÜM kod: auth, migrations, webhooks dahil.
- Branch'te UI/docs/marketing taslağı, test, mock/fixture, refactor.
- Yeni bağımlılık — hakem onayı + lisans kontrolü (MIT/Apache-2/ISC/BSD) şartıyla.

## İnsana kuyruğa atar (işi hazırlar, onay bekler)
- Prod'a İLK deploy · DNS/domain işlemleri · Paddle live mode'a geçiş.
- Fiyat/kredi/paket rakamı değişikliği · gerçek para harcaması (yeni servis/abonelik).
- Marka kararı · beta davetleri · launch yayınları (PH/HN/X).

## İnsanı uyandırır (işi DURDURUR, rapor eder)
- Aynı işte 2× FAIL (qa-loop eskalasyonu sonrası).
- Ledger invariant ihlali (balance != SUM(ledger)).
- Secret talebi / secret sızıntısı şüphesi.
- `~/Documents/platinum-seo-engine`e yazma ihtiyacı.
- Prod'da 5xx · günlük DFS bütçe limiti (≤$3) aşımı.
