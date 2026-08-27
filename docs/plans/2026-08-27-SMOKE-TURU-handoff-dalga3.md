# SMOKE TURU — DALGA 3 · TAZE OTURUM BURADAN BAŞLAR

> Dalga 2 bitti: **`setup_project` gezildi**, bulunan **6 madde kapatıldı ve CANLIYA ÇIKTI**,
> dalga 1'in 20 maddesi de **canlıda**. Gezilen yüzey: **5 / 38 tool**.
> Sıradaki tool: **`whats_next`**.
>
> Önceki iki handoff **hâlâ geçerlidir** ve buraya tekrar kopyalanmaz:
> - `2026-08-27-SMOKE-TURU-handoff.md` — protokol §0, para kuralları §3, **§5 bulgu eksenleri**,
>   **§7 dokunulmaz kanıtlar**, §8 bilinen açık maddeler, §9 tuzaklar.
> - `2026-08-27-SMOKE-TURU-handoff-dalga2.md` — §6 dalga 1'in tuzakları.
>
> Bu dosya yalnız **değişenleri**, **sıradaki işi** ve **dalga 2'nin öğrettiklerini** taşır.

Defter: **`docs/plans/2026-08-27-smoke-turu-defteri.md`**. Dalga 2'nin bölümleri **§D0–§D4**;
`setup_project`'in kapanış tablosu **§D1e**. Dosyanın ortasındaki dalga-1 tablosu (🔒 KAPANIŞ
DURUMU) **yalnız dalga 1 içindir** ve değişmez.

---

## 0. PROTOKOL — değişmedi, pazarlıksız

1. **TEK TOOL, SONRA DUR.** Operatör "okey" demeden sıradakine geçilmez.
2. **İKİ KANAL.** Asistanın çağrısı + operatörün kendi testi. Çelişirlerse **çelişki yazılır**.
3. **DEFTERE YAZMADAN GEÇME.** Bulgu yoksa "bakıldı, bulgu yok" satırı yazılır.
4. **Her paralı çağrının önü/sonu:** `select dfs_spend_today_usd()`. Deftere **`actual_usd`**.
5. **Her tool için ayrıca:** çalışma prensibi · panelde/sitede nasıl göründüğü · hangi komutların
   tetiklediği.
6. **Düzeltme izni AÇIK** (operatör, 2026-08-26): ölç → bul → düzelt → kapıdan geçir → deftere yaz
   → merge → deploy → **canlıda doğrula**. NEVER#10 hakemi operatör onayıyla askıda.

---

## 1. DURUM — dalga 3 başlarken

| | |
|---|---|
| `main` | **`ab8e225`** — dalga 1 + dalga 2 **merge edildi ve deploy edildi** |
| çalışma dalı | yok; `main` temiz ve `origin/main` ile eşit |
| `mcp.seogrep.com/status` | `ok:true` · `errorsSinceBoot:0` · `pendingJobs:0` · `schema:ready` |
| `seogrep.com` | HTTP 200 |
| yüzey | **38 tool** |
| kredi bakiyesi | **4519** (dalga 2'de **hiç kredi harcanmadı**) |
| `credit_ledger` | **783 satır** — 13 canlı `setup_project` çağrısı **tek satır yazmadı** |
| vendor | dalga 2 boyunca **$0,101 / $3,00**, hiç paralı çağrı yok. **UTC günü 2026-08-27'ye döndü ve sayaç $0,00'a sıfırlandı** (ölçüldü 06:38Z) |
| `projects` | **20** (17 → +3 kanıt satırı, aşağıda) |
| migration | **0033 cloud'a UYGULANDI** ve doğrulandı |

### Dalga 2'de canlıya çıkanlar

Dalga 1'in 20 maddesi (PR #180) **+** `setup_project`'in altı maddesi:

| # | ne | nasıl doğrulandı |
|---|---|---|
| D-1 | panel "Add domain" DNS uyarısı basmıyordu | kod canlıda; **tarayıcı ölçümü OPERATÖRDE** |
| D-2 | kurulum makbuzu sonraki adımı söylemiyordu | canlı çağrı |
| D-3 | Türkçe büyük `İ` siteyi ikiye bölüyordu | **iki canlı tanık** (`MİNİNGAA.COM`, `LASTİKSA.COM`) |
| D-4 | IDN projeler punycode gösteriliyordu | makbuz + `list_projects` |
| D-6 | uyarı paragrafı hâlâ A-label basıyordu | canlı çağrı |
| D-7 | ledger'da "kaydedilmemiş" → "no project scope" yalanı | canlı çağrı |
| D-8 | `limit` çıkmaz sokağı + toplam yokluğu | **doğrudan uçtan** iki JSON-RPC sayfası |
| D-9 | 2. sayfa kendine "en yeni" diyordu | doğrudan uçtan |

---

## 2. İLK ÜÇ ADIM

```bash
cd "/Users/apple/dev/pseo web saas"
git checkout main && git pull --ff-only     # ab8e225 ya da daha yenisi
curl -s https://mcp.seogrep.com/status      # ok:true, schema:ready
```

1. **Bağlantıyı doğrula:** `get_credit_balance` (0 kredi). `requires authentication` gelirse
   operatörün istemciyi yenilemesi gerekir.
2. **⚠️ ŞEMA TAZELİĞİNİ ÖLÇ** — aşağıdaki §3, dalga 2'de canlı bir doğrulamayı engelledi.
3. **Vendor tabanını ÖLÇ, hatırlama:** `select dfs_spend_today_usd()`.
   ⚠️ **Bu sayaç UTC takvim gününe göre sıfırlanır** (`spend_day`). Dalga 2, 08-26'da $0,101 ile
   kapandı; 06:38Z'de yeni gün başlamış ve sayaç **$0,00** okunmuştu. Yani "taban $0,101" diye
   ezberlenen bir sayı, ertesi gün **yanlış** bir taban olur — ve $3 tavanı da o günün tavanıdır.
4. Defteri aç, **§D1e**'yi ve bu dosyanın §6'sını oku.

---

## 3. ⚠️ İSTEMCİ ŞEMASI BAYAT — ve bunu ürün kusuru sanma

Dalga 2'de **ölçüldü**: canlı `list_credit_activity` yeni bir `before_id` parametresi kazandı ve
açıklaması değişti; asistanın istemcisindeki şema **eski** kaldı. Sonuç: istemci `before_id`'yi
**dizgi** olarak gönderdi, sunucu haklı olarak reddetti.

```
✖ Invalid input: expected number, received string → at before_id
```

**Çağrılar canlı sunucuya gidiyor** (cevaplar yeni kodun çıktısı); bayat olan yalnız şema ve
açıklama önbelleği. Yeni bir parametreyi doğrulaman gerekiyorsa **doğrudan uçtan** ölç:

```bash
eval "$(grep -E '^[[:space:]]*export[[:space:]]+MCP_SMOKE_URL=' ~/.zshrc)"
# sonra kucuk bir node betigi: initialize -> tools/call, argumanlar GERCEK tiplerinde
```

`MCP_SMOKE_URL` **yolunda canlı bir `sg_` anahtarı taşır — asla echo'lama.** Transport örneği
`scripts/testing/transport.mjs`'te hazır.

---

## 4. SIRADAKİ TOOL: `whats_next`

A bölümünün kalanı, sırasıyla:

`whats_next` → `get_job_status` → `list_gsc_properties` → `track_gsc_property` → `connect_gsc` →
`track_keywords` → `untrack_project`

> `untrack_project` **en sona** (arşivler). Sonra B (crawl/audit) → C (GSC) → D (SERP) →
> E (DFS) → F (backlink) → G (hız + AI); sıra ve fiyatlar ilk handoff §4'te.

### `whats_next` için bilinen zemin (kod okundu, tahmin değil)

- **0 kredi**, `charge` varsayılan `"surface"` → `withCredits` kısa devre, **ledger satırı yok**.
- Tek parametre: **`project_id` (uuid, opsiyonel)**. Boş bırakılırsa tek projeyi yönlendirir;
  birden çok proje varsa **listeler ve hangisi diye sorar**. Hesapta **18 aktif proje** var,
  yani parametresiz çağrı **liste + soru** yolunu sürecek — o yolu da ölç.
- **DNS portu kullanıyor** (`checkDomain`, artık `@pseo/core/net/reachability`). Yani ölü alan
  adı için de bir davranışı var; `smoke-dalga2-yok-4e91.com` (`4809a33f…`) ve
  `smoke-dalga2-örnek.com` (`e5095cf9…`) **tam bu iş için hazır duruyor**.
- Dalga 1'de **iki kez** düzeltildi: `7f2fe7c` (her adımın kaç krediye mal olduğunu ve gerçekte ne
  yaptığını söylüyor) · `fb2a450` (**G9** — boolean GSC alanına bakıp *koşamayacak* bir
  `pull_gsc_data` öneriyordu). **İkisi de artık canlıda ve ilk kez müşteri yolundan görülecek.**
- Merdiven `@pseo/core/guide/next-step.ts`'te ve **panel de aynı merdiveni** kullanıyor
  (`lib/projects/card.ts` → `decideProjectNextStep`), yani panel ile tool'un **aynı** cümleyi
  vermesi bir sözleşme — **ikisini karşılaştır**.

### Bu tool'da özellikle ölçülecekler

1. Parametresiz çağrı 18 projeyle ne yapıyor — liste okunabilir mi, hangisi diye **soruyor** mu?
2. `example.net` (`257ad998…`) = **"bağlı ama property seçilmemiş"** tek örnek (G5/G8'in canlı
   kanıtı). whats_next bu yarım kuruluma ne diyor?
3. Ölü alan adı projesi için ne öneriyor — 20 kredilik crawl önermiyor, değil mi? (`domain-
   reachability.ts`'in var oluş gerekçesi tam buydu.)
4. Hiç işi olmayan taze proje (`example.org`) vs 26 sayfalık crawl'ı olan `noraninsaat.com`.
5. **Panel paritesi:** `/app/projects` kartındaki "next step" ile tool'un cümlesi aynı mı?

---

## 5. AÇIK MADDELER — dalga 3'e devreden

| # | madde | sahip | not |
|---|---|---|---|
| **D-5** | Proje sayısında **tavan yok** (0 kredi + açık kayıt = sınırsız satır) | **operatör imzası** | Kod hatası değil paket kararı. Öneri: **hesap başına 50 aktif proje**, arşivlenenler sayılmaz |
| **D-1 ölçümü** | Panel DNS uyarısı canlıda ama **tarayıcıdan görülmedi** | operatör | `/app/projects` → yanlış yazılmış alan adı ekle → banner'da "does not resolve yet" görünmeli |
| **M-1** | `supabase_migrations`'ta **0033 kaydı yok** (SQL Editor'dan elle koşuldu) | operatör | Şema doğru, defter eksik. İleride `supabase db push` 0033'ü yeniden deneyip "column already exists" ile düşebilir |
| **B-1** | Merge edilmiş **5 dal** uzakta duruyor | operatör | `fix/smoke-turu-dalga-1` · `fix/idn-warning-name` · `fix/ledger-project-not-recorded` · `fix/paged-header-wording` · `docs/dalga2-d7-d9` |
| G12 | `keyword_gap` + `link_gap` okuma kaydı bırakmıyor | kod | **F bölümünde** karara bağlanacak |
| G16b | Panel tek aktif anahtara zorluyor (arka uç 5'e izin veriyor) | operatör kararı | Çok-anahtarlı yönetim arayüzü demek |

---

## 6. DALGA 2'NİN ÖĞRETTİKLERİ — bunlar tekrarlanırsa boşa döngü

### 6.1 Aynı delik ÜÇ kez çıktı: *N ekseni varyantla, N+1'inciyi hiç sorma*

| vaka | varyantlanan eksen | **sorulmayan** eksen |
|---|---|---|
| D-6 | hangi **TOOL** IDN'i gösteriyor (5 yüzey düzeltildi) | **tek cevabın İÇİNDEKİ hangi cümle** — makbuz dostça, uyarı punycode |
| D-9 | sonraki sayfaya **ulaşılabiliyor mu** | sonraki sayfa **kendine ne diyor** ("most recent") |
| D-9'un pini | saf fonksiyon doğru cümleyi üretiyor mu | **handler bayrağı geçiriyor mu** |

**Üçünü de yakalayan şey testler değil, düzeltmenin KENDİ ÇIKTISINI CANLIDA OKUMAK oldu.**
Bir dilim bittiğinde: deploy et, **aynı çağrıyı tekrar yap**, ve cevabın **tamamını** oku.

### 6.2 Saf fonksiyon pini kendi kablolamasını göremez

D-9'da handler'ın `before_id !== undefined` argümanını silmek **üç yeni pini de yeşil bıraktı** —
üçü de saf fonksiyonu çağırıp bayrağı kendileri veriyordu. **Tool'un kendisini koşan bir pin
olmadan, kablolama ölçülmemiştir.** Mutasyonu her zaman koş.

### 6.3 Tenant filtresiz sorgu, "üründe tutarsızlık" diye raporlanmaya bir adım

Şef defter toplamını **tenant filtresiz** sorguladı, 4699 çıktı, tool 4519 diyordu. Fark başka bir
kiracının 180 kredisiydi. **NEVER#4'ün okuma tarafındaki karşılığı:** kendi doğrulama sorgunda
`user_id` filtresi yoksa ölçümün yanlış, ürünün değil.

### 6.4 Var olan bir pin, yeni bir güvenlik sorusunu senden önce görebilir

D-4'te `add-domain-banner.test.tsx`'in eski `xn--80ak6aa92e.com` pini kırmızıya döndü — çünkü
çözülmüş hâli **`аррӏе.com`**, Kiril harfleriyle "apple". Kural daraltıldı (yalnız Latin script),
**ve o pin hiç değişmeden geçti**. Bir pin kırmızıya dönünce ilk soru "pini nasıl güncellerim"
değil, **"bu pin bana ne söylüyor"** olmalı.

### 6.5 Kapı, senin kurduğun fikstürü de yargılar

- `credit_ledger_spend_reserve_id_present` — elle kurulan `spend_reserve` satırı `reserve_id`
  taşımıyordu. **Harcamaya benzeyen bir satır harcama değildir.**
- `gen-tool-docs --check` — tool açıklaması değişti, MDX bayat kaldı; ayrıca açıklama **155
  karakter tavanını** aşınca `per…` diye kesiliyordu. Ve **bayat `dist`** ayrıca reddediliyor:
  *"stale dist compares today's MDX with yesterday's code and passes for the wrong reason."*
  Tool açıklaması/parametresi değiştirdiysen: `pnpm --filter @pseo/mcp build` →
  `node apps/web/scripts/gen-tool-docs.mjs`.

### 6.6 CI'ın iki bilinen altyapı arızası — dalı suçlamadan önce bak

1. **Docker Hub `toomanyrequests`** — `verify-db` imajı çekemez. **Re-run.**
2. **Kong 502 sınıfı flake** — `An invalid response was received from the upstream server`.
   Dalga 2'de **yalnız doküman** içeren bir PR'da bile çıktı. **Re-run.**
3. 00:00–00:30 UTC arasında `verify-db` her dalda deterministik kırmızı (`reaper.db.test.ts`).

---

## 7. KAPILAR — dalga 2 sonu ölçümleri (taban)

| kapı | değer | NE ÖLÇMEZ |
|---|---|---|
| `TURBO_FORCE=1 bash guardrails/verify.sh` | **PASS** · mcp **3557** · web **1975** · core **339** · db 12 · 38 doküman senkron · `dist` taze | **secret taraması YOK · DB şeritleri YOK · canlı uç YOK** |
| `bash guardrails/verify-db.sh` | **PASS** · db 165 · mcp **493** · web 48 | canlı uç |
| `make goals` | dalga 2'de **koşulmadı** — dalga 3'te bir kez koş ve **NE ölçtüğüyle** yaz | env yüklü değilse canlı-uç hedefleri sessizce SKIP |

```bash
eval "$(grep -E '^[[:space:]]*export[[:space:]]+(PROD_URL|MCP_SMOKE_URL)=' ~/.zshrc)" && make goals
```

---

## 8. DOKUNULMAZ — ilk handoff §7 aynen geçerli, ARTI dalga 2'nin üç kanıtı

3 `not_measured` satır · 3 tracked keyword · `www.seogrep.com` / `noraninsaat.com` /
`www.noraninsaat.com` · `bu-domain-kesinlikle-yok-9f3a2c.com` (**arşivde — arşivde KALMALI**;
`setup_project` çağırmak onu geri getirir ve kanıtı bozar) · `example.net` (bağlı ama property
seçilmemiş — **tek** yarım-kurulum örneği) · 13 public rapor.

**Dalga 2'nin eklediği üç satır** — `untrack_project` turunun fikstürü olacaklar, o tura kadar
silinmez:

| domain | project_id | ne için |
|---|---|---|
| `example.org` | `5a67bc3f-9728-4237-a3f6-4d9b7826fadb` | çözülen alan adı, işi yok |
| `smoke-dalga2-yok-4e91.com` | `4809a33f-6ab9-4f79-a6ce-0d0d7be73ea6` | **çözülmeyen** alan adı |
| `smoke-dalga2-örnek.com` | `e5095cf9-049b-45f9-9d70-2deb8fa2948e` | **IDN** (punycode `xn--smoke-dalga2-rnek-c0b.com`) + çözülmüyor |

`untrack_project` turunda plan: arşivle → `setup_project` ile geri çağır → böylece tek ölçülmemiş
outcome olan **`restored`**, §7'nin dokunulmaz arşiv probuna dokunmadan ölçülür.

---

## 9. BAŞLANGIÇ

1. §2'nin üç adımı.
2. §3 şema tazeliği — sonucu deftere yaz.
3. Defterde yeni bölüm aç: **`## §D5 — whats_next`**, format ilk handoff §6'da.
4. **`whats_next`'i test et, deftere yaz, DUR ve operatörün "okey"ini bekle.**
