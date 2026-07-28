# goal: dfs-budget-guard
created: 2026-07-19
kaynak: Faz 3 T11 done_when + NEVER #5 — DataForSEO canlı harcaması <= $3/gün. Sayaç 2026-07-28'de (hostile audit H-03) dosyadan VERİTABANINA taşındı: `public.dfs_spend` + `reserve_dfs_spend`/`settle_dfs_spend` (migration 0014). Kapı, işaret edilen Supabase projesindeki `dfs_spend_today_usd()` toplamını eşiğe karşı korur.

## kapı NE ölçer, NE ölçmez
- ÖLÇER: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` env'i verildiğinde, O PROJEDEKİ bugünün (UTC) toplamı — açık rezervasyonlar tahminiyle, kapanmışlar gerçek maliyetiyle. Çıktı ölçtüğü host'u AÇIKÇA yazar (imzalı ders 7).
- ÖLÇMEZ: env yoksa hiçbir şey. Bu durumda sessiz "OK" değil, **SKIP (exit 97)** raporlar — `make goals` bunu "PASS (SKIP)" olarak, yani TAM ÖLÇÜM DEĞİL diye gösterir. Prod'u ölçmek için prod env'i export edip koşmak gerekir.
- Env varken sayaç okunamıyorsa (401/ağ/RPC hatası) kapı **FAIL** verir; okunamayan bütçe $0 sayılmaz (fail-closed).
- Yerel `guardrails/.dfs-spend/` ağacı artık defter DEĞİL; kapı orada kalıntı görürse bunu bilgi notu olarak söyler ve toplama KATMAZ.

## predicate
```predicate
bash guardrails/dfs-budget.sh
```

## on-violation
Şüpheliler: `public.dfs_spend` içinde bugüne yazılmış canlı DFS harcaması (dev smoke); `apps/mcp/src/dfs/budget.ts` settleSpend maliyet çıkarımı; hiç kapanmamış (status='open') rezervasyonlar — bunlar tahminleriyle gün boyu bütçeye yüklenmeye devam eder.
Runbook: `select spend_day, endpoint, status, estimated_usd, actual_usd, created_at from public.dfs_spend where spend_day = (now() at time zone 'utc')::date order by created_at;` ile günü dök → $3 eşiği DEV smoke'ta aşıldıysa DUR ve insanı uyandır (contract uyandırma sınıfı: para / dış dünya) → canlı akışı kapat (`DFS_LIVE` unset) ve harcama kaynağını doğrula. Çok sayıda 'open' satır varsa çöken/başarısız akışları araştır (ürün doğru davranıyor: kapanmayan rezervasyon bütçeyi güvenli yönde tüketir). Otomatik düzeltme YOK — rapor et. Test/CI'da gerçek çağrı=0 olduğundan üretim projesinde bu tablo normalde boştur.
