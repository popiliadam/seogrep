# 2026-08-26 audit'inin remediation kapanışı

> Tarih: 2026-08-27 (Europe/Istanbul) · Dal: `fix/audit-2026-08-26-remediation`
> Kaynak rapor: `docs/audits/2026-08-26-full-repository-and-tool-audit.md` (3 yüksek · 8 orta · 10 düşük)
> Kapı: `guardrails/verify.sh` — bu dalda **PASS**, her dilimden sonra yeniden koşuldu

## 0. Bu belge neyi iddia ediyor, neyi etmiyor

**İddia:** aşağıda "kapandı" yazan her kalem KODDAN ölçüldü ve çoğunda kapının bozulunca gerçekten
kırmızıya döndüğü mutasyonla kanıtlandı. **İddia etmiyor:** üretimde doğrulandığını. Bu dal
merge/deploy edilmedi; canlı doğrulama gerektiren satırlar §4'te ayrıca duruyor.

Tur, izole worktree'de koştu (imzalı ders 8): ana çalışma ağacında paralel bir oturum aktifti ve
oturum sırasında iki commit düştü.

## 1. Audit'in bulgularının doğrulanması

Kapatmadan önce 21 bulgunun 14'ü koddan yeniden ölçüldü. **12'si tuttu, biri defektliydi, biri
yeni bulgu değildi.**

| bulgu | ölçüm |
|---|---|
| M-01 M-02 M-03 L-04 L-09 | **birebir** — exit kodu, rakamlar, tool listesi rapordakiyle aynı |
| H-01 H-03 M-04 M-07 L-01 L-02 L-05 L-10 | doğrulandı |
| **M-05** | **DEFEKTLİ** — §3 |
| **L-06** | doğru, ama **yeni bulgu değil**: 2026-08-17'de iki ayrı planda P2 borç olarak kayıtlı |

Üç kalem rapordan **daha ağır** çıktı:

- **H-03** — path filtresi eksikti, ama workflow'un kendi yorumu da bayattı (*"the workspace package
  the image builds (@pseo/core)"*, tekil). Filtreyi genişletip yorumu bırakmak, bir sonraki okuru
  aynı sonuca götürürdü.
- **M-04** — bir eksiklik değil, YAZILI bir kuralın ihlali: `lib/mcp-endpoint.ts`'in başlığı zaten
  *"asla hardcode edilmez"* diyor.
- **L-09** — audit yalnız yeni test dosyasını gördü. Yazılan guard, `main`'de **iki üretim modülü**
  daha buldu; ikisi de `data` olarak sınıflanıyor, yani **gitleaks'in atladığı sınıfta** — ve
  gitleaks zorunlu bir kontrol.
- **M-08** — audit "0033 journal'da yok" diyordu. Prod'da ölçüldü: **on iki sürüm** eksik (0022–0033).

## 2. Kapanan kalemler

Onaltı commit, `origin/main` üzerine 39 dosya, +1932/−269.

| # | ne yapıldı | kapıya bağlandı mı |
|---|---|---|
| **H-03** | `packages/db/**` deploy trigger'ına eklendi + bayat yorum düzeltildi | ✅ `check-deploy-paths.mjs` (self-test 6/6 + gerçek depoda mutasyon) |
| **M-01** | 3 ücretsiz salt-okunur tool PLAN'a, 16'sı gerekçeli EXCLUDED'a; `EXCLUDED` gerekçesi artık ZORUNLU | ✅ `verify.sh` artık `--self-test` koşuyor (7/7) |
| **M-02** | prod ağacı **17 → 0** advisory | ✅ CI `advisories` job'ı |
| **M-04** | iki pazarlama sayfası paylaşılan şablona bağlandı | ✅ render testi, şablon kaydırılınca kırmızı |
| **M-07** | `tools-reference/index.mdx` — **üretilen** hub; 404 kapandı, sitemap 68→69 | ✅ `--check` bayt karşılaştırması |
| **M-08** | 12 eksik sürüm ölçüldü, şema doğrulandı, onarım hazırlandı | ✅ self-test kapıda; canlı yarı `make goals` |
| **L-01 L-02 L-03 L-05 L-06 L-07 L-08 L-09 L-10** | §2 tablosundaki commit'ler | çoğu testli — ayrıntı commit mesajlarında |

Her mutasyon fiilen koşuldu, ve **biri hipotezimin yanlış olduğunu gösterdi**: "override'ı kaldır"
advisory'yi geri getirmedi (lockfile aralığı sağlayan sürümü korur); gerçek prob açıklı sürümü
zorla pinlemekti. İmzalı ders 13'ün canlı örneği.

**Kendi testimde bir delik de mutasyonla çıktı:** hub'ın "maliyete göre bölüyor" testi, fixture'da
ilk tool zaten ücretsiz olduğu için `free = rows.slice(0,1)` mutasyonuna yeşil kalıyordu. Fixture,
ücretsizler prefix OLMAYACAK şekilde yeniden sıralandı. İmzalı ders 14.

## 3. M-05 — reddediliyor, gerekçesiyle

Audit: *"`keyword_gap` ve `link_gap`'in sibling DFS tool'larındaki `subject_lookup_runs` benzeri
kaydı yok ve bu istisna gerekçelendirilmemiş."*

**Önerme yanlış.** `subject_lookup_runs`, migration 0032'nin **DB CHECK'iyle** tam üç tool'a bağlı:

```sql
tool text not null constraint subject_lookup_runs_tool_check check (
  tool in ('discover_keywords', 'ai_visibility', 'ai_visibility_compare')
)
```

Migration'ın kendi yorumu: *"a fourth tool writing here fails at INSERT rather than leaking in,
which is what 0031 had to widen **deliberately** when four more tools earned 0027's table."*
Kod tarafında `SubjectLookupTool` üç değerli bir union — dördüncüsü DB hatasından önce **derleme
hatası**.

Yani bu iki tool bir kalıbın istisnası değil: **26 ücretli tool'un 23'ü** bu tablonun dışında ve
tabloya girmek "hak edilen" bir genişletme. Audit, 23 katılımcı-olmayandan ikisini seçip istisna
ilan etmiş.

Geriye kalan geçerli tortu çok daha zayıf ve çok daha geniş — ve **imza gerektirir**: *hangi ücretli
tool'un denetlenebilir iz bırakacağına dair yazılı bir ürün kararı yok.* İki tool'luk bir düzeltme
olarak kapatılmamalı.

## 4. Açık kalanlar

### İzin katmanı reddettiği için operatörde (ikisi de hazır, komutları yazılı)

- **M-08 onarımı** → `docs/runbooks/migration-journal-repair.md`. Şema doğru, 12 sürümün nesneleri
  tek tek doğrulandı; yazma üretim veritabanına olduğu için reddedildi ve bu doğru sonuç.
- **M-03 + L-04** → `docs/runbooks/branch-protection-apply.md` + `branch-protection.json`.
  Tek komut. **Not:** `advisories` bilerek required listesine konmadı — job henüz `main`'de yok,
  şimdi zorunlu kılmak her PR'ı kilitlerdi. Bu PR merge olduktan SONRA eklenmeli.

### İnsan imzası gerektiren

- **H-01** — AI visibility bütçe üst sınırı. Ölçüldü ve doğrulandı: `llm-mentions.ts:206-212` bunu
  ZATEN itiraf ediyor (*"THE PRICING DOCTRINE ABOVE IS NOW UNPROVEN AND NEEDS A HUMAN"*), ama aynı
  dosyanın `estimateLlmMentionsUsd`'si hâlâ `targets × rowsPerTarget` kullanıyor; compare için üst
  sınır `$1.65` olarak hesaplanıyor. **Bu bir kod düzeltmesi değil, fiyat kararı** (NEVER #6) ve
  vendor'dan billable-row üst sınırı olmadan hiçbir yön doğru değil. Ücretli AI smoke bloklu kalıyor.
- **M-05** — §3: reddedilsin ya da "23 ücretli tool'un iz politikası" olarak yeniden yazılsın.
- **L-10'un ikinci yarısı** — `script-src`/`connect-src`. Nonce işi + ÇALIŞAN uygulamada doğrulama
  ister; yanlış bir `connect-src` altında kırılan login tam kesintidir. `form-action 'self'`
  ölçülmüş gerekçeyle **kasten** eklenmedi: `billing/actions.ts:103` bir form gönderimini Paddle'a,
  yani çapraz-origin'e yönlendiriyor.

### Yapısal olarak kapatılamayan

- **M-06** — Paddle live açılmadan gerçek para E2E ölçülemez.

## 5. Bu turun bulduğu, audit'te olmayan üç şey

1. **İki üretim modülü gitleaks'in görüş alanı dışındaydı** (`apps/mcp/src/audit/rules/schema.ts`,
   `packages/core/src/content/title-query-match.ts`) — literal NUL yüzünden `data` sınıflanıyorlardı.
2. **`EXCLUDED` mekanizması bir kaçış deliğiydi.** Başlığı "with a written reason" diyordu ama
   `assertCoverage` yalnız `Object.keys()`'e bakıyordu: `{ tool: undefined }` kapıyı yazılı bir
   gerekçe kadar iyi susturuyordu.
3. **Panel nav'ı klavyeyle erişilemiyordu** (WCAG 2.1.1). Audit yalnız görsel scroll ipucunu gördü;
   odak alamayan kayan bir bölge işaretleyici olmadan kaydırılamaz.

Ayrıca **kontrol edildi ve temiz** (bulgu değil): `credit_balances` bir VIEW, `security_invoker=true`,
`anon`'un SELECT hakkı yok — görünen TRUNCATE/REFERENCES/TRIGGER grant'leri view üzerinde işlevsiz
Postgres varsayılanları.

## 6. CLAUDE.md ders 16 düzeltmesi

Ders 16 "branch protection *eksik*" iddiasını **kapanmış bayat bir iddia** olarak listeliyor.
GitHub API'sinden ölçüldü:

- **check ekseni kapanmış** ✓ — 5 required context, strict, enforce_admins açık
- **onay ekseni hiç kapanmamış** ✗ — `required_approving_review_count: 0`

Kapanış, **hangi eksende ölçüldüğü yazılmadan** ilan edilmiş. Bu tam olarak **ders 14**'ün tarif
ettiği hata; ders 16, ders 14'ün ihlali üzerine kurulmuş. Ayrıntı:
`docs/runbooks/branch-protection-apply.md`.

## 7. Kapanış hükmü

Audit'in 21 bulgusundan **13'ü kapandı ve kapıya bağlandı**, 2'si operatörün tek komutunu bekliyor,
3'ü insan imzası istiyor, 1'i (M-05) reddedildi, 1'i (M-06) yapısal olarak kapatılamaz, L-10 yarım
kapandı — ve yarımlığı kodda adıyla yazılı.

Bu **release-ready hükmü değildir.** Kaynak raporun §13'ündeki kapanış kriteri hâlâ H-01'i ve
38/38 paid happy-path'i istiyor; ikisi de açık.
