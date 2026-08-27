# MCP Apps kartları — tasarım

> Durum: **TASARIM · imza bekliyor** · 2026-08-27
> Ölçülmüş zemin: `docs/plans/2026-08-27-smoke-turu-defteri.md` §D6 (spike) · PR #190 · #191
> Anayasa: `CLAUDE.md`. Bu belge onu tekrar etmez, ona uyar.

## 0. Bir cümlede

SeoGrep'in 38 MCP tool'unun cevapları, destekleyen istemcilerde (Claude mobil · masaüstü · web)
sohbetin içinde **markalı bir kart** olarak da çizilir. Metin cevabı **hiçbir yerde değişmez**.

## 1. Neden — ve neden şimdi güvenli

Bu tasarım tahmine değil, 2026-08-27'de canlıda alınmış üç ölçüme dayanıyor:

| ölçüm | sonuç |
|---|---|
| `ui://` kaynağı uzak sunucudan servis edilebiliyor mu | ✅ `resources/list` + `resources/read` canlıda |
| Kart Claude'da gerçekten çiziliyor mu | ✅ **evet** — bakiye kartı `4519 credits` ve `live` rozetiyle göründü |
| `structuredContent` metnin yerine geçer mi | ⚠️ **EVET, en az bir istemcide** — düzeltildi (PR #191) |

Üçüncüsü bu tasarımın en önemli girdisi: eklentinin *"`content` modelin okuduğu şeydir"* güvencesi
**host'un** tutması gereken bir sözdür ve bir host tutmadı. O yüzden aşağıdaki her kural, metnin
tam cevabı taşımaya devam etmesi üzerine kurulu.

## 2. Değişmez kurallar

1. **Metin tam cevaptır.** `content` her tool'da bugünkü hâliyle kalır. Kart onun yerine geçmez,
   ondan fazlasını bilmez, ondan azını göstermeye zorlamaz.
2. **`summary` her veri kanalında bulunur** (`textResultWithData` zaten zorunlu kılıyor), çünkü
   yalnız veriyi gösteren bir host tam cevaptan azını gösteremesin.
3. **Kart hiçbir şey indirmez.** Host'un varsayılan CSP'si `connect-src 'none'`; hiçbir alan adı
   beyan edilmez. Font yalnız host'un `styles.css.fonts`'undan gelir.
4. **Kart uydurmaz.** Kesilen liste sayısıyla kesilir, ölçülmemiş değer boş bırakılır, sıfır
   basılmaz. (`CLAUDE.md` NEVER#7'nin kart karşılığı.)
5. **Kart salt gösterimdir.** Tıklanabilir bir şey, tool çağıran bir düğme, para harcatan bir
   yüzey **yoktur**. (Operatör kararı, 2026-08-27.)
6. **Fiyat yeniden yazılmaz.** Kart bir kredi rakamı gösterecekse `TOOL_COSTS`'tan türetir
   (NEVER#6). v1'de göstermiyor — §7.

## 3. Dört kart tipi

38 tool'un çıktı şekilleri sayıldı; dört tip hepsini karşılıyor.

| `kind` | ne gösterir | temsilci | eşlenen tool'lar (taslak) |
|---|---|---|---|
| `metric` | tek manşet değer + birkaç olgu satırı | `get_credit_balance` | `get_credit_balance` |
| `list` | sıralı satırlar: başlık · olgular · rozet | `list_projects` | `list_projects` `list_jobs` `list_credit_activity` `list_gsc_properties` `my_pages` `ranked_keywords` `keyword_positions` `research_keywords` `discover_keywords` `backlink_details` `disavow_candidates` `serp_snapshot` `link_gap` `keyword_gap` |
| `report` | bölümler; her bölümde önem dereceli bulgular | `audit_onpage` | `audit_onpage` `audit_tech` `audit_schema` `audit_speed` `audit_content` `generate_report` `find_quick_wins` `detect_cannibalization` `analyze_content_decay` `compare_competitors` `analyze_backlinks` `backlink_changes` `ai_visibility` `ai_visibility_compare` |
| `action` | ne oldu / sırada ne var: manşet eylem + gerekçe + adımlar | `whats_next` | `whats_next` `setup_project` `crawl_site` `pull_gsc_data` `connect_gsc` `track_gsc_property` `track_keywords` `untrack_project` `get_job_status` |

**Neden beş değil dört.** "İş bileti" ayrı tip yapılmadı: kuyruğa iş atmak da *"şu oldu, sırada şu
var"*tır — `action`'ın kendisi. Az tip, az bakım, az sürüklenme.

**Sayım:** metric 1 + list 14 + report 14 + action 9 = **38** — `TOOL_COSTS`'un tamamı, eksiksiz
ve fazlasız. (Bu sayım bir testtir, §8.2.)

Eşleme **taslaktır**: her tool kendi diliminde gezilirken doğrulanır ve gerekirse tipi değişir.
Tipin değişmesi serbest, **eşlemesiz kalması değil**.

## 4. Mimari — tek şablon, veri sürücülü

Tek kaynak: `ui://seogrep/card`, `text/html;profile=mcp-app`.

```
apps/mcp/src/ui/
  card-model.ts      zod şeması — dört kind'ın ayrık birleşimi
  theme.ts           host token'ları -> CSS değişkenleri + SeoGrep yedekleri
  runtime.ts         el sıkışma · host-context-changed · size-changed
  render/metric.ts   \
  render/list.ts      >  her biri model parçasını HTML'e çeviren saf fonksiyon
  render/report.ts   /
  render/action.ts
  card.ts            hepsini TEK HTML dizgisine derler (servis edilen şey)
```

**Neden tek kaynak, tip başına ayrı kaynak değil.** Ayrı kaynaklar tema ve el sıkışma kodunu dörde
çoğaltır ve dördünü elle senkron tutmayı gerektirir. Bu kod tabanı o bedeli ödedi: `rsc-boundary`
kapısında elle bakımı yapılan tekrar listesi **altı delik** üretmişti. Tek kaynağın tek maliyeti
yük boyutu, o da birkaç KB ve host şablonu **ön-yükleyip önbelleğe alıyor** (spec'in kendi
gerekçesi).

**Neden web'in bileşenleri kullanılmıyor.** `apps/mcp`, `apps/web`'e bağımlı olamaz; çerçevede
React yok; CSP hidrasyon dosyası çekmeyi yasaklıyor. HTML sunucuda üretilir.

Kaynak dosyalar küçük kalır (proje kuralı), servis edilen şey tektir.

## 5. Tema sözleşmesi

`ui/initialize` cevabındaki `hostContext`ten okunanlar ve karşılıkları:

| host alanı | kullanım | host vermezse |
|---|---|---|
| `theme` (`light`/`dark`) | vurgu tonunu seçer | `light` |
| `styles.variables` | `:root`'a **olduğu gibi** uygulanır (bkz. aşağıdaki not) | uygulanacak bir şey yok |
| `styles.css.fonts` | font tanımları — CSP'yi aşmanın meşru yolu | Georgia / Courier New |
| `containerDimensions` | esnekse `size-changed` gönderilir | sabit varsayılır |
| `platform`, `deviceCapabilities` | dokunmatikte daha geniş hedefler | masaüstü varsayılır |

**⚠️ DÜZELTME (2026-08-27, planlama sırasında bulundu).** Bu belgenin ilk hâli *"yüzey renkleri
host'un `styles.variables`'ından gelir"* diyordu. Uygulanamaz: spec o değişkenlerin **adlarını**
tanımlamıyor — host'a özgüler ve Claude'unkiler **henüz ölçülmedi**. Bir CSS değişken adını
ezberden yazmak NEVER#9'dur (konvansiyon uydurma).

Bunun yerine **v1 `theme` alanını kullanır** ve SeoGrep'in kendi **iki paletinden** birini seçer —
açık ve koyu. Asıl hedef ("koyu temada göz yakmasın, her yüzeyde doğal dursun") bununla sağlanır ve
hiçbir isim uydurulmaz. Host'un gönderdiği değişkenler yine de `:root`'a **olduğu gibi** yazılır,
böylece adları ÖLÇÜLDÜKTEN sonra bir sonraki dilim onlara referans verebilir.

**Kimlik host'tan gelmez.** Vurgu rengi SeoGrep'in: açık temada `#b45309`, koyu temada markanın
kendi `--color-accent-dark` (`#d9a353`) değeri. **Yeni renk uydurulmaz** — ikisi de
`apps/web/app/globals.css`'te zaten tanımlı.

`ui/notifications/host-context-changed` dinlenir ve kısmi güncelleme mevcut duruma birleştirilir,
böylece kullanıcı temayı değiştirdiğinde kart anında uyar.

**Palet nerede yaşıyor.** v1'de `apps/mcp/src/ui/theme.ts` içinde, `globals.css`'ten KOPYALANMIŞ
ve kopya olduğu yazılı. `apps/mcp` `apps/web`'e bağımlı olamaz ve `@pseo/core` bir palet tutmak
için yanlış yer. Marka değişirse iki dosya değişir; bu bilinçli bir borç ve kartlar yerleştikten
sonra tek kaynağa taşınması backlog'a yazılır.

## 6. Boyut ve kesme

- `containerDimensions` esnekse içerik yüksekliği `ResizeObserver` ile ölçülür ve
  `ui/notifications/size-changed` ile bildirilir (debounce'lu).
- Uzun içerik kartta **sayısıyla** kesilir: `…and 12 more — the full list is in the text answer`.
  Sessiz kırpma yok. Kesilen sayı metinden değil **veriden** gelir.

## 7. v1'de KASTEN olmayanlar

| ne | neden |
|---|---|
| kredi maliyeti satırı | Birim-fiyatlı tool'lar gerçek birim sayısına göre faturalanır; liste fiyatını "ödediğin bu" gibi göstermek para yanlışıdır. Gerçek kesinti kayda geçtiğinde ayrı dilim. |
| etkileşim / tool çağıran düğme | Operatör kararı: para harcatan bir yüzey ayrı tasarım turu ister. |
| tool başına özel düzen | Dört tip yeterli; 38 özel düzen bakım borcu. |
| grafik / çizim | Önce tablolar otursun. Grafik, veri sözleşmesi oturduktan sonra ayrı dilim. |
| çoklu dil | Ürünün UI dili **English** (imzalı ders 4). `locale` okunmaz. |

## 8. Kapılar

1. **`card` zod ile doğrulanır** — `textResultWithCard(text, card)` bozuk modeli fırlatır.
2. **Kapsam testi**, iki ayrı iddia — çünkü biri diğerini göremez:
   - **Eşleme tam.** `apps/mcp/src/ui/card-map.ts` her `ToolName`'i bir `kind`'a bağlayan bir
     `Record<ToolName, CardKind>` dışa verir. TypeScript eksik anahtarı derlemede yakalar; test
     ayrıca **fazla** anahtar olmadığını ve sayımın (§3) tuttuğunu iddia eder.
   - **Kablolama tam.** Bir tool `ui.resourceUri` taşıyorsa `card-map`'te olmalı VE kart döndüren
     bir yardımcı kullanmalı; taşımıyorsa kart döndürmemeli. Yayılım kademeli olduğu için
     "henüz kartlanmamış" meşru bir hâldir ve `card-map` bunu `pending` ile söyler — sessiz bir
     boşluk değil, **adı konmuş** bir hâl.
3. **Dış kaynak yasağı** paylaşılan şablonda pinlidir (`https?://` ve `//host` şekilleri, `fetch(`,
   `WebSocket`, `import(`).
4. **Metin değişmezliği**: kart alan her tool'un kendi spec'i `content`in bugünkü cümlesini
   pinler; `structuredContent.summary === content[0].text`.
5. `verify.sh` · `verify-db.sh` · `make goals` — üçü de, ve **ne ölçmedikleriyle** raporlanır.
6. Her dilim için **mutasyon kanıtı**: düzeltmeyi/kuralı kasten boz, kırmızıya döndüğünü ölç.

## 9. Yayılım — kademeli, her adım canlıda okunur

| dilim | tip | tool | çıkış koşulu |
|---|---|---|---|
| 1 | altyapı + `metric` | `get_credit_balance` | kart canlıda çizildi, metin birebir aynı |
| 2 | `list` | `list_projects` | 18 satır okunabilir, kesme sayısı doğru |
| 3 | `action` | `whats_next` | fiyatlı adımlar `TOOL_COSTS` ile birebir |
| 4 | `report` | `audit_onpage` | bölümler + önem dereceleri okunabilir |
| 5+ | kalan 34 tool | gruplar hâlinde | her grup deploy sonrası canlıda okunur |

Tek seferde 38 tool'a dokunmak, bu turda üç kez arıza yakalayan disiplini imkânsız kılar:
**düzeltmenin kendi çıktısını canlıda oku.**

## 10. Riskler ve karşılıkları

| risk | karşılık |
|---|---|
| Host `styles.variables` göndermez | SeoGrep kâğıt paleti yedek — kart hiçbir koşulda çıplak kalmaz |
| Host kartı hiç çizmez (istemci ailesi dışı) | Metin zaten tam cevap; hiçbir şey kaybolmaz |
| Host `content`i düşürür | `summary` her veri kanalında — PR #191'de kapatıldı ve pinli |
| Eklenti genç, host davranışı değişir | Metin sözleşmedir; kart dekordur. Bozulursa ürün çalışmaya devam eder |
| Yeni tool kartsız eklenir | Kapsam testi (§8.2) karar verir |
| Uzun rapor kartı devleşir | Kesme sayıyla, ve `size-changed` ile gerçek yükseklik bildirilir |

## 11. Açık kalan tek karar

**Palet tek kaynağa taşınsın mı, ne zaman?** v1'de `theme.ts` `globals.css`'ten kopyalıyor. Marka
değişikliği iki dosyayı ilgilendirir. Kartlar yerleştikten sonra tek kaynağa taşımak backlog'da;
şimdi taşımak, `@pseo/core`'a bir palet sokmak demek ve o paketin runtime-hafif olma kuralına
aykırı.
