# goal: tenant-scope-service-reads
created: 2026-09-05
kaynak: Dilim 6 hakem bulgusu H-3 (NEVER #4, mutasyon HM9) + Dilim 4/3'ün D4-1 sınıfı. `apps/mcp` service-role istemci RLS'i BAYPAS eder; o istemciyle yapılan her okumada kiracıyı ayıran tek şey açık `.eq("user_id", …)` filtresidir. 2026-09-04'te `db.ts` `selectOwnById`'den o filtre silindi ve hızlı şerit 4198/4198 YEŞİL kaldı — üstelik db şeridinde de karşılığı yoktu (`auth.db.test.ts` yalnız `selectOwn`'u sürüyordu). `selectOwnById`, `loadOwnProject` üzerinden `project_id` alan bütün tool'ların sahiplik kapısıdır; filtresiz "senin projen" = "bu id'ye sahip herkesin projesi".
Bu hedef `service-client-pins.test.ts`'i koşar: o dosya üretim okuyucularını sahte kaydedici istemciye karşı DOĞRUDAN sürer ve KURULAN İFADEYE bakar (satırlara değil — sahte hiçbir filtreyi uygulamaz, imzalı ders 12). Docker istemez; `make verify` db şeritlerini koşmadığı için (CLAUDE.md kapı tablosu) bu filtrelerin Docker'sız tek bekçisi burasıdır.

## predicate
```predicate
pnpm --filter @pseo/mcp exec vitest run src/tools/service-client-pins.test.ts
```

## on-violation
Şüpheliler: service-role bir okuma/yazmadan kiracı filtresinin (`.eq("user_id", …)`) ya da anahtarın geri kalanının (`id`, `project_id`, `job_id`, `kind`, `tool`, `status`) düşürülmesi — özellikle `db.ts` `forUser().selectOwn` / `selectOwnById` içinde, ya da bu dosyanın pinlediği modüllerden birinde (`list-credit-activity`, `list-jobs`, `list-projects`, `connect-gsc`, `pull-gsc-data`, `my-pages-crawl`, `tracked-keywords-store`, `keyword-positions-store`, `untrack-project`, `audit/runs`, `queue/boss`, `generate-report`).
Runbook: kırmızı testin adındaki bulgu kodunu (H-3, GR-2, LCA B-4, …) al → ilgili üretim fonksiyonundaki zinciri aç → eksik `.eq(...)` çağrısını GERİ KOY. NEVER #4 gereği filtre insan onayı olmadan kaldırılmaz; "id zaten kiracı-kapsamlı geldi" savunma-derinliği argümanıdır, filtreyi silme gerekçesi DEĞİLDİR. Testi gevşetmek/silmek YASAK (NEVER #8). Otomatik düzeltme YOK — rapor et.
