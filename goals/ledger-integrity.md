# goal: ledger-integrity
created: 2026-07-18
kaynak: Faz 2 T2 done_when — kredi defteri saf invariantları (işaret kuralları, balance ≥ 0, reserve→commit XOR release, CREDIT_PACKAGES pin testi dahil NEVER #6) korunuyor.

## predicate
```predicate
pnpm --filter @pseo/core exec vitest run src/billing
```

## on-violation
Şüpheliler: packages/core/src/billing/* değişiklikleri (ledger.ts durum makinesi, packages.ts rakamları, paddle-events çevirisi), zod sürüm güncellemesi.
Runbook: başarısız testi izole koş → paket-rakamı pin testi kırıldıysa DUR (NEVER #6: rakam değişikliği insan onayı ister — kod geri alınır ya da insan onayı belgelenir) → durum-makinesi kırıldıysa property seed'ini raporla. DB'li derin kontrol `pnpm verify:db` CI'da. Testi zayıflatmak YASAK. Otomatik düzeltme YOK — rapor et.
