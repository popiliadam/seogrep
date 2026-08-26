# SMOKE TURU — DALGA 2 · TAZE OTURUM BURADAN BAŞLAR

> Dalga 1 bitti: **4/38 tool gezildi**, bulunan **20 madde kapatıldı**, PR açıldı.
> Bu dosya dalga 2'nin başlangıcıdır. Önceki handoff (`2026-08-27-SMOKE-TURU-handoff.md`)
> **hâlâ geçerlidir** — protokol, para kuralları, §5 bulgu eksenleri, §7 dokunulmaz kanıtlar ve
> §8 bilinen maddeler oradan okunur. Bu dosya yalnız **değişenleri** ve **sıradaki işi** taşır.

Defter: **`docs/plans/2026-08-27-smoke-turu-defteri.md`** — sonundaki
**"🔒 DEFTERİN KAPANIŞ DURUMU"** tablosu tek yetkili kaynaktır; üstteki bölüm başlıkları
olayların sırasını anlatır, güncel durumu DEĞİL.

---

## 0. PROTOKOL — değişmedi, pazarlıksız

1. **TEK TOOL, SONRA DUR.** Operatör "okey" demeden sıradakine geçilmez.
2. **İKİ KANAL.** Asistanın çağrısı + operatörün kendi testi. Çelişirlerse **çelişki yazılır**, biri seçilmez.
3. **DEFTERE YAZMADAN GEÇME.** Bulgu yoksa "bakıldı, bulgu yok" satırı yazılır.
4. **Her paralı çağrının önü/sonu:** `select dfs_spend_today_usd()`. Deftere **`actual_usd`** yazılır, `estimated_usd` DEĞİL.
5. **Her tool için ayrıca yazılır** (operatörün dalga 1'de eklediği format):
   **çalışma prensibi** · **panelde/sitede nasıl göründüğü** · **hangi komutların tetiklediği**.

### Dalga 1'de değişen tek kural

Dalga 1 "ölçüm turu, kod değişmez" diye başladı; operatör **2026-08-26'da düzeltme iznini verdi**
("%100 bitirmeden durma, izin onay isteme"). **O izin dalga 2'de de geçerlidir** — ölç, bul, düzelt,
kapıdan geçir, deftere yaz. **NEVER#10 hakemi operatör onayıyla askıya alındı** (hakemsiz devam).

---

## 1. DURUM — dalga 2 başlarken

| | |
|---|---|
| `origin/main` | **`499a2a0`** — dalga 1 buraya merge EDİLMEDİ |
| çalışma dalı | **`fix/smoke-turu-dalga-1`**, `origin`'e push edildi, **26 commit** |
| PR | **[#180](https://github.com/popiliadam/seogrep/pull/180)** · `OPEN` · `MERGEABLE` |
| deploy | dalga 1 **CANLIDA DEĞİL** — canlı sunucu hâlâ `499a2a0` |
| yüzey | **38 tool** (canlı `tools/list` ile doğrudan ölçüldü) |
| kredi bakiyesi | **4519** (dalga 1'de hiç kredi harcanmadı) |
| vendor | **$0,101 / $3,00** — dalga 1'de **tek paralı çağrı yapılmadı** |
| `MCP_SMOKE_URL` | ✅ çalışıyor (anahtar 2026-08-26 18:56'da yenilendi) |

### ⚠️ CANLI ile DALDAKİ kod FARKLI

Dalga 1'in düzeltmeleri **deploy edilmedi**. Yani:
- Canlı `list_projects` **GSC durumu / son iş basmaz** — dalda basar.
- Canlı `list_jobs` **ham uuid basar ve çelişkili zaman damgasını işaretlemez** — dalda etmez.
- Canlı `credit_ledger`'da **`project_id` kolonu YOKTUR** — migration 0033 uygulanmadı.

**Gezilen tool'da bir "kusur" görürsen ÖNCE dalda düzeltilmiş mi diye bak** — yoksa kapanmış bir
maddeyi yeniden bulgu diye yazarsın.

---

## 2. İLK ÜÇ ADIM

```bash
cd "/Users/apple/dev/pseo web saas"
git checkout fix/smoke-turu-dalga-1 && git pull --ff-only
curl -s https://mcp.seogrep.com/status
```

1. **Bağlantıyı doğrula:** basit bir 0-kredilik çağrı (`get_credit_balance`). `requires authentication`
   gelirse operatörün istemciyi yenilemesi gerekir — dalga 1'de iki kez oldu.
2. **Vendor tabanını ölç:** `select dfs_spend_today_usd()`.
3. **Defteri aç ve KAPANIŞ TABLOSUNU oku** (dosyanın sonu). Yeni bölümler oraya eklenir.

---

## 3. SIRADAKİ TOOL: `setup_project`

A bölümünün kalanı, sırasıyla:

`setup_project` → `whats_next` → `get_job_status` → `list_gsc_properties` → `track_gsc_property` →
`connect_gsc` → `track_keywords` → `untrack_project`

> `untrack_project` **en sona** bırakılır (arşivler).
> Sonra B (crawl/audit) → C (GSC) → D (SERP) → E (DFS) → F (backlink) → G (hız + AI) —
> önceki handoff §4'teki sıra ve fiyatlar aynen geçerli.

### `setup_project` için bilinen zemin (dalga 1'de ölçüldü, tekrar ölçme)

- `normalizeDomain` **`www.`'yi soyar** (`3b0009e`, 2026-08-25 21:27) → yeni apex/www çifti **açılamaz**.
- Route `@pseo/db/projects`'teki `openTrackedProject`'tir; panel **Add domain** formu **aynı** yolu kullanır.
- Reachability kontrolü **YAZMADAN SONRA** koşar — çözülmeyen alan adı kaydı engellemez, uyarır.
- 0 kredi.

---

## 4. AÇIK MADDELER — dalga 2'ye devreden

| # | madde | sahip | not |
|---|---|---|---|
| **G12** | `keyword_gap` + `link_gap` (45'er kredi) hiçbir okuma kaydı bırakmıyor, gerekçesi kodda da yazmıyor | kod | **O iki tool F bölümünde gezilecek** — kararı orada ver. `audit_speed:45-53` nasıl yazılacağının örneği |
| **G16b** | Panel tek aktif anahtara zorluyor (arka uç `MAX_ACTIVE_KEYS = 5`); her rotasyon çalışan istemciyi kırıyor | **operatör kararı** | Çok-anahtarlı yönetim arayüzü demek; sessizce inşa edilmedi |
| **I-1** | PR #180'in CI'ı hiç koşmadı — GitHub Actions olayı (critical, 15:11Z, "throttled inbound traffic") | operatör | Actions dönünce kendiliğinden koşar; koşmazsa PR'ı kapat/aç |
| **I-2** | `main` CI kırmızı: `verify-db`, `toomanyrequests` (Docker Hub imaj limiti). Diğer 5 job yeşil | operatör | **Re-run** et; yoksa sonraki `deploy-mcp` `require-ci`'da 25 dk bekleyip düşer |

### Merge + deploy — SIRA BAĞLAYICI

1. **Migration 0033 cloud'a uygulanır** (`packages/db/supabase/migrations/0033_credit_ledger_project_scope.sql`)
2. **`mcp` deploy** (yeni `reserve_credits` imzasını kullanan kod)
3. **`web` deploy** (`LedgerEntry.projectId` + `/app/projects/[id]`)

Ters sırada `mcp` var olmayan bir kolona yazar. Merge **merge-commit** ile (squash DEĞİL — gitleaks parmak izleri).

---

## 5. KAPILAR — dalga 1 sonu ölçümleri (taban)

| kapı | değer | NE ÖLÇMEZ |
|---|---|---|
| `TURBO_FORCE=1 bash guardrails/verify.sh` | **PASS** · mcp **3544** · web **1967** · core **323** · db 12 · 38 doküman senkron | **secret taraması YOK · DB şeritleri YOK** |
| `bash guardrails/verify-db.sh` | **PASS** · db 165 · mcp 491 · web 48 | canlı uç |
| `make goals` (env yüklü) | **16/16 (1 skip)** | kalan tek SKIP `dfs-budget-guard` (`DFS_LIVE`) |

`make goals`'u **tam** koşmak için:
```bash
eval "$(grep -E '^[[:space:]]*export[[:space:]]+(PROD_URL|MCP_SMOKE_URL)=' ~/.zshrc)" && make goals
```
Bu satır olmadan 5 SKIP verir ve **dalga 1'de tam bu SKIP iki gün boyunca kırmızı bir kalemi sakladı** (G17).

---

## 6. DALGA 1'İN PAHALIYA MAL OLAN TUZAKLARI

Önceki handoff §9'a **ek** olarak, bu turda ölçülenler:

1. **Bir arayüz adımını, arayüz kodunu okumadan tarif etme.** Operatöre "Generate key kullan" dendi;
   buton yalnız `activeKeyId === null` iken render ediliyor. Premis çürüdü — ve düzeltirken **iki
   gerçek bulgu** çıktı (maskelenmiş URL, 5-vs-1 anahtar).
2. **Yeşil kalan mutasyonu örtme, ekseni değiştir.** `gscConnected &&` korumasını silmek hiçbir şeyi
   kırmızıya döndürmedi — çünkü koşul ölüydü, garantiyi **sıralama** veriyordu. Doğru mutasyon
   **pozisyon** mutasyonuydu ve kırmızı verdi (imzalı ders 14).
3. **Bir spec yanlış sebeple yeşil geçebilir.** "Daha kısa" iddiası, bakiyeyi varsayılanda bırakınca
   **iki basamak farkıyla** geçiyordu. Karşılaştırdığın şeyi pinle.
4. **Kaynak-pin'lerini repoint et, soften etme.** Altı spec `page.tsx`'i yoldan okuyor; okuyucular
   taşınmadı, pin iki fonksiyona yayıldığında **iki adımın ikisi de** pinlendi.
5. **SKIP, PASS değildir.** `make goals` "16/16 PASS (5 skip)" derken üretim tool yüzeyini
   **hiçbir şey saymıyordu** (G17). Kapıyı NE ölçtüğüyle raporla.
6. **`verify-db` yerelde iki kez 502 sınıfı flake verdi** (`invalid response from upstream`, Kong).
   Tek başına yeniden koştur; taban da kırmızıysa senin değildir — **stash'leyip kanıtla**.
7. **Netlify tikleri CI değildir.** PR'da dört yeşil tik vardı ve hiçbiri kodu ölçmüyordu.

---

## 7. DOKUNULMAZ — önceki handoff §7 aynen geçerli

3 `not_measured` satır · 3 tracked keyword · `www.seogrep.com` / `noraninsaat.com` /
`www.noraninsaat.com` · `bu-domain-kesinlikle-yok-9f3a2c.com` (arşivde) · `example.net` ·
13 public rapor. **Hiçbiri silinmedi, silinmeyecek.**

> `example.net` dalga 1'de ayrıca **G5/G8'in canlı kanıtı** oldu: `gsc_connections` satırı var,
> `gsc_property` NULL — "bağlı ama hiçbir şey çekemez" durumunun tek örneği. **Bozma.**
