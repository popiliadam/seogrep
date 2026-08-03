# goal: ledger-integrity
created: 2026-07-18
kaynak: Faz 2 T2 done_when — kredi defteri saf invariantları (işaret kuralları, balance ≥ 0, reserve→commit XOR release, CREDIT_PACKAGES pin testi dahil NEVER #6) korunuyor.

güncelleme 2026-08-03 (audit M-09, operatör seçimi B): `balance ≥ 0` artık YALNIZ core'da değil,
**DB katmanında da** zorlanıyor — migration 0019, `kind='adjust'` + negatif delta için
`pg_advisory_xact_lock(hashtext(user_id))` altında bakiyeyi hesaplayıp sıfırın altına sürükleyen
insert'i reddeder. **Bilinçli kaçış kapısı:** `reason` `override:` önekiyle başlıyorsa geçer —
meşru operatör düzeltmesi (hatayla verilip kısmen harcanmış kredinin geri alınması) zorunlu olarak
negatife iner. Marker ankrajlı ve harf-duyarlıdır; `Override:`, boşluklu ve gömülü biçimler reddedilir.

Bu goal'ün predicate'i core tarafını ölçer; 0019'un DB tarafı `make verify-db` içindedir
(`packages/db/src/ledger-shape.db.test.ts`, 0019 bloğu — reddetme, sınır, override, hot-path,
çok-satırlı batch ve 8-yollu eşzamanlılık vakaları).

**Bilinen sınır (kasıtlı, testle pinli):** koruma yalnız `adjust`'a bakar. Ham bir `spend_reserve`
insert'i hâlâ bakiyeyi negatife sürükleyebilir; `reserve_credits` aynı kilit altında zaten
fazla-satışı reddettiği için hiçbir ürün yolu bunu üretmez, ama DB-yetkili ham yazıcı üretebilir.

## predicate
```predicate
pnpm --filter @pseo/core exec vitest run src/billing
```

## on-violation
Şüpheliler: packages/core/src/billing/* değişiklikleri (ledger.ts durum makinesi, packages.ts rakamları, paddle-events çevirisi), zod sürüm güncellemesi.
Runbook: başarısız testi izole koş → paket-rakamı pin testi kırıldıysa DUR (NEVER #6: rakam değişikliği insan onayı ister — kod geri alınır ya da insan onayı belgelenir) → durum-makinesi kırıldıysa property seed'ini raporla. DB'li derin kontrol `pnpm verify:db` CI'da. Testi zayıflatmak YASAK. Otomatik düzeltme YOK — rapor et.
