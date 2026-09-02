# goal: migration-journal-sync
created: 2026-08-27
kaynak: Audit 2026-08-26 M-08 + 2026-08-27 ölçümü. `packages/db/supabase/migrations/*.sql` deponun tarihçesi; `supabase_migrations.schema_migrations` bulutun neyi uyguladığına dair KAYDI. `supabase db push` ikisinin farkını alır, dolayısıyla journal geride kaldığında push nesneleri zaten var olan migration'ları yeniden uygulamaya çalışır ve "already exists" ile durur.

## kapı NE ölçer, NE ölçmez
- ÖLÇER: `SUPABASE_DB_URL` verildiğinde, her depo migration sürümünün bulut journal'ında KAYITLI olduğunu. Ölçtüğü host'u açıkça yazar (imzalı ders 7).
- ÖLÇMEZ: **çalışan SQL'in dosyayla aynı olduğunu.** Journal'da bulunan bir sürüm sözüne inanılır; burada ADLAR karşılaştırılır, içerik hash'i değil. İçerik sapması ayrı bir kapıdır ve HENÜZ YOKTUR.
- ÖLÇMEZ: env yoksa hiçbir şey — **SKIP (exit 97)**, sessiz OK değil.
- Env varken journal okunamıyorsa **FAIL** (fail-closed): okunamayan journal, boş journal değildir.
- Journal'ın depodan İLERİDE olması burada hata sayılmaz (elle uygulanmış timestamp sürümleri böyle görünür).
- `--self-test` karşılaştırmayı veritabanısız koşar; verify.sh onu çağırır.

## ölçüm 2026-08-27 (prod)
Depo 33 migration; journal repo sürümüyle yalnız **21**'ini tanıyordu. **0022–0033 (on iki tanesi) eksikti.** Audit M-08 bunu BİR (yalnız 0033) olarak raporlamıştı — tabloyu değil bir handoff notunu okumuştu.

Şema HER BİRİ İÇİN DOĞRUYDU, tek tek doğrulandı: `crawl_pages` · `audit_runs` · `gsc_discovery_runs` · `audit_content_runs` · `domain_lookup_runs` · `subject_lookup_runs` · `keyword_research_runs` · `tracked_keywords` · `keyword_position_measurements` · `projects.archived_at` · `credit_ledger.project_id` · 0031'in 7-tool'a genişletilmiş CHECK'i · 0028 sonrası anon/authenticated'da INSERT/UPDATE/DELETE = 0.

Nasıl saptı: 0001–0021 `created_by = NULL` ve dosya sürümü taşıyor, yani `supabase db push` yazmış. Sonrası elle uygulanmış — dördü panel/MCP ile (TIMESTAMP sürüm + operatör e-postası), sekizi ham SQL editörüyle (hiç kaydedilmemiş). Yani bu, hatırlamakla çözülecek bir disiplin sorunu değil: uygulama yolu `db push` olmadığı HER SEFERINDE olur.

## predicate
```predicate
bash guardrails/check-migration-journal.sh
```

## on-violation
Şüpheliler: panelin SQL editöründen ya da MCP `apply_migration` ile elle uygulanmış migration'lar.
Runbook: `docs/runbooks/migration-journal-repair.md`. Özet: (1) eksik her sürümün nesnelerinin CANLIDA var olduğunu doğrula; (2) `supabase migration repair --status applied <version>` ile sürüm sürüm uzlaştır; (3) migration'ı ASLA yeniden koşturma — "already exists" ile durur ve operatörü baskı altında bir `repair` kararına zorlar. Otomatik düzeltme YOK — rapor et.
