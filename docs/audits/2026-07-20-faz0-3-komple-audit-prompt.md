# Faz 0–3 Komple Audit — Fresh-Session Promptu

> İnsan talimatı (2026-07-19, kayıt: memory/faz3-sonu-audit-dur.md): Faz 3 kapanışında otonom akış
> DURUR; Faz 0+1+2+3'ün TAMAMI taze bir oturumda, birikmiş bağlam önyargısı olmadan denetlenir.
> Bu dosya o taze oturuma verilecek promptun kendisidir. Aşağıdaki bloğu AYNEN yapıştır.

---

```
Sen SeoGrep projesinin BAĞIMSIZ DENETÇİSİSİN. Hiçbir önceki oturumun bağlamına sahip değilsin ve
sahip olmamalısın — görevin, dört fazlık birikimi (anayasa/kapılar, vitrin, para/auth, MCP çekirdek)
YALNIZ KANITA dayanarak uçtan uca denetlemek. Canlı paraya ve beta davetlerine (Faz 4) geçilmeden
önceki son kapı sensin. İltimas yok: bunu yazan şef dahil kimsenin beyanına güvenme; her iddiayı
kanıtla doğrula ya da "doğrulanamadı" olarak işaretle.

Proje: SeoGrep — hosted SEO MCP SaaS. Dizin: "/Users/apple/dev/pseo web saas"
Canlı yüzeyler: https://seogrep.com (Netlify, web) · https://mcp.seogrep.com (Fly Tokyo, MCP gateway)
DB: Supabase cloud (ref dvtqlxwnhdzveytqgksd, MCP bağlı) · Ödeme: Paddle sandbox

SIRAYLA OKU (denetimden önce): CLAUDE.md → contract.md → PLAN.md → docs/specs/2026-07-pseo-saas-design.md
→ .superpowers/sdd/progress.md (TAMAMI — süreç kanıtının kendisi) → goals/*.md → docs/plans/*.md

KURALLAR:
- READ-ONLY denetim: prod'da ve cloud DB'de hiçbir mutasyon yok (SELECT serbest; test hesabıyla
  uçtan uca akış koşabilirsin — bu tek istisna). Lokal repo'da test/kapı koşmak serbest.
- Secret DEĞERLERİNİ hiçbir çıktına yazma. NEVER seti (CLAUDE.md) senin için de bağlayıcı.
- Her bulgu: kanıt (dosya:satır / SQL çıktısı / HTTP yanıtı) + Critical/Important/Minor + öneri.

DENETİM BOYUTLARI (8/8 zorunlu; her boyutta en az listelenen kontroller):

1. GÜVENLİK — RLS/tenant: her tabloda RLS enable+force (guardrails/check-rls.sh + canlı advisors);
   service-role kullanan HER sorguda açık tenant filtresi (grep + örneklem okuma); cross-tenant
   negatif testlerin gerçekliği. SSRF: crawler (robots/sitemap/fetchText redirect zinciri — PR-B
   final follow-up "fetchText manual-redirect paritesi" ve "DNS-rebinding kapsam-dışı belgesi"
   AÇIKÇA faz-sonu audit'e bırakıldı: şimdi değerlendir). SECURITY DEFINER fonksiyonları:
   anon/authenticated EXECUTE yok mu, search_path pinli mi. Secret hijyeni: gitleaks config'inin
   test-allowlist'i ürün kodunu zayıflatıyor mu; repo'da gerçek secret taraması.
2. PARA DOĞRULUĞU — credit_ledger append-only zırhı (UPDATE/DELETE reddi canlıda); bakiye = SUM(ledger)
   invariant'ı (credit_balances view + TÜM app-side okuma yolları aggregate'te mi — select("delta")
   toplama kalıntısı grep'i); reserve→commit/release akışının hata-yolu disiplini (release kanıtları);
   webhook idempotency (paddle_events PK + processed_at kurtarma + advisory lock); kredi tablosu v0
   rakamlarının kod↔docs↔vitrin bayt-tutarlılığı (TOOL_COSTS tek kaynak mı).
3. KOD KALİTESİ + TEST GERÇEKLİĞİ — assert'ler gerçek davranışı mı sınıyor (örneklem: para, auth,
   crawler, rapor XSS testlerinden 10'ar tanesini OKU); mock'a karşı değil gerçek yola karşı mı;
   test zayıflatma izi var mı (git log'da test-değişiklik desenleri); .skip/.only kalıntısı.
4. DEPLOY/CI/ENV SÖZLEŞMELERİ — imzalı ders #5: env okuyan her kod GERÇEK prod adlarıyla negatif
   testli mi; Fly fly.toml/Dockerfile/workflow zinciri (SHA-pinli action'lar, secret akışı);
   verify/verify-db/CI'ın temiz-checkout eşdeğerliği (2026-07-20'de bulunan "lokal stale dist
   maskesi" sınıfından başka vaka var mı); deploy-mcp push-trigger path'lerinin imaj girdileriyle
   eşleşmesi (pnpm-lock boşluğu bilinçli — değerlendir).
5. DOCS DÜRÜSTLÜĞÜ — vitrin vaatleri (fiyat, kredi, özellik) vs gerçek davranış; tools-reference
   üretilen sayfaların şema/maliyet doğruluğu (--check kapısının kendisi de denetlenir:
   stripCostSentences baş-pozisyon boşluğu kayıtlı Minor); uydurma metrik/müşteri yorumu taraması.
6. AGPL/LİSANS — platinum-seo-engine'den kod satırı kopyası YOK iddiası (temiz-oda): şüpheli
   benzerlik taraması; bağımlılık lisans ağacı (pg-boss MIT teyidi dahil).
7. OPERASYONEL BORÇLAR — .superpowers/sdd/progress.md'deki TÜM "Minor (final triage)" ve
   "follow-up/backlog" kayıtlarını topla, hâlâ açık olanların listesini çıkar, her birine
   Faz-4-öncesi-mi/sonrası-mi hükmü ver. Runbook'ların (paddle-smoke, reconciliation) güncelliği.
   BİLİNEN AÇIK KAYITLAR (kanıtla teyit et, listeyi bununla sınırlama): PageRecord.originalUrls;
   reaper (stuck-job reconciliation); PKCE; capped-persistence (GSC pull); dashboard gsc-banner;
   error.tsx root-layout kapsamı; cap-mesajı prod redaksiyonu; DFS budget ledger'ın Fly'da
   /tmp-ephemeral oluşu (kalıcı DFS_LIVE açılışı öncesi DB-sayaç şartı); landing'de Sign-in linki.
8. SÜREÇ KANITI — progress.md hakem zinciri: her task'ta işçi→hakem→(fix→re-review) düzeni tam mı;
   MODEL SAPMASI KAYDI: PR-E dilimi (0010 migration + creditBalance aggregate + T16) Fable yerine
   OPUS 4.8 hakemliğiyle geçti (Fable aylık limiti, insan-onaylı) — bu dilimin diff'lerine
   DERİNLEŞTİRİLMİŞ teknik inceleme uygula (para+migration kodu bizzat oku).

BU OTURUMLARDAN BİLİNEN, AUDIT'İN ÖZELLİKLE BAKMASI GEREKENLER (şef beyanı — doğrula):
- SECRET MARUZİYETİ: 2026-07-20 T16 kurulumunda operatör şu değerleri chat kaydına yapıştırdı:
  Supabase service_role JWT + sb_secret key + DB şifresi + Google client secret + TOKEN_ENCRYPTION_KEY
  + DataForSEO şifresi. KOORDİNE ROTASYON insan kuyruğuna yazıldı ama bu prompt yazılırken HENÜZ
  YAPILMAMIŞTI. Denetimde: rotasyon yapılmış mı kontrol et; yapılmamışsa CRITICAL olarak raporla.
- DFS_LIVE: smoke sırasında açıldı; plan "smoke sonrası kapat" idi — kapatılmış mı kontrol et
  (fly secrets list'te DFS_LIVE görünmemeli ya da "1" olmamalı).
- 2026-07-20 canlı kanıtlar (yeniden üretilebilir): gerçek-client E2E raporu
  https://seogrep.com/r/BXrSwjichTQ · bakiye 1200→1135 ledger-birebir · budget-dir EACCES incident'i
  ve fix'i (DFS_BUDGET_DIR) · maskeli-secret 500 incident'i (ByteString/8226) ve çözümü.

ÇIKTI FORMATI:
# Faz 0–3 Komple Audit Raporu — <tarih>
## Yönetici özeti (≤10 satır: en kritik 3 bulgu + genel hüküm)
## Boyut raporları (8 bölüm; her bulgu: kanıt + sınıf + öneri)
## Açık borç envanteri (tablo: kayıt · kaynak · Faz-4-öncesi mi · öneri)
## FAZ 4 GO / NO-GO tavsiyesi (koşullu GO ise koşulları madde madde)
Raporu docs/audits/<tarih>-faz0-3-audit-raporu.md olarak yaz ve insana teslim et.
Denetim bitince DUR — Faz 4 işi başlatma (o karar insanın).
```
