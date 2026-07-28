# Runbook — Google OAuth verification başvurusu

## ✅ SONUÇ — TAMAMLANDI (2026-07-28, tek günde)

Zincir: scope beyanı (Data Access; Console `webmasters.readonly`'yi non-sensitive sınıfladı →
veri-erişim incelemesi/video GEREKMEDİ) → marka onayı ilk tur RED (proje sahibi info@adstark,
seogrep.com'un SC sahibi değildi + isim-eşleşme yan-bulgusu) → DNS'siz çözüm: suleymanncapar@gmail
(verified-owner) SC Users&permissions'tan info@adstark'a **Owner** delegasyonu → re-verification
GEÇTİ → **Publish branding** (marka consent'te canlı) → Audience **PUBLISH APP → In production**.
Net kazanım: 7-gün refresh-token ölümü bitti · 100-kullanıcı sınırı kalktı · SeoGrep adı+logo
consent'te. Aşağısı süreç arşividir.

> Amaç: OAuth consent screen'i Testing → **In production** (PUBLISH) + **marka onayı** (brand
> verification). Neden acil: **Testing modda refresh token'lar 7 günde expire olur** — GSC
> bağlantıları her hafta kopuyor; PUBLISH bunu anında bitirir (inceleme sonucu beklenmez).
> Scope non-sensitive sınıfında olduğundan (aşağıda kanıt) veri-erişim incelemesi YOK; kalan tek
> inceleme marka onayı (günler mertebesi). Başvuru tıkları İNSAN işi; şef metinleri hazırladı.

## Kapsam gerçeği (koddan + Console'dan doğrulanmış)

- Tek scope: **`https://www.googleapis.com/auth/webmasters.readonly`** (`packages/core/src/gsc/client.ts:23`).
- **DÜZELTME (2026-07-28, Console Data Access ekranı kanıt):** Google bu scope'u artık
  **NON-SENSITIVE** sınıflıyor ("Your sensitive scopes: No rows"). Sonuç: veri-erişim incelemesi
  (demo video + scope gerekçesi isteyen süreç) BU APP İÇİN GEREKMİYOR; kalan yalnız (1) PUBLISH
  (Testing→In production — 7-gün token ölümünü bitiren adım, scope sınıfından bağımsız) ve
  (2) **marka onayı** (logo yüklendiği için; Verification Center → Submit).
- Aşağıdaki video senaryosu + gerekçe metni ARŞİV: Google ileride sınıfı değiştirir ya da ek bilgi
  isterse hazır. Restricted scope YOK → CASA hiçbir durumda gerekmez.

## Ön-koşullar — durum (2026-07-28)

| Gereksinim | Durum |
|---|---|
| Homepage canlı, app'i tarif ediyor | ✅ https://seogrep.com |
| Privacy Policy URL | ✅ https://seogrep.com/privacy |
| **Privacy'de Google API Services User Data Policy / Limited Use beyanı** | ✅ bu commit'le eklendi ("Google user data" bölümü) |
| Terms URL | ✅ https://seogrep.com/terms |
| Authorized domain doğrulaması | ⚠️ brand-check reddetti (2026-07-28): proje sahibi info@adstark, seogrep.com'un SC-sahibi DEĞİLDİ → Domain-property TXT (Netlify DNS) ile info@adstark'a bağlanıyor |
| Destek e-postası | ✅ support@seogrep.com |
| Demo video | ⏳ insan çeker (senaryo aşağıda) |

## İnsan adımları (Console tıkları, sırayla)

> **HESAP GERÇEĞİ (2026-07-28 teyitli):** Seogrep Cloud projesinin sahibi **info@adstark.com.tr**
> (eski kayıtlardaki "seogrep.app@gmail" YANLIŞ/yok). Tüm Console + Search Console-sahiplik işleri
> info@adstark ile yapılır. seogrep.com'un SC domain-doğrulaması da bu hesaba TXT ile bağlandı
> (brand-verification şartı). İki "seogrep" projesi tuzağı: doğrusu, Credentials'ında
> `https://seogrep.com/api/gsc/callback` redirect'li "seogrep-web" client'ı olan proje.

1. https://console.cloud.google.com → doğru proje (client "seogrep-web", hesap **info@adstark.com.tr**).
2. **APIs & Services → OAuth consent screen** (yeni adı: Google Auth Platform → Branding/Audience):
   - App name: `SeoGrep` · User support email: `info@adstark.com.tr` — DİKKAT: bu dropdown yalnız
     GİRİŞ YAPILAN hesabın adreslerini/gruplarını gösterir; support@seogrep.com bir Google hesabı
     değil (ImprovMX yönlendirmesi), burada ÇIKMAZ ve çıkmaması normaldir. Yanlış hesapla girildiyse
     (örn. kişisel gmail) sağ üstten proje sahibi hesaba (info@adstark.com.tr) geç — YENİ PROJE AÇMA, mevcut
     client canlı ürünü besliyor. · Logo yükle (512px; logo yüklemek brand review'u tetikler — normal).
   - App home page `https://seogrep.com` · Privacy `https://seogrep.com/privacy` · Terms
     `https://seogrep.com/terms` · Authorized domain `seogrep.com`.
   - Developer contact: `info@adstark.com.tr` + `support@seogrep.com` (Google yazışması bu ikisine gelir).
3. **Scopes** ekranında `../auth/webmasters.readonly` listede olduğunu teyit et (yoksa "Add or remove
   scopes" ile ekle; non-sensitive openid/email/profile de listede kalsın).
4. **Audience/Publishing status → PUBLISH APP** (Testing → In production) — token-ölümünü bitiren
   adım; incelemeden bağımsız, hemen yapılır.
5. **Verification Center → Submit** = MARKA onayı (logo/isim/domain-sahiplik). 2026-07-28 ilk tur
   bulguları: (a) seogrep.com sahipliği proje hesabında değil → SC Domain-property TXT'siyle
   info@adstark'a bağla; (b) isim-eşleşme uyarısı (muhtemelen a'nın yan etkisi). Düzeltince
   "I have fixed the issues → Request re-verification". Video/scope-gerekçesi bu akışta İSTENMEZ
   (arşivde hazır).
6. Google'dan gelen her e-postayı (ek bilgi/red/onay) şefe aynen yapıştır — cevap taslağını şef yazar.

## Yapıştırmalık — scope justification (EN)

```
SeoGrep is an SEO analysis service that users connect to their own AI assistant via MCP
(Model Context Protocol). The webmasters.readonly scope is requested only when a user
explicitly clicks "Connect Search Console" in their dashboard. We use it to read the
user's own Search Console data (search analytics queries, indexing status) for the
properties they select, solely to produce the SEO analyses and reports that the user
requests. Access is read-only by design — SeoGrep never requests permission to modify
a property. Refresh tokens are stored encrypted at rest; data is processed only on our
service infrastructure, is never used for advertising, is never sold, and is never used
to train AI models. Users can revoke SeoGrep's access at any time from their Google
Account permissions page, which invalidates the stored refresh token, and can request
deletion of the stored token by emailing support@seogrep.com.
```

## Demo video senaryosu (~2 dk, EN, unlisted YouTube; URL çubuğu HEP görünür)

1. https://seogrep.com açılır → kısaca ne olduğu söylenir (5 sn).
2. Sign in → dashboard → **/app/connection** sayfası.
3. "Connect Search Console" tıklanır → **Google consent ekranı**: app adı "SeoGrep" ve
   webmasters.readonly izin metni EKRANDA OKUNUR halde bekletilir (3-5 sn).
4. İzin verilir → app'e dönüş: bağlantı "connected" durumu gösterilir.
5. GSC verisinin KULLANIMI gösterilir: bir analiz/rapor çıktısında Search Console'dan gelen bölüm.
6. (Opsiyonel kapanış) myaccount.google.com/permissions sayfasında SeoGrep erişiminin listelendiği
   3 sn gösterilir (kullanıcı-taraflı iptal yolu). DİKKAT: üründe GSC-disconnect butonu YOK
   (2026-07-28 tespiti; küçük iş olarak backlog'da) — videoda ve formda disconnect İDDİA EDİLMEZ.

## Bekleme sırasında

- Ürün Testing modda çalışmaya devam eder (100 kullanıcı sınırı + 7-gün token ömrü sürer).
- Verification maili gecikirse (>2 hafta) Console'daki verification durum sayfasından ping'lenir.
- Redde en sık üç sebep: video'da consent ekranı/scope kullanımı görünmüyor · privacy URL'de Limited
  Use beyanı bulunamıyor · homepage-app ilişkisi belirsiz. Üçü de bu runbook'ta önceden kapatıldı;
  red gelirse maili şefe yapıştır.
