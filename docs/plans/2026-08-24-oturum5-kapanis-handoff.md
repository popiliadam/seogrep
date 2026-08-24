# 5. OTURUM KAPANIŞ HANDOFF — 2026-08-24

> Taze oturum `PLAN.md`'nin handoff bloğundan başlar; **bu dosya ayrıntı**. Buradaki her sayı bu
> oturumda koda ya da prod'a karşı ölçüldü. **Ölçmediklerim adıyla yazılı.**

## 0. DURUM — ölçüldü

`main` @`6e1c7e1` (+ [#168](https://github.com/popiliadam/seogrep/pull/168) merge kuyruğunda) ·
migration **0031 prod'da UYGULANDI ve TABLO OKUNARAK doğrulandı** · canlı yüzey **36 tool** ·
MCP deploy **başarılı** (uptime taze).

**Bu oturumda 7 PR:** #162 #163 #164 #165 #166 #167 (#168 kuyrukta) · 48 dosya · **6031 ekleme / 62 silme**.

---

## 1. PROD DOĞRULAMASI — 0031 sonrası, sinyale değil tabloya bakarak

Operatör SQL'i uyguladı ("Success. No rows returned"). O bir **sinyal**; ölçüm şu:

| ne | değer |
|---|---|
| `domain_lookup_runs_tool_check` | yedi ismin yedisi de yerinde, tabloda **TEK** CHECK (yetim/çift yok) |
| `domain_lookup_runs` satır | 1 — veri korundu |
| `credit_ledger` satır | **701, dokunulmadı** (NEVER#2) |
| RLS | `enabled` **ve** `forced` |
| policy | 1 |
| `anon` | **hiç DML yok** (yalnız REFERENCES/TRIGGER) |
| `authenticated` | yalnız **SELECT** |
| `service_role` | **SELECT + INSERT** — UPDATE yok, DELETE yok |

**0028'in bulut daraltması constraint takasından sağ çıktı.** (Hatırlatma: bulutta yeni tablolar
0028'den önce üç role de UPDATE+DELETE ile **doğuyordu** — bkz. `cloud-default-acl-sapmasi`.)

---

## 2. BU OTURUMDA KAPANAN İŞ

| PR | dilim | ne kapattı |
|---|---|---|
| #164 | **`/app/rankings`** | Parça 2'nin en yüksek değerli kalemi. `serp_snapshot` para alıp web'de iz bırakmıyordu. 12 dosya / 2717 satır. Dürüstlük kuralları MCP tool'undan **taşındı**, yeniden yazılmadı (aynı `GAP_SENTENCE`, aynı `MAX_CONTIGUOUS_GAP_HOURS`). Seri anahtarı **sekiz** alan |
| #167 | **0031 — dört tool'un koşu ekseni** | `backlink_changes` · `backlink_details` · `disavow_candidates` · `my_pages` artık koşu satırı yazıyor ve `/app/lookups`'ta görünüyor. Yeni sayfa/bölüm YOK |
| #165 | lookups okuma pinleri W1–W4 | **W4 gerçek kusurdu:** `now()` transaction saati → eşitlik ULAŞILABİLİR → değişim zinciri o sırayı yürüdüğü için **"önceki koşu"nun kimliği tanımsızdı** |
| #163 | para yolu P4/P5/P6 | `costs.test.ts` 26 → **35 spec**, sıfır silme |
| #162 | doküman sapmaları | 6 yanlış migration referansı · 7 bayat CHECK sayısı · **9** kaymış fiyat önerisi |
| #166 | handoff + chip envanteri | 9 chip çıktı, 3 tarif düzeldi, 6 yeni chip |
| #168 | **T1 — çift yönlü kiracı testi** | iki dosyada (dört değil, aşağı bak) |

---

## 3. ŞEFİN ÜÇ ÖLÇÜM HATASI — taze oturum bunları miras almasın

Üçü de aynı sınıf: **bir iddiayı, onu doğrulayan eksenden başka bir eksende kontrol etmek.**

### 3.1 "Dosyaya karşı okundu" — okumamıştım

Gap map notuna *"2026-08-24'te dosyadaki her öneri costs.ts'e karşı okundu"* yazdım. Gerçekte
handoff'un saydığı tool'ları grep'lemiştim. **Üç tool kaçtı** (`link_gap` · `keyword_gap` ·
`audit_speed`) ve `link_gap` hakkında **iki yarısı da yanlış** bir cümle yayınladım
("hiç sevk edilmedi ve imzası yok" — `costs.ts:57`'de **imzalı ve canlı, 45**).

Hakem çürüttü. İmzalı ders 11'in aynısı, şefin elinden.

### 3.2 "Beş CHECK" — yanlış sayıyı başka yanlış sayıyla değiştirmek

`keyword-positions.ts` "four CHECK constraints" diyordu. Ben "beş" yazdım (`status`'u **adı geçen**
kısıtlar). Teknik olarak savunulabilirdi ama repo'nun kendi kelimesi **yedi**: 0030:52, 0030:316,
`rank-tracking.db.test.ts:17`, `serp-snapshot-store.ts:19` — dördü de "seven" diyor. Benim "beş"im
**beşinci bir çelişki** yaratıyordu.

### 3.3 T1 — test ADLARINI grep'ledim, gövdeleri değil

Chip "bir dosyada tek yönlü kiracı testi" diyordu. Ben ölçtüm ve **"dört"** diye düzelttim, chip
envanterine öyle yazdım, iş emrine öyle koydum. **Gerçek iki.**

`disavow_candidates` ve `my_pages` sahip-tarafı yarısını **zaten taşıyor** — ayrı bir test adı
altında değil, **aynı `(f)` testinin gövdesinde**. Ben `it(...)` satırlarını ve birkaç anahtar
kelimeyi grep'ledim; yarı gövdedeydi.

İşçi uymadı, **ölçtü**, iki dosyaya dokunmadı (*"onları düzenlemek, ölçmeden değişiklik yapmak
olurdu"*), ve mutasyonla kanıtladı: ikisi de **yardımsız** kırmızıya dönüyor.

> **DERS (imzasız):** *Bir chip'in tarifi de bir İDDİADIR ve ölçülmeden iş emrine taşınmaz.* Bu
> oturumda **dört** chip tarifi yanlış çıktı — D1 (1 yerine 9) · D2 (5 yerine 6, ve biri zaten
> doğruydu) · T1 (1 → benim "4"üm → gerçek 2) · N1'in kapsamı. İkisini chip yanlış söyledi,
> ikisini **ben** yanlış düzelttim.

---

## 4. AÇIK CHIP'LER — güncel

Kapananlar `docs/plans/2026-08-24-taze-oturum-handoff.md` §3'ten çıkarıldı. Oradaki liste
geçerli; **bu oturumda değişenler:**

### KAPANDI
- `P4` `P5` `P6` (#163) · `W1` `W2` `W3` `W4` (#165) · `D1` `D2` (#162) · **`T1` (#168)**
- **`N1` TAMAMEN KAPANDI** — repo genelinde **hiçbir** `*.db.test.ts`'te sabit uuid literal'i
  kalmadı (**0 dosya**, iki bağımsız süpürmeyle: şef repo geneli, işçi `apps/mcp/src` geneli).

### YENİ CHIP'LER

| # | chip | ölçüm |
|---|---|---|
| **N7** | **`/status` `schema: "unknown"` diyor ama şema HAZIR** | RPC `dfs_spend_today_usd` prod'da **var** ve `service_role` onu **çalıştırabiliyor** (ölçüldü). Sebep probe'un **1 sn**'lik sınırı (`STATUS_SCHEMA_TIMEOUT_MS`); Fly ↔ Tokyo gidiş-dönüşü sığmıyor ve kod zaman aşımını `unknown`'a katlıyor — **kasten** (*"unknown, asla ready, tek güvenli katlama"*). Sinyal **dürüst ama ölü**: operatöre hiçbir zaman "hazır" demeyecek. Hafızada `schema:ready` kayıtlı, artık değil. **İmzalı ders 9'un tam şekli.** Doğru sınır bir karar — düzeltilmedi, yazıldı. |
| **N8** | **`main`'de bir Kong flake'i DEPLOY'u bloke eder** | #162 merge'inden sonra `main` CI'ı kırmızı oldu (`ledger seed failed … invalid response from upstream` — seed helper) ve `require-ci` deploy'u **doğru şekilde reddetti**. Zincir yalnız **bir sonraki merge** yeni bir CI tetiklediği için toparlandı. Tek merge'lük bir günde canlı **sessizce bayat kalır**. Kür: `main`'de CI'ı yeniden koştur. |
| **N9** | **Kompozit FK, ret cümlesinden ÖNCE ateşliyor** | Kiracı filtresi üretimden kaldırılınca dört spec de kırmızı — ama `domain_lookup_runs_user_id_project_id_fkey` (**0027**) ihlaliyle, **ret cümlesine hiç ulaşılmadan**. Derinlemesine savunma; ama o assertion'ı "orada duran tek şey" sanan biri yanılır. |
| **N10** | **`npx prettier` bu repoda kapı DEĞİL** | Repo'da prettier config **yok**, formatter `eslint`. `npx prettier --write` varsayılan `printWidth` ile dokunulmamış satırları yeniden biçimlendiriyor. Bu oturumda oldu, geri alındı. **Bir aracın "sorun var" demesi, o aracın bu projenin kapısı olduğu anlamına gelmez.** |

`N2`–`N6` (önceki handoff §3.6) hâlâ açık: 0030:52'nin gevşek ifadesi · iki panelin farklı sınır
açıklaması · seri merge kuyruğu · commit backtick enjeksiyonu · bayat `main` ref'i.

---

## 5. SIRADAKİ OTURUMUN İŞİ

### 5.1 PARÇA 2'NİN KALANI — en büyük açık eksen

**Karar verildi ve 0027'nin kendi testinden geçirildi (ölçülerek):**

Üç tool 0027'ye **GİRMEZ**, çünkü `target` sütununu yalancı yaparlar:
- `discover_keywords` — **4 mode, 3'ünde domain yok** (`ideas`/`suggestions`/`related` seed kelime alır)
- `ai_visibility` — konu **domain VEYA keyword**
- `ai_visibility_compare` — **manşet konu YOK**; düz 2-10 hedef, her biri domain/keyword/proje

> **Şefin ilk analizi AI ailesini "`compare_competitors` gibi" sayıyordu ve ÇÜRÜDÜ.** İkisi de
> `resolveTarget` kullanıyor diye aynı şekil sanılmıştı; `compare_competitors`'ın manşet hedefi var,
> AI karşılaştırmasının **yok**.

**Önerilen şekil:** *konusu ayrımlı* (discriminated-subject) bir tablo — `mode` / `subject_kind`
**saklanır** ki bir null'ın anlamı satırdan satıra değişmesin. 0030'un `status` discriminant'ı
bu şeklin çalışan örneği; 0027'nin "null'ı satırdan satıra değişen sütun" itirazı böyle karşılanır.

⚠️ **Yeni tablo = eklemeli SQL = şef uygulayabilir.** (0031'den farklı: CHECK genişletmek
`drop constraint` istiyordu ve operatöre gitti.)

### 5.2 Chip dalgası
En değerlileri: **K5** (Decompose — aşağı bak) · **T3** · **T4** · `K1`–`K4` `K6` `K7` · `P1`–`P3` ·
`W5` `W6` · `T2` `T5`–`T8` · `D3` · `N2`–`N10`.

### 5.3 `keyword_trends`
Karar değil **zaman**: bir hafta gerçek `dfs_spend` verisi → vendor maliyeti ölçülür → marj pinlenir.

---

## 6. ESKALASYONLAR — yazıldı, sessizce geçilmedi

| chip | karar | gerekçe |
|---|---|---|
| **K5** — sıradan `*.test.ts` typecheck edilmiyor | **DECOMPOSE** | Ölçüldü: `apps/mcp`'de **42 hata / 21 dosya**; ayrıca `packages/core` ve `packages/db` de test dosyalarını dışlıyor. Tek dilime sığmaz. `*.db.test.ts` zaten `tsconfig.dbtest.json` ile kapsanıyor — kapsanmayan sıradan spec'ler |
| **T3** — `location_name` normalize edilmiyor | **REVISE** | Tek başına yapılamaz: dizgi hem **abonelik kimliği** hem **vendor'a giden değer**. `track_keywords` + `serp_snapshot` + ölçüm deposu + `/app/rankings` **birlikte** değişmeli, yoksa seri ikiye bölünür. Lowercase etmek vendor çağrısını bozabilir (DFS kendi liste adını bekler) |
| **N7** — `/status` probe sınırı | **DEFER** | Doğru sınırın ne olacağı bir karar (gecikme mi ölçülecek, bölge mi değişecek, sınır mı gevşeyecek). Yanlış sinyal değil, **ölü** sinyal |

---

## 7. OPERATÖRDE BEKLEYEN — hiçbiri kodu bloke etmiyor

1. **CANLI SMOKE — en yüksek değerli, ve kod tarafında karşılığı YOK.** Sevk edilen tool'ların
   hiçbiri gerçek vendor çağrısı yapmadı; fixture'lar DFS **dokümantasyon** örnekleri. Alan adları
   değiştiyse çağrı **patlamaz**, sessizce `n/a` basar — dürüst ama **değersiz** 13–90 kredilik cevap.
   `serp_snapshot`'ta somutlaştı. **Şef yapamıyor: izin katmanı prod POST'unu reddediyor.**
2. **Cron alt-bütçesi** — `docs/plans/2026-08-24-serp-kapak-ve-cron-butcesi.md`. Şef önerisi
   **$1,00/gün + haftalık**.
3. **Ürün adaleti** — vendor tamamen düşerse kiracı **tam ödüyor** (`dfs/serp.ts:855-865`).
4. **N3** — iki panel farklı sınır açıklıyor. Birleştirmek mevcut bir assertion'ı düzenlemeyi
   gerektirir (NEVER#8). **Bugün latent**, çünkü W1 pini sayfanın kendi sınırını geçirmemesini
   zorluyor → uygulanan ≡ sabit.

---

## 8. ÇALIŞMA DİSİPLİNİ — bu oturumun eklediği

Kapılar, flake'ler ve dilim protokolü için önceki handoff §4 geçerli. **Yeni:**

### Mutasyonun UYGULANDIĞINI kanıtla — eşleşme sayısı değil, DEĞİŞEN SATIR

Bu oturumda **dört** mutasyon sahte sonuç üretti çünkü hiç uygulanmadı:

| vaka | neden |
|---|---|
| `{RANKING_HISTORY_LIMIT}` arandı | gerçek desen `{history.limit}`'ti |
| `perl -0 s///` `/g`'siz | slurp edilmiş dosyada **yalnız ilk eşleşme** — o da bir **yorumdu** |
| sabit UUID fixture | ikinci koşuda `duplicate key`, **seed helper'da**, assertion'a gelinmeden |
| `git diff main...HEAD` | **bayat yerel `main` ref'i** → "12 silme" raporlandı, gerçek **0** |

İkisi "yeşil kaldı" diyordu ve **var olmayan bulgu** üretecekti.

### Kırmızıyı teşhis et, etiketleme — ayırt edici: SEED HELPER mı, ASSERTION mı

Bu oturumda **dört** kırmızı flake çıktı ve dördü de doğru teşhis edildi:
- yerel Kong (seed helper) → `docker restart supabase_kong_seogrep`
- CI `toomanyrequests` → o koşunun **hiçbir kırmızısı kanıt değil**, yeniden koştur
- `main` CI Kong (seed helper) → deploy'u bloke etti (**N8**)
- işçinin 132 kırmızısı → `auth/v1/health` **502**, kürden sonra **200**

**Ama:** 2026-08-22'nin sahte-flake vakası bir **assertion**'dı ve gerçek bir kusurdu. "Kong mesajı
gördüm" tek başına yeterli teşhis **değil** — **nerede patladığı** okunmalı.

### Commit mesajı
`git commit -F <dosya>` ya da tırnaklı heredoc. **`-m` + backtick = kabuk komut ikamesi.** Bu
oturumda oldu: `` `id` `` çalıştı ve mesaja `uid=501(...)` + yerel grup listesi girdi. Dal push
edilmemişti, sızmadı; dal genelinde `uid=|gid=|/Users/apple` tarandı → **0**.

### Biçimlendirme
Repo'da prettier config **yok** → formatter `eslint` (**N10**).
