# Dilim 1 kapanışı — 12 tool, 65 bulgu

> Tarih: 2026-09-02 · Tur: tool kontrol turu 2026-09 · Kayıtlar: bu dizindeki 12 `<tool_adı>.md`
> Kural (CLAUDE.md ders 16): bir kalem kapandığında **kapatan tur** kaydı da günceller. Bu dosya
> indekstir; her satırın ayrıntısı kendi kaydındaki `durum (kapanış)` sütunundadır.
> Her kalem ya bir PR numarasıyla ya da `AÇIK / ERTELENDİ / İMZA KALEMİ — neden` ile biter.

## Sayılar

| | adet |
|---|---|
| Bulgu (12 kayıt toplamı) | **65** |
| P0 | 0 |
| P1 | 19 — **19'u da kapandı** |
| KAPANDI | 42 (+1 KISMEN: UP-2) |
| AÇIK | 20 |
| ERTELENDİ → Dilim 2 | 1 (LJ B-3) |
| İMZA KALEMİ | 1 numaralı bulgu (WN F-1) + UP-2'nin yarısı |

`canlı ✔` işaretli bulgu sayısı: 16. Canlı doğrulama şef tarafından 2026-09-02'de, **kredi Δ 0** ile
yapıldı; deploy'lar: `ca1b0c9` (#203), `8a2fb54` (#204), `4349f71` (#205). **#206 henüz merge
olmadı** — o PR'ın kapattığı 9 bulgu bugün `main`'de YOKTUR.

## Tool tablosu

| tool | karar (kapanış) | kapatan PR'lar | canlı doğrulama | açık kalemler |
|---|---|---|---|---|
| `connect_gsc` | KAPANDI | #203, #206* | CG-2 (tek cümle) | CG-3 (P2, açık) · CG-4 (P2, ölçülemedi) |
| `get_credit_balance` | KAPANDI | #204, #205 | B-2 (38/38 strict) | B-4 (P2, trial dalı ölçülemez) |
| `get_job_status` | KAPANDI | #204, #205 | B-1 `isError` · B-3 next-step · B-6 | yok |
| `list_credit_activity` | KAPANDI | #205, #206* | B-1 imleç · B-2 ret · B-3 proje kapsamı | B-6 (P2, 0033 satırı yok) |
| `list_gsc_properties` | KAPANDI | #198, #203, #204 | LGP-1 sıra (27 mülk) · LGP-2 ipucu · LGP-4 | yok |
| `list_jobs` | KAPANDI | #198, #204, #205, #206* | B-1 status filtresi + bogus ret | B-3 → **Dilim 2** |
| `list_projects` | KAPANDI | #204, #205, #206* | B-2 (strict) | B-3 (P2) · B-5 (P2, ölçülemedi) |
| `setup_project` | KAPANDI | #203, #204, #206* | SP-2 (strict) | yok |
| `track_gsc_property` | KAPANDI | #198, #203, #206* | TGP-1 hariç **yok**; TGP-5 canlıda ✔ (şef, katrenur sc-domain:, Δ0) | TGP-2 (P2) · TGP-3 (P2) |
| `track_keywords` | KAPANDI | #198, #203, #204, #206* | F-3 `action:"list"` · F-8 | F-4 · F-5 · F-6 · F-7 · F-9 (beş P2) |
| `untrack_project` | KAPANDI | #198, #203, #206* | UP-2'nin tek-ses yarısı | UP-2 yarısı **İMZA** · UP-3 (P2) |
| `whats_next` | KAPANDI | #203, #204, #206* | F-9 (`{confirm:true}` reddi) | F-1 **İMZA** + F-4·F-5·F-6·F-7·F-8·F-10 |

`*` = #206 CI'da, **merge bekliyor**.

## Tekrarlayan sınıflar

Bu turda **yazılı olarak var olan** sınıflar S1, S2, S5, S7'dir — dördü de PR başlıklarında ve commit
mesajlarında adıyla geçer. **S3, S4, S6, S8, S9 için bu depoda hiçbir tanım yoktur** (ölçüldü:
`git log --all | grep '(S[1-9]'` ve bu dizindeki 12 kaydın tam metni). Numaralandırmadaki boşluğu
"kapandı" ya da "açık" diye raporlamak, olmayan bir kalemi kayda geçirmek olurdu.

> Karıştırma uyarısı: `scripts/testing/plan.mjs` içindeki `S1` / `S3a` / `S5` kodları **sweep
> senaryo** kodlarıdır, bu sınıflarla ilgisi yoktur. `setup_project.md:90` ve `get_job_status.md:159`
> o namespace'ten alıntı yapar.

| sınıf | ne | akıbet |
|---|---|---|
| **S1** | şema dışı argüman sessizce yutuluyor; canlı 38 tool'un hiçbirinde `additionalProperties:false` yok | **KAPANDI #204 + canlı ✔** — `refuseUnknownKeys` kayıt düzeyinde; ilan ve parse aynı çağrıdan türüyor. Bulgular: GCB B-2, LP B-2, LJ B-1'in yutma yarısı, GJS B-6, SP-2, LGP-4, WN F-9, TK F-8. Yan karar: `confirm` **yalnız** `crawl_site` + `ai_visibility_compare`'de ilan ediliyor (canlı doğrulandı) |
| **S1-b** | iç içe obje (`ai_visibility_compare.targets[]`) hâlâ katı değil | **ERTELENDİ → Dilim 6** (#204'ün "Ölçülmeyen" bölümü) |
| **S2** | on kısıt yalnız Docker isteyen `*.db.test.ts` şeridinde pinliydi; `make verify` kördü | **KAPANDI (#206, merge bekliyor)** — LCA B-4, LJ B-2, LP B-1, UP-1, TK F-1, TGP-1, CG-1, SP-1, WN F-2. Sınır: pinler kısıtın **kurulduğunu** kanıtlar, gerçek satırlara karşı **davrandığını** değil |
| **S5** | docs gövdesi gerçek çıktıyı anlatmıyor (drift kontrolü yalnız frontmatter + Input tablosuna bakar) | **KAPANDI #203 + #205** — SP-3, LCA B-5, LP B-4, GJS B-5, WN F-3, LGP/TGP/TK gövdeleri |
| **S7** | description maliyeti söylemiyor (38'in 3'ü) | **KAPANDI #205 (GCB B-1, GJS B-4) + #203 (`whats_next`)** — üçü de artık " Costs 0 credits." ile bitiyor |

## İmza kalemleri (operatörde — kod yazılmaz)

| kalem | kayıt | neden imza |
|---|---|---|
| Tavsiye kataloğu donmuş: canlı 38 tool'un 22'si `whats_next` merdiveninde hiç anılmıyor | `whats_next.md` F-1 | ürün kapsam kararı; önerilecek tool'ların çoğu **ücretli** |
| `You were not charged.` cümlesi 0-kredilik tool'da anlamsız güvence veriyor | `untrack_project.md` UP-2 (yarısı) | paylaşılan cümlenin ücretsiz tool'larda kısalması bir metin/ürün kararı |

**İmza kuyruğuna GİRMEMİŞ ama kayıtların kendisi "imza gerektirir" dediği iki kalem** (bugün `AÇIK`):

- `track_keywords` F-9 — ölçümün üçüncü taraf bir sağlayıcıdan geçtiğinin tool metninde söylenmesi.
- `whats_next` F-5 — iş-kuralı reddinde `isError` bayrağının yüzey genelinde tek kurala bağlanması
  (`whats_next` `textResult`, `track_keywords` `errorResult` döndürüyor).

## Dilim 2'ye devreden

| kalem | kaynak | not |
|---|---|---|
| `queued` / `running` dallarının canlı ölçümü | `list_jobs.md` B-3, `get_job_status.md` §4 | 20 kredilik `crawl_site` gerekiyor. Operatör izin verdi; **harness sınıflandırıcısı ücretli çağrıyı reddetti** (2026-08-27 turundan devreden) |
| `generate_report` / `crawl_site`'taki eski "setup_project first" cümlesi | #203 hakem P2'si | bu dilimin tool'larında değil |
| `list-gsc-properties.ts`'te iki sıralama kuralının aynı dosyada yaşaması | #203 hakem P2'si | davranış doğru, biçim borcu |
| `dist/test/fake-query.js` üretim imajına giriyor | #206 hakem P2'si | ölü modül; `dist-freshness.mjs` tsconfig `exclude`'unu elle aynaladığı için ertelendi |
| Ders 12 koşulu **prose** kaldı | #206 | `fake-query` kullanan yeni bir spec'te satır tabanlı `expect` ayrıca gerekçelendirilmeli; hiçbir kapı bakmıyor |
| S1-b — `ai_visibility_compare.targets[]` iç içe obje | #204 | **Dilim 6** |

## Kapıların ÖLÇMEDİĞİ — bu kapanışın sınırları

Ders 7: yeşil kapı NE ölçtüğüyle raporlanır. Aşağıdakiler bu turda **ölçülmedi**, ve hiçbiri
"geçti" diye sayılmamıştır.

1. **`*.db.test.ts` şeritleri lokalde koşulmadı.** `make verify` DB şeritlerini koşmaz (CLAUDE.md
   komut tablosu). #205'in hakem koşusunda `make verify-db` 723/723 verdi, ama işçinin üç tam
   koşusunda üç FARKLI test düştü (bilinen PostgREST 502 flake'i). Bu şeridi CI koşar.
2. **#206'nın pinleri davranışı ölçmez.** Kısıtın **kurulduğunu** kanıtlar (`.eq` zincirde var),
   gerçek satırlara karşı **davrandığını** değil. O iddia `*.db.test.ts`'te kalır.
3. **Canlı `queued`/`running` hiç görülmedi** — iki durumun tek kanıtı bugün birim testidir.
4. **Secret taraması `verify.sh`'de yok.** `gitleaks` yalnız `make goals` ve CI'ın kendi job'ında
   koşar; bu dilimde ayrıca koşulmadı.
5. **`MCP_SMOKE_URL` bayat anahtar taşıyor** — `mcp-alive` ve `trial-flow-e2e` hedefleri SKIP
   veriyor; `make goals`'ın 16/16'sının 5'i SKIP'tir, PASS değil.
6. **Canlıda üretilemeyen dallar:** trial hesabı (GCB B-4), GSC'nin dört dalından üçü (LP B-5),
   `property === null` (CG-4), 0033 sonrası `project_id` taşıyan ledger satırı (LCA B-6).
   Bunlar "düzeltilmedi" değil, **ölçülemedi**dir.
7. **#206 merge edilmedi.** Bu dosyada `#206` işaretli her satır, o PR `main`'e girene kadar bir
   iddiadır — kapı CI'da yeşil, ama `main`'de değil.
