# Sertleştirme + Quick-Win Dilimi (Faz 3.5) — Fresh-Session Promptu

> Kaynak: Faz 0-3 audit raporu (KOŞULLU GO) + 2026-07-20 insan+şef beyin fırtınası.
> Bu dilim audit'in zorunlu koşullarını kapatır; **Faz 4 DEĞİLDİR** (go kararı insanın).
> Aşağıdaki bloğu taze oturuma AYNEN yapıştır.

---

```
Sen SeoGrep'in şef oturumusun. Görev: SERTLEŞTİRME + QUICK-WIN dilimi (Faz 3.5) — bağımsız audit'in
zorunlu koşullarını ve insan-onaylı hızlı kazanımları kapatmak. Bu FAZ 4 DEĞİL; Faz 4 go/no-go kararı
bu dilim bitince İNSANINDIR.

Proje: SeoGrep — hosted SEO MCP SaaS. Dizin: "/Users/apple/dev/pseo web saas"
SIRAYLA OKU: PLAN.md → CLAUDE.md → contract.md → docs/audits/2026-07-20-faz0-3-audit-raporu.md (TAMAMI —
bulguların kanıt/dosya:satır adresleri orada) → .superpowers/sdd/progress.md son bölümleri ("FAZ 4 ADAY
BACKLOG", "BACKLOG GUNCELLEME", "BACKLOG EK", "AUDIT RAPORU GELDI", "CRAWL-UX TASARIMI").

SÜREÇ: superpowers:subagent-driven-development — işçi Opus explicit; hakem TAZE model (Fable erişilebilirse
Fable; değilse Opus 4.8 ve sapma ledger'a yazılır); her task: brief → işçi → review-package → hakem →
fix dalgası → re-review; kapılar: verify.sh + verify-db.sh + make goals (PROD_URL=https://seogrep.com);
push/PR/merge İNSAN kapısı (Merge→Confirm→DELETE BRANCH). UI copy İngilizce (imzalı ders #4).
İlk iş: audit raporunu (docs/audits/2026-07-20-faz0-3-audit-raporu.md, untracked durumda) dokümantasyon
commit'iyle dala al.

GÖREV SIRASI (audit'in zorunlu koşulları önce):

T0 — KOORDİNE SECRET ROTASYONU (CRITICAL; İNSAN+ŞEF BİRLİKTE, kod işlerini BLOKLAMAZ — insan hazır
olduğunda araya alınır): tek turda döndür: (a) Supabase service key (yeni sb_secret üret; eskisini
devre dışı bırakmadan önce Netlify+Fly güncelle); (b) DB şifresi reset (SUPABASE_DB_URL yeniden kur —
session pooler 5432); (c) Google client secret (Add secret → iki taraf güncel → eskiyi sil);
(d) TOKEN_ENCRYPTION_KEY yeni 64-hex (gsc_connections canlıda 0 satır → bedava; Netlify+Fly AYNI değer
+ Netlify redeploy); (e) DataForSEO şifresi reset; (f) smoke key (sg_9wYke...) dashboard'dan Rotate.
Her adımda değerler İNSAN elinde kalır (chat'e yapıştırılmaz — geçen seferki maruziyetin dersi);
şef yalnız adım listesi verir, sonuçları flyctl secrets list digest-değişimi + canlı healthz/tools-list
smoke ile doğrular. Kanıt ledger'a.

T1 — SSRF SERTLEŞTİRME (Important-blocker): crawler'da fetch ÖNCESİ DNS çözümü + çözülen IP'yi
blocklist'e vur: loopback/RFC1918/link-local (169.254)/ULA (fc00::/7, Fly 6PN fdaa dahil)/CGNAT;
normalize aşamasında non-public TLD reddi (.internal, .local, .test vb.); fetchText'e emisyon-ÖNCESİ
aynı kontrol (manual-redirect paritesi — audit §1 Important, kod adresleri raporda). Testler: fake-resolver
injection ile RED→GREEN; mevcut 45 crawler testi DEĞİŞMEDEN yeşil. DNS-rebinding kapsamı belgelenir
(çözüm-pinning bu dilimde değilse açıkça yaz).

T2 — worker YORUM DÜZELTMESİ (Important-blocker, trivial): fly.toml + apps/mcp/src/index.ts'teki
"stub / keep scaled to 0" bayat yorumları gerçek durumla değiştir (worker = gerçek pg-boss tüketicisi,
0'a ÇEKİLMEZ). Davranış değişikliği yok.

T3 — GEÇERSİZ-KEY THROTTLE: auth yolunda DB-lookup ÖNCESİ per-IP token-bucket (format-gate sonrası);
429 yolu 0 DB okuması; testler (audit auth.ts:101 bulgusu). Fly-proxy alternatifi değerlendirilir,
karar gerekçesiyle ledger'a.

T4 — REAPER + RECONCILIATION RUNBOOK: stuck-job tespit SQL'i (progress'te var) + kurtarma adımları
scripts/reconciliation.md dosyasına; opsiyonel basit reaper (status='running' + eski started_at →
release + failed) İLK ÜCRETLİ KULLANICI ÖNCESİ şartını kapatacak asgari biçimde. Para yönü: release
muhafazakâr (payload yeniden-koşulur, çift-tahsilat imkânsız kalır — guard.ts disiplinine dokunma).

T5 — ASGARİ İZLEME: healthz'i genişlet (kuyruk derinliği + son-hata sayacı gibi ucuz sinyaller);
harici uptime kontrolü için insan-kurulum rehberi (ör. ücretsiz uptime servisi → healthz URL); 5xx
alarmı için Fly checks/log-tabanlı asgari yol. Amaç "mükemmel gözlemlenebilirlik" DEĞİL, beta için
kör-uçuşu bitirmek. Kapsam kararlarını gerekçeyle yaz.

T6 — G1: generate_report'a AUDIT BULGULARI: rapor modeli audit_onpage/tech/schema özet bölümlerini
içerir (en son audit sonuçları job zincirinden); XSS disiplini AYNEN (escape zinciri + link beyaz-liste);
"No basic on-page issues" yanılgısı biter (audit kanıtı: rapor sığ derken audit 42 canonical eksiği
bulmuştu). Kredi maliyeti DEĞİŞMEZ (15).

T7 — QUICK-WIN'LER: (a) G2: seogrep.com'a self-referencing canonical + sayfa-başı özgün meta
(5 sayfadaki 178-char dup meta bölünür) + JSON-LD (Organization + WebSite + SoftwareApplication);
(b) G3: landing header'a Sign in linki (/login); (c) G9: docs-generator description'ları ~155 char'a
kırpar (truncate + tam metin gövdede).

T8 — CRAWL-UX PAKETİ (insan-onaylı tasarım — "1200 kredili kullanıcı ilk taramada tüm kredisini
bitirmesin"): (a) crawl_site'a ÜCRETSİZ ön-keşif: sitemap/homepage'den sayfa-sayısı TAHMİNİ →
estimated_credits hesapla; (b) tahmin D17 eşiğini (>200 kredi) aşarsa MEVCUT requires_confirmation
kapısı devreye girer (YENİ mekanizma yazma — T13'ün registry eşiği hazır) ve yanıt ALTERNATİF önerir:
kapsam filtresi + örnekleme; (c) crawl_site şemasına opsiyonel include_paths (snake_case; ör.
["/blog"]) — filtre crawl'ı o path'lere sınırlar; (d) pricing + tools-reference'a kademeli-crawl
açıklaması. SINIR: fiyat RAKAMLARI DEĞİŞMEZ (100 sayfa=20 kredi kalır; >100 sayfa kademeleri AYRI
insan-onaylı karar — bu dilimde yalnız 100-cap + filtre + confirm + açıklama).

T9 — research_keywords BETA DURUŞU (KARAR MADDESİ — İNSANA SOR): seçenekler: (a) DFS_LIVE aç +
bütçe sayacını /tmp yerine DB tablosuna taşı (kalıcı-açılış şartı) — amiral tool canlanır;
(b) kapalı kalsın (dürüst hata sürer). İnsan seçmeden kod yazma; (a) seçilirse DB-sayaç migration
akışıyla (işçi SQL → hakem → cloud apply ŞEF + kanıt).

YAPMA: fiyat/kredi/paket rakamı değişikliği; Faz 4 büyük kalemleri (Scrapling fetcher, import_crawl,
10k-ölçek depolama/paralellik, DFS-derinlik araç ailesi, rank-tracking, izleme-platformu kurulumu) —
onlar Faz 4 planına (kaynak: ledger backlog 1-12 + audit G-tablosu). platinum-seo-engine SALT OKUNUR
(AGPL — kod satırı asla).

BİTİŞ: tüm kapılar yeşil + PR(ler) insan-merge + audit'in 5 zorunlu koşulunun kapanış KANITI ledger'a
+ PLAN.md güncelle (yeni handoff) + DUR: Faz 4 go/no-go İNSANA sunulur (audit raporu + kapanış kanıtları
yan yana). Faz 4 planını YAZMA — o, go kararından sonraki iş.
```
