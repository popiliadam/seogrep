# Faz 0-3 Codex Çapraz-Audit — Prompt (ikinci bağımsız denetçi)

> Amaç: Claude denetiminden BAĞIMSIZ ikinci görüş (farklı model ailesi). Tasarım: KÖR denetim
> (mevcut audit raporu en sona dek okunmaz) + paralel alt-agent paketleri + delta-karşılaştırma.
> Aşağıdaki bloğu Codex'e AYNEN yapıştır.

---

```
ROL: SeoGrep projesinin BAĞIMSIZ İKİNCİ DENETÇİSİSİN. Bu repo kısa süre önce başka bir AI tarafından
denetlendi; ÇAPA ETKİSİNİ ÖNLEMEK İÇİN o raporu (docs/audits/2026-07-20-faz0-3-audit-raporu.md) ve
onun türevlerini (2026-07-20-sertlestirme-dilimi-prompt.md) EN SON ADIMA KADAR AÇMA. Önce tamamen kör,
kendi denetimini yap; en sonda karşılaştır. İltimas yok: hiçbir beyana (kod yorumu, ledger iddiası,
plan metni) güvenme — her iddiayı kanıtla doğrula ya da "DOĞRULANAMADI" işaretle. Görevin yalnız
kod doğruluğu değil: GELİŞİM alanları, EKSİK yetenekler ve HATALI/riskli tasarımlar da birinci
sınıf denetim konusu.

PROJE: SeoGrep — hosted SEO MCP SaaS (yapay zekâ asistanlarına MCP üzerinden 16 SEO aracı satar;
kredi ekonomisi). Dizin: "/Users/apple/dev/pseo web saas". Monorepo: apps/web (Next 16, Netlify) ·
apps/mcp (Express+MCP, Fly.io Tokyo) · packages/core · packages/db (Supabase migrations 0001-0010).
Canlı yüzeyler: https://seogrep.com · https://mcp.seogrep.com/healthz

SINIRLAR (bağlayıcı):
- READ-ONLY: kodu DEĞİŞTİRME, commit/push YOK, canlı sistemde mutasyon YOK. Lokal test/kapı koşmak
  serbest (bash guardrails/verify.sh; verify-db.sh Docker+supabase CLI ister — çalışmazsa nedenini
  yaz, FAIL sayma).
- SECRET değeri hiçbir çıktıya yazılmaz; .env benzeri dosyalar okunursa yalnız AD düzeyinde raporlanır.
- CLAUDE.md'deki NEVER seti senin için de bağlayıcı (özellikle: ~/Documents/platinum-seo-engine
  SALT-OKUNUR; fiyat/kredi rakamlarına dokunulmaz — önerilerin tavsiye düzeyinde kalır).
- Canlı erişim gerektiren bir kontrolü yapamıyorsan (ağ yok / CLI auth yok) TAHMİN ETME:
  "CANLI DOĞRULANAMADI — gereken komut: X" diye işaretle. Public HTTP GET'ler (seogrep.com,
  mcp.seogrep.com/healthz) serbest. `flyctl` auth'lıysa yalnız READ komutları (status, secrets list
  — ad/digest düzeyi). Canlı DB'ye bağlanmaya ÇALIŞMA (bağlantı dizesi = secret).
- Canlı MCP araçlarını denemek istersen İNSANDAN geçici bir smoke URL iste; verilmezse bu kontrolü
  "insan-kapısı bekliyor" olarak işaretle ve atla.

KÖR OKUMA SIRASI (audit raporları HARİÇ her şey):
CLAUDE.md → contract.md → PLAN.md → docs/specs/2026-07-pseo-saas-design.md →
docs/plans/*.md → .superpowers/sdd/progress.md (TAMAMI — süreç+karar defteri) → goals/*.md →
guardrails/*.sh → kod ağacı.

ALT-AGENT PLANI — paralel iş paketleri (etkin delegasyon şart):
Her paketi ayrı alt-agent'a ver; her alt-agent'ın sözleşmesi AYNI: (i) yalnız kendi kapsamı,
(ii) HER bulgu için dosya:satır ya da komut+çıktı kanıtı, (iii) sınıf: Critical/Important/Minor/GOOD,
(iv) kanıtsız iddia YASAK — emin değilse "şüphe" diye işaretler, (v) kısa yapılandırılmış çıktı
(sentez sana ait). Paketler bağımsız — paralel koştur; uzun olanlara (C, H) öncelik ver.

[A] GÜVENLİK — RLS/tenant: migrations'ta her tabloda enable+FORCE izi; service-role kullanan her
    sorguda açık user_id filtresi (grep + örneklem okuma); cross-tenant negatif testlerin gerçekliği.
    SSRF: apps/mcp/src/crawler/* (robots/sitemap/fetch redirect zinciri; DNS-çözüm-sonrası IP kontrolü
    var mı; iç-TLD/özel-IP reddi; hangi istekler emisyon-öncesi korunuyor). SECURITY DEFINER
    fonksiyonları (search_path pinli mi, EXECUTE grant'ları). Auth yolu: apps/mcp/src/auth.ts (key
    hash'leme, rate-limit'in konumu — lookup'tan önce mi sonra mı, enumeration). Web: open-redirect,
    XSS (apps/mcp/src/report/html.ts escape zinciri), OAuth state/CSRF (apps/web/app/api/gsc/*).
    gitleaks config kapsamı.
[B] PARA DOĞRULUĞU — credit_ledger append-only zırhı (0002 trigger+grant); bakiye=SUM(ledger)
    tek-yol mu (credit_balances view; app-side delta-toplama kalıntısı grep); reserve→commit/release
    hata-yolu (apps/mcp/src/credits/guard.ts — commit-fail'de release EDİLMEMESİ dahil her dalı yargıla);
    çifte-tahsilat kapıları (surface/worker/handler ChargeMode ayrımı); webhook idempotency
    (apps/web/app/api/paddle/webhook — imza, event_id PK, processed_at kurtarma, advisory lock);
    kredi rakamlarının tek-kaynaklılığı (costs.ts ↔ docs ↔ pricing bayt-tutarlılığı).
[C] TEST GERÇEKLİĞİ + KOD KALİTESİ — En derin paket. Para/auth/crawler/XSS/webhook testlerinden
    en az 15'ini SATIR SATIR oku: assert'ler gerçek davranışı mı sınıyor, mock-karşı-mock mu; vakum
    testi (hiçbir şeyi sınamayan) var mı; .skip/.only kalıntısı; git log'da test-zayıflatma deseni
    (testi değiştirerek yeşile çekme); property-test'lerin üreteç kapsamı. Kod: hata yutma, ölü kod,
    tip kaçakları (as any), 800+ satır dosyalar, tutarsız desenler.
[D] DEPLOY/CI/ENV — workflows (SHA-pin, secret akışı, permissions); Dockerfile (multi-stage, non-root,
    core build zinciri); fly.toml (processes, health check, [env]); verify/verify-db/CI temiz-checkout
    eşdeğerliği (lokal-yeşil/CI-kırmızı sınıfı maskeler); deploy tetikleyici path'leri imaj girdileriyle
    eşleşiyor mu (pnpm-lock? tsconfig.base?); env sözleşmesi: env okuyan her kod GERÇEK prod adlarıyla
    negatif testli mi (apps/mcp/src/env.ts deseni her yerde uygulanmış mı).
[E] DOCS DÜRÜSTLÜĞÜ + VİTRİN — canlı seogrep.com metinleri vs gerçek davranış (uydurma metrik/yorum
    yasağı); tools-reference otomatik üretim zinciri (gen-tool-docs.mjs --check gerçekten drift'i
    yakalar mı — kapının kendisini test et: hangi drift sınıfı KAÇAR?); pricing tutarlılığı; kurulum
    rehberlerinin (5 client) uygulanabilirliği.
[F] LİSANS/AGPL — ~/Documents/platinum-seo-engine (AGPLv3, SALT-OKUNUR) erişilebilirse: 3+ satır
    birebir/yakın-birebir blok taraması (crawler/audit/report modülleri); erişilemiyorsa "yapılamadı"
    işaretle. Bağımlılık lisans ağacı (package.json'lar — copyleft var mı; pg-boss, paddle-sdk,
    googleapis, MCP sdk).
[G] OPERASYONEL BORÇ ENVANTERİ — progress.md'deki TÜM "Minor (final triage)" / "follow-up" /
    "backlog" / "İMPORTANT (süreç)" kayıtlarını topla; her biri için kod-durumunu doğrula
    (kapanmış mı, hâlâ açık mı); açıklara Faz-4-öncesi-mi hükmü ver. Runbook envanteri
    (scripts/*.md): eksik runbook hangileri (stuck-job, DR, incident)?
[H] ÜRÜN/GELİŞİM (raporun ≥1/3'ü — "neler eksik, neler hatalı tasarlanmış, neler olsa daha iyi"):
    (h1) Araç yüzeyi: 16 tool gerçek bir SEO iş akışının nesini kapsıyor/kapsamıyor (rakip analizi,
    backlink, rank tracking, CWV/hız, iç-link grafı, zamanlanmış tarama, bildirim, import/export);
    tool ÇIKTILARININ LLM-client kalitesi (structured vs prose, hata mesajlarının yönlendiriciliği,
    whats_next mantığı — kodu oku). (h2) Kredi-UX: kullanıcı sürpriz maliyet yaşayabilir mi (onay
    eşiği, tahmin, kapsam filtresi); ilk-değer süresi (signup→ilk rapor kaç adım?). (h3) Webapp:
    dashboard'da eksik ekranlar (rapor yönetimi/silme, kullanım grafiği, çoklu key, GSC durum);
    landing→signup funnel kopuklukları. (h4) Beta/operasyon: izleme-alarm, rate-limit, abuse,
    kuyruk-kurtarma, yedekleme/DR, destek kanalı. (h5) Ölçek mimarisi: 10k+ sayfa senaryosunda
    depolama (jobs.result jsonb), paralellik, ilerleme takibi — bugünkü tasarım nerede kırılır?
    HER öneri: gözlem-kanıtı + ETKİ(yüksek/orta/düşük) × ÇABA(küçük/orta/büyük) + kova
    (QUICK-WIN / STRATEJİK / ERTELENEBİLİR).
[I] SÜREÇ KANITI — progress.md zinciri: işçi→hakem→fix→re-review düzeni tutarlı mı; hakem kararları
    ile kod gerçeği örtüşüyor mu (2 örnekte spot-check); model-sapması kayıtları (Fable→Opus dilimi)
    dürüst mü; "done" iddiaları makine-kanıtlı mı.

SENTEZ (sen yaparsın, alt-agent'a devretme):
1. Paket çıktılarında dedup + çelişki çözümü (iki paket aynı bulguyu farklı sınıflamışsa gerekçeyle karar).
2. Sınıflandırma disiplini: Critical = para/veri/secret/tenant ihlali ya da canlıyı kıran; Important =
   güvenilmez/riskli davranış ya da beta-blocker; Minor = kalite/polish. Şüpheler ayrı listede.
3. GO/NO-GO: canlı para + beta davetleri için koşullu hüküm; koşullar madde madde, sıralı.

ÇAPRAZ KARŞILAŞTIRMA (EN SON ADIM — ancak sentez bittikten sonra):
Şimdi docs/audits/2026-07-20-faz0-3-audit-raporu.md dosyasını AÇ ve OKU. Delta raporu yaz:
(1) Onun bulup SENİN kaçırdıkların — her biri için "haklı/haksız + neden kaçırdım";
(2) SENİN bulup onun kaçırdıkları — ikinci denetimin katma değeri;
(3) Çelişen hükümler (sınıf farkı, GO-koşulu farkı) — hakem gerekçenle senin nihai hükmün;
(4) İki denetimin BİRLEŞİK zorunlu-koşul listesi (tek, sıralı, uygulanabilir).

ÇIKTI: docs/audits/2026-07-20-faz0-3-codex-audit-raporu.md (Türkçe) — format:
# Faz 0-3 Codex Çapraz-Audit Raporu — 2026-07-20
## Yönetici özeti (≤12 satır: en kritik 3 bulgu + en değerli 3 gelişim önerisi + hüküm)
## Paket raporları A-I (bulgu: kanıt + sınıf + öneri; GOOD'lar dahil — doğrulanan güçlü yanlar da yazılır)
## Gelişim değerlendirmesi (H — doyurucu: öneri tablosu etki×çaba×kova + sıralı aday backlog)
## Doğrulanamayanlar (neden + gereken erişim/komut)
## Çapraz karşılaştırma (delta: kaçırdıkları/kaçırdıkların/çelişkiler + BİRLEŞİK koşul listesi)
## GO/NO-GO (koşullu ise koşullar sıralı)
Rapor bitince DUR — hiçbir düzeltme başlatma; uygulama kararları insanındır.
```
