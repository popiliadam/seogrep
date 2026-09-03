# Tool kontrol turu — handoff (2026-09-03)

> Taze oturum için. Bu dosya + `~/.claude/projects/…/memory/tool-kontrol-turu-2026-09.md` + `docs/audits/tools/2026-09/_DILIM{1,2}-KAPANIS.md` üçlüsü tek gerçek. Bayat bir iddia bulursan önce bu dosyayı düzelt (CLAUDE.md ders 16).

## Amaç ve kural seti (değişmedi)

38 tool, her biri 7 adımlı protokolden geçer (`docs/audits/tools/2026-09/_SABLON.md`): statik · mutasyon · canlı negatif · canlı mutlu yol (ücretli dahil) · SEO güncelliği (yalnız imzalı referans `docs/reference/2026-09-02-seo-referans-listesi.md`) · kart · kanıt üçlüsü. Aile bazlı dilimler: **önce ölç (işçiler) → hakem (taze) → düzelt (işçiler, TDD) → hakem (Fable, >400 satır veya para/RLS) → merge → deploy sonrası şef canlı sondası → kapanış kaydı.**

Operatör kararları (2026-09-02): "kredi sınırımız yok, bütün izinleri veriyorum"; DFS $3/gün tavanı KALDI; SEO referansı imzalı; test özneleri adstark.com.tr (ana), dentnotion.com (büyük GSC), seogrep.com (GSC'siz kontrol), example.net (boş). Rakip domain VERİLMEDİ → `compare_competitors` keşfiyle doldurulacak.

## Durum tablosu

| Dilim | Tool'lar | Durum |
|---|---|---|
| 0 hazırlık | — | KAPANDI (#200) |
| 1 ücretsiz 12 | hesap/proje/yönlendirme | KAPANDI — ölçüm #202, düzeltme #203 #204 #205 #206, kapanış #207; canlıda doğrulandı |
| 2 crawl + 5 audit | crawl_site, audit_tech/schema/speed/onpage/content | KAPANDI — ölçüm #208, düzeltme #209 #210 #211 #212, kapanış #213; canlıda doğrulandı |
| 3 GSC 5 | pull_gsc_data, find_quick_wins, detect_cannibalization, analyze_content_decay, keyword_positions | KAPANDI — ölçüm #214, düzeltme #215 #216 #217 main'de ve canlıda doğrulandı (8/9 P1; F-5 → Dilim 4); kapanış #218 (docs, CI'da — merge edilmediyse merge et) |
| 4 anahtar kelime 7 | research_keywords, discover_keywords, ranked_keywords, keyword_gap, serp_snapshot, track_keywords(✔ D1), my_pages | BAŞLAMADI |
| 5 backlink 6 | analyze_backlinks, backlink_changes, backlink_details, disavow_candidates, link_gap, compare_competitors | BAŞLAMADI |
| 6 rapor + AI 4 | generate_report, whats_next(✔ D1), ai_visibility, ai_visibility_compare | BAŞLAMADI — H-01 (AI bütçe tavanı kanıtı) önce |

Kredi: 4519 → 4152 (2026-09-03 19:03). Hepsi ölçüm/doğrulama; defterle eşleşiyor. Fiyat değişmedi.

## Bir sonraki oturumun ilk 5 adımı

1. `git fetch origin main:main` (ders: yerel main bayat olabilir) · `gh pr view 218` — docs-only kapanış PR'ı; CI yeşilse merge et (verify-db 502 flake'i ise `gh run rerun <id> --failed`).
2. Canlı sonda script'i her oturumda yeniden yazılır (`scratchpad` uçar): `scripts/testing/transport.mjs` (`makeHttpTransport`, `initializeSession`, `callTool`) + `redact.mjs` (`makeRedactor`) + `runner.mjs` (`resultText`, `parseBalance`); env `set -a && . ~/.zshrc >/dev/null 2>&1; set +a`; `MCP_SMOKE_URL` yolunda anahtar, ASLA basma; Δ defter satırından (`list_credit_activity`, artık `project:` kapsamlı).
3. Dilim 3'te kalan tek canlı boşluk: `find_quick_wins` yeni cümleleri (CTR, R-7.11, precondition) canlıda görülmedi — Dilim 4 turunda 10 kredilik tek çağrıyla kapat.
4. Dilim 4 ölçüm: 3 işçi (research+discover / ranked+my_pages / keyword_gap+serp_snapshot). DFS günlük tavan $3 → vendor'a çıkan çağrılar (research 0.10, ranked 0.20, discover/my_pages Labs) bir güne sığmayabilir; iş emrine tool başına tavan yaz. `serp_snapshot` kaydına Dilim 3 F-5'i (SERP özellikleri yazılıp okunmuyor) taşı.
5. Her dilimde: hakem raporundaki "kapı ölçmedi" kalemlerini kayıtlara işle; imza kalemlerini operatöre tek listede sor.

## Operatörde bekleyen kararlar (hiçbiri bloke etmiyor)

1. `whats_next` kataloğu 38 tool'un 22'sini anmıyor — genişletilsin mi?
2. Ücretsiz tool'larda "You were not charged." cümlesi (13 tool ortak sabit) — kalsın mı? Ayrıca ücretli reddin defterde charge+refund çifti bırakması ile cümlenin çelişkisi (T-B11/S-B9) — tek hüküm.
3. Özdeş denetimin yeniden ücretlendirilmesi (A-3b/T-B5b/S-B5b) — fiyat modeli; kod tarafı ("already audited" uyarısı) kapandı.
4. `audit_speed` mobil ekseni (`for_mobile: true`) vendor maliyetini ×2 yapar.
5. `find_quick_wins` sıralama politikası (gösterime göre → en düşük CTR'lı başa) — B-1b.
6. Rakip domain (Dilim 4/5 için).
7. **Operatör kuyruğu, migration:** `create unique index jobs_one_active_crawl_per_project on public.jobs (project_id) where tool='crawl_site' and status in ('queued','running')` — yarış penceresini kapatır; `enqueueJob` 23505'i yakalayıp mevcut job_id'yi döndürmeli; düz create.

## Devreden teknik kalemler (kayıtlarda adıyla; öncelik sırasıyla)

- **`goals/` hedefleri hiç yazılmadı** (üç dilimde de): NEVER#4 kiracı filtreleri (6+ konum artık hızlı şeritte pinli, goals predicate yok) · audit_schema tip tablosu = R-2.1 galeri · audit_speed eşik+ücret · kök-URL koruması · Google güncelleme takvimi bayatlığı (90 gün) · hreflang ISO tablosu.
- `charge:"handler"` ücret adı/tutarı çağrı yerinde: audit_speed + keyword_positions pinli; diğer 14'ü aile taraması yalnız `projectId` anahtarını görüyor, tutarı değil.
- Registry: zod-issue çok satırlı ret + "You were not charged" birleştirmesi (sınıf 9 kalan yarısı).
- `format.ts` (schema) "No JSON-LD @type found anywhere on the site" kapsamdan bağımsız (S-B7 ikinci yarısı).
- `list-gsc-properties.ts` iki sıralama kuralı (byte vs localeCompare).
- `crawl_site`/`generate_report` eski "setup_project first" cümlesi (S6) ve `generate-report.db.test.ts:514` pini.
- S1-b: `ai_visibility_compare.targets[]` iç içe obje gevşek (Dilim 6).
- Robots gövdesi `CrawlResult`'a yazılmıyor → AI crawler token'ları (R-3.20–24) audit_tech'te yapısal olarak ölçülemez (DB şeması kararı).
- `dist/test/fake-query.js` üretim imajında (ölü modül; `dist-freshness.mjs` tsconfig exclude'unu elle aynalıyor).
- audit_speed fixture hâlâ elle kurulu, snake_case alias pinli; `enable_javascript` DFS'te dokümante değil.
- `pseo-wt/` altında ~55 worktree (bu turun 15'i dahil) — temizlik ayrı iş.

## Kalıcı tuzaklar (bu turda ölçüldü)

- **verify-db CI flake'i (PostgREST 502) bugün 6+ kez:** her main merge'inin deploy'unu ~%50 blokluyor (`require-ci`). Her seferinde FARKLI test → flake; aynı test iki kez → gerçek. `gh run rerun <ci> --failed`, sonra deploy kendi tetiklenmezse `gh run rerun <deploy>`. #217'de ise GERÇEK kırmızı çıktı (eski pinler) — flake'e alışıp geçme.
- Yığılı PR: alt dal `--delete-branch` ile silinince üst PR otomatik kapanır.
- Paralel işçiler aynı kiracı bakiyesini paylaşır → Δ defterden.
- Worktree hook'u yol döndürmüyor → `git worktree add` elle, `pnpm install --frozen-lockfile --prefer-offline` + `pnpm --filter "./packages/*" build` + `pnpm --filter @pseo/mcp build`.
- Mutasyon deneyleri mtime bozar → `make verify` "dist is STALE" (exit 2) → `pnpm --filter @pseo/mcp build`.
- İşçi/hakem "bölünemedi" ve "PSI/DFS/vendor çağrısı yapar" gibi iddiaları da hipotezdir (ders 13): bu turda audit_speed PSI değil DFS Lighthouse, keyword_positions vendor'a çıkmıyor, 100k satır tavanı depolamayla çelişiyordu.
- MCP'nin kendi seogrep bağlantısı bu oturumda düştü; canlı çağrı yolu daima `transport.mjs`.

## Son durum (2026-09-03 19:05)

- #217 `bbc259d` main'de; deploy başarılı (`uptime` 3090 s'de ölçüldü).
- GSC canlı sondası (dentnotion, Δ −25, defter üç satırda `project: dentnotion.com`): sayfalama 21.342 / 29.603 satır (eski tavan 15.000) · core-update notu listenin başında · gösterim/pozisyon satırı · ana sayfa fold edilmiyor ("is left out"); hub `/doktorlarimiz/` bilinen açık yarı; `truncated` cümlesi bu mülkte tetiklenmedi.
- Dilim 3 kapanış PR #218: canlı eki commit'lendi, CI koşuyor; merge edilmediyse taze oturumun ilk işi.
- Bu oturumda toplam 18 PR merge edildi (#200–#217), 1 açık (#218). Hakem turları: Dilim 1 3 işçi + 1 hakem + 4 Fable; Dilim 2 4 işçi + 1 hakem + 4 Fable (1 FAIL→PASS); Dilim 3 2 işçi + 1 hakem + 3 Fable (1 FAIL→PASS).
- Açık worktree'ler: `/Users/apple/dev/pseo-wt/{dilim1-*,d1-*,d2-*,d3-*}` (15) + önceki turlardan ~40 — merge edilmiş dallar `git worktree remove` ile temizlenebilir (silme = operatör onayı).
