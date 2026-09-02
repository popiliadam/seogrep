# Runbook — bulut migration journal'ını depoyla uzlaştırma

> Durum: **AÇIK, operatör eylemi bekliyor.** 2026-08-27'de ölçüldü ve hazırlandı; uygulanmadı.
> İlgili: audit 2026-08-26 **M-08** · `goals/migration-journal-sync.md` · `guardrails/check-migration-journal.sh`

## Sorun

`supabase db push` deponun migration sürümleriyle bulutun `supabase_migrations.schema_migrations`
tablosunun farkını alır. Prod journal depodan geride: bir sonraki standart `db push`, nesneleri
**zaten var olan** migration'ları yeniden uygulamaya çalışır ve `already exists` ile durur.

## Ölçüm (2026-08-27, prod `dvtqlxwnhdzveytqgksd`)

Depo **33** migration içeriyor. Journal repo sürümüyle **21** tanesini tanıyor. Eksik **12**:

`0022 0023 0024 0025 0026 0027 0028 0029 0030 0031 0032 0033`

Audit M-08 bunu **bir** (yalnız 0033) olarak raporlamıştı; tabloyu değil bir handoff notunu okumuştu.

**Şema doğru — her biri tek tek doğrulandı.** Bu bir çalışma-zamanı eksikliği DEĞİL, yalnız kayıt kaybı:

| migration | canlıda doğrulanan nesne |
|---|---|
| 0022 | `projects.archived_at` kolonu |
| 0023 | `crawl_pages` tablosu |
| 0024 | `audit_runs` tablosu |
| 0025 | `gsc_discovery_runs` tablosu |
| 0026 | `audit_content_runs` tablosu |
| 0027 | `domain_lookup_runs` tablosu |
| 0028 | anon/authenticated üzerinde INSERT/UPDATE/DELETE grant sayısı = 0 |
| 0029 | `keyword_research_runs` tablosu |
| 0030 | `tracked_keywords` + `keyword_position_measurements` tabloları |
| 0031 | `domain_lookup_runs_tool_check` yedi tool'a genişletilmiş |
| 0032 | `subject_lookup_runs` tablosu |
| 0033 | `credit_ledger.project_id` kolonu |

Ayrıca kontrol edildi ve **temiz**: `credit_balances` bir VIEW, `security_invoker=true` (RLS çağırana
uygulanıyor), `anon`'un SELECT hakkı yok. Görünen TRUNCATE/REFERENCES/TRIGGER grant'leri view üzerinde
işlevsiz Postgres varsayılanları.

## Nasıl saptı (tekrar etmemesi için asıl kısım)

`created_by` alanı hikâyeyi anlatıyor:

- **0001–0021**: `created_by = NULL`, sürüm = dosya öneki → `supabase db push` yazmış.
- **dört tanesi**: `created_by = <operatör e-postası>`, sürüm = TIMESTAMP → panel/MCP ile uygulanmış.
- **sekiz tanesi**: hiç kayıt yok → ham SQL editöründen geçmiş.

Yani bu bir hatırlama sorunu değil: uygulama yolu `db push` olmadığı **her seferinde** olur.

## Uzlaştırma

Desteklenen yol, sürüm sürüm:

```bash
supabase migration repair --status applied 0022 --db-url "$SUPABASE_DB_URL"
```

...0033'e kadar her sürüm için. Eşdeğer tek SQL (aynı satırları yazar; `repair` da `statements`
alanını NULL bırakır):

```sql
insert into supabase_migrations.schema_migrations (version, name)
values
  ('0022', 'project_archive'),
  ('0023', 'crawl_pages'),
  ('0024', 'audit_runs'),
  ('0025', 'gsc_discovery_runs'),
  ('0026', 'audit_content_runs'),
  ('0027', 'domain_lookup_runs'),
  ('0028', 'grant_narrowing'),
  ('0029', 'keyword_research_runs'),
  ('0030', 'rank_tracking'),
  ('0031', 'domain_lookup_runs_four_more_tools'),
  ('0032', 'subject_lookup_runs'),
  ('0033', 'credit_ledger_project_scope')
on conflict (version) do nothing;
```

Geri alma: `delete from supabase_migrations.schema_migrations where version between '0022' and '0033';`

### Bilerek yapılmayan

Panel/MCP'nin yazdığı **dört timestamp satırı SİLİNMİYOR** (`20260813103854`, `20260824071237`,
`20260824074613`, `20260824215224`). Push'un çalışması için gerekli değiller: push, deponun
sürümlerinden journal'da olmayanları arar, ve ekleme sonrası hiçbiri eksik kalmıyor. Bu satırlar
yalnız `supabase migration list` çıktısında "remote-only" görünür. Onları silmek üretim verisini
silmektir ve push'u güvenli kılmak için gerekmediğinden yapılmıyor — gerçekten isteniyorsa
`supabase migration repair --status reverted <timestamp>` desteklenen yoldur.

### Sonra

```bash
SUPABASE_DB_URL=... bash guardrails/check-migration-journal.sh
```

`OK — ... records all 33 repo migrations` demeli. Ardından `supabase migration list` deponun ve
bulutun aynı 33 sürümü gösterdiğini teyit etmeli.

## Neden bu turda uygulanmadı

Onarım hazırlandı ve doğrulandı; **üretim veritabanına yazma bu oturumun izin katmanı tarafından
reddedildi.** Bu doğru sonuç: prod migration journal'ı, gelecekteki her şema değişikliğini yöneten
kayıt. Yukarıdaki komut operatörün elinde koşulmalı.
