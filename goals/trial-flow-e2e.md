# goal: trial-flow-e2e
created: 2026-07-20
kaynak: Faz 3 T16 — trial hesabın akışı uçtan uca: kayıt→key (insan adımı, MCP_SMOKE_URL bunun
kanıtı) → auth → tool yüzeyi 33/33 → ledger'dan bakiye okunuyor. Bu predicate PARASIZ ince dilimdir
(get_credit_balance 0 kredi); tam paralı zincir (crawl→audit→rapor) gerçek-client kanıtı olarak
PLAN'a işlenir. MCP_SMOKE_URL set değilken SKIP (landing-live deseni).

## predicate
```predicate
[ -z "${MCP_SMOKE_URL:-}" ] && exit 97
[ "$(curl -sf --max-time 20 -X POST "$MCP_SMOKE_URL" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | grep -o '"inputSchema"' | wc -l | tr -d ' ')" = "33" ]
curl -sf --max-time 20 -X POST "$MCP_SMOKE_URL" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_credit_balance","arguments":{}}}' | grep -qiE 'balance|credits'
```

## on-violation
Şüpheliler: registry değişikliği (33-tool pin kırıldıysa docs-schema-sync de bakar), auth yolu, credit_balances view, revoke edilmiş smoke key.
Runbook: tools/list sayısı ≠33 ise son merge'ün tool diff'ine bak → get_credit_balance hatasıysa fly logs + Supabase advisors → ledger tutarsızlığı şüphesinde İNSANI UYANDIR (contract.md: balance != SUM(ledger)). Otomatik düzeltme YOK.

## pin geçmişi — neden burada duruyor

Bu predicate yüzey sayısını LİTERAL pinler; kastı budur (yeni bir tool, sessizce değil bilinçli
gelsin). Ama pin 2026-07-28'den 2026-08-18'e kadar **19'da kaldı** ve yüzey 19 → 22 → 23 → 26 oldu.
Kimse görmedi çünkü `MCP_SMOKE_URL` yüklü olmayan her koşuda kalem **SKIP** verir ve `make goals`
"16/16 PASS" der. İmzalı ders 7'nin tam vakası: env-koşullu SKIP tam ölçüm gibi okundu.

**Bir tool eklediğinde bu satır da güncellenir** — `costs.test.ts` ve `server.test.ts`'in sayı
pinleriyle aynı anda. Onlar CI'da kırmızı verir, bu vermez: yalnız env yüklü bir `make goals`
koşusu görür.

### İKİNCİ VAKA — 2026-08-19, ve bu kez SKIP yüzünden değil

Pin yine geride kaldı: `backlink_changes` (26→27) ve `backlink_details` (27→28) sevk edildi, bu
satır **26'da kaldı**. Bu kez `MCP_SMOKE_URL` YÜKLÜYDÜ ve kalem her iki dilimde de **PASS** verdi —
çünkü kalem repoyu değil **CANLIYI** ölçer, ve `make goals` her seferinde merge'ün hemen ardından,
MCP deploy'u daha inmeden koştu. Yeşil doğruydu; ölçtüğü şey yanlıştı.

**Yapısal sonuç, gevşetmeden yazılıyor:** bu kalem merge ile deploy ARASINDA zorunlu olarak
kırmızıdır, ve bu kastendir — literal pin "yeni tool sessizce gelmesin" içindir. Ama o yüzden
`make goals`'ın merge'ün hemen ardından koşulan hâli **bu kalem için kanıt değildir**: kanıt,
MCP deploy'u bittikten SONRA koşulan hâlidir. Şef raporunda hangisini koştuğunu yazar.

**Neden `>= 26` yapılmadı:** çünkü o, kalemin bütün kastını siler — bir tool'un sessizce gelmesini
tam olarak serbest bırakır. Kapı gevşetilerek yeşil alınmaz.

### 29 → 30 — 2026-08-19, `discover_keywords`

Bu kez pin, registry değişikliğiyle **AYNI COMMIT'te** taşındı; iki vakanın da ortak sebebi
"sonra hatırlarım"dı. Sayı `costs.test.ts` (30) ve `server.test.ts` (30) ile aynı anda oynadı.
Yukarıdaki ikinci vakanın kuralı aynen geçerli: bu kalem merge ile MCP deploy'u ARASINDA
kırmızıdır ve o penceredeki yeşil, bu kalem için kanıt değildir.

### 30 → 31 — 2026-08-19, `my_pages`

Aynı gün ikinci taşıma, ve yine registry değişikliğiyle **AYNI COMMIT'te**. Sayı `costs.test.ts`
(31) ve `server.test.ts` (31) ile aynı anda oynadı. İki vakanın kuralı burada da geçerli: bu kalem
merge ile MCP deploy'u ARASINDA kırmızıdır ve o penceredeki yeşil, bu kalem için kanıt değildir.

### 31 → 33 — 2026-08-19, `ai_visibility` + `ai_visibility_compare`

Aynı gün üçüncü taşıma, ve yine registry değişikliğiyle **AYNI COMMIT'te**. Sayı `costs.test.ts`
(33) ve `server.test.ts` (33) ile aynı anda oynadı — bu kez tek dilimde İKİ tool geldiği için pin
iki birden atladı. İki vakanın kuralı burada da geçerli: bu kalem merge ile MCP deploy'u ARASINDA
kırmızıdır ve o penceredeki yeşil, bu kalem için kanıt değildir.
