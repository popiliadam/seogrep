# Runbook — Google OAuth verification başvurusu

> Amaç: OAuth consent screen'i Testing → **In production** + sensitive-scope doğrulaması.
> Neden acil: **Testing modda refresh token'lar 7 günde expire olur** — GSC bağlantıları her hafta
> kopuyor. Verification tamamlanınca hem bu biter hem "unverified app" uyarı ekranı kalkar hem
> 100-test-kullanıcı sınırı kalkar. Başvuru tıkları İNSAN işi; şef metinleri hazırladı (aşağıda).
> Süre beklentisi: brand doğrulaması günler; sensitive-scope incelemesi tipik ~3-7 iş günü,
> haftalara uzayabilir. İnceleme sürerken ürün Testing modda çalışmaya devam eder.

## Kapsam gerçeği (koddan doğrulanmış)

- Sensitive scope: **`https://www.googleapis.com/auth/webmasters.readonly`** — tek sensitive scope
  (`packages/core/src/gsc/client.ts:23`). Restricted scope YOK (Gmail/Drive yok) → güvenlik denetimi
  (CASA) GEREKMEZ, standart verification yeter.
- Sign-in tarafı (Supabase Auth üzerinden `openid email profile`) non-sensitive; incelemeye takılmaz.

## Ön-koşullar — durum (2026-07-28)

| Gereksinim | Durum |
|---|---|
| Homepage canlı, app'i tarif ediyor | ✅ https://seogrep.com |
| Privacy Policy URL | ✅ https://seogrep.com/privacy |
| **Privacy'de Google API Services User Data Policy / Limited Use beyanı** | ✅ bu commit'le eklendi ("Google user data" bölümü) |
| Terms URL | ✅ https://seogrep.com/terms |
| Authorized domain doğrulaması | ✅ seogrep.com (Search Console TXT, Faz 3) |
| Destek e-postası | ✅ support@seogrep.com |
| Demo video | ⏳ insan çeker (senaryo aşağıda) |

## İnsan adımları (Console tıkları, sırayla)

1. https://console.cloud.google.com → doğru proje (client "seogrep-web", hesap seogrep.app@gmail).
2. **APIs & Services → OAuth consent screen** (yeni adı: Google Auth Platform → Branding/Audience):
   - App name: `SeoGrep` · User support email: `support@seogrep.com` · Logo yükle (512px; logo
     yüklemek brand review'u tetikler — normal).
   - App home page `https://seogrep.com` · Privacy `https://seogrep.com/privacy` · Terms
     `https://seogrep.com/terms` · Authorized domain `seogrep.com`.
   - Developer contact: seogrep.app@gmail **+ support@seogrep.com** (Google yazışması buraya gelir).
3. **Scopes** ekranında `../auth/webmasters.readonly` listede olduğunu teyit et (yoksa "Add or remove
   scopes" ile ekle; non-sensitive openid/email/profile de listede kalsın).
4. **Audience/Publishing status → PUBLISH APP** (Testing → In production). Sensitive scope olduğu
   için Console verification'a yönlendirir → **Prepare for verification** akışını başlat.
5. Verification formu: scope gerekçesi + demo video linki iste(ye)cek → aşağıdaki hazır metinleri
   yapıştır, video linkini ekle → **Submit**.
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
to train AI models. Users can disconnect at any time from their dashboard, which
deletes the stored token.
```

## Demo video senaryosu (~2 dk, EN, unlisted YouTube; URL çubuğu HEP görünür)

1. https://seogrep.com açılır → kısaca ne olduğu söylenir (5 sn).
2. Sign in → dashboard → **/app/connection** sayfası.
3. "Connect Search Console" tıklanır → **Google consent ekranı**: app adı "SeoGrep" ve
   webmasters.readonly izin metni EKRANDA OKUNUR halde bekletilir (3-5 sn).
4. İzin verilir → app'e dönüş: bağlantı "connected" durumu gösterilir.
5. GSC verisinin KULLANIMI gösterilir: bir analiz/rapor çıktısında Search Console'dan gelen bölüm.
6. Kapanış: "Access is read-only; users can disconnect anytime" — disconnect butonu gösterilir.

## Bekleme sırasında

- Ürün Testing modda çalışmaya devam eder (100 kullanıcı sınırı + 7-gün token ömrü sürer).
- Verification maili gecikirse (>2 hafta) Console'daki verification durum sayfasından ping'lenir.
- Redde en sık üç sebep: video'da consent ekranı/scope kullanımı görünmüyor · privacy URL'de Limited
  Use beyanı bulunamıyor · homepage-app ilişkisi belirsiz. Üçü de bu runbook'ta önceden kapatıldı;
  red gelirse maili şefe yapıştır.
