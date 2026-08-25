# TOOL REVİZYON DEFTERİ — 36 tool, tek tek

> **Bu dosya bir DEFTER, bir plan değil.** Revizyon oturumu tool'ları tek tek gezer ve bulduğu her
> şeyi buraya **append eder**. Hiçbir bulgu bu oturumda düzeltilmez — düzeltme ayrı bir dilimdir,
> ayrı iş emri, ayrı hakem. Karıştırmak, ölçmeyi düzeltmeye kurban eder.
>
> **Neden ayrı:** bir tool'u incelerken aklına gelen düzeltmeyi hemen yapmak, o oturumun geri kalan
> 35 tool'unu inceleme bütçesini yer. Bu oturumun tek işi **görmek ve yazmak**.

## Bulgu satırının şekli — pazarlıksız

Her bulgu **tek satır**, ve dört alanı da dolu olmak zorunda:

```
| tool | sınıf | ne görüldü (ÖLÇÜM) | öneri (kimin) |
```

- **sınıf** — aşağıdaki altıdan biri. Uydurma sınıf yok.
- **ne görüldü** — *gözlenen* şey, yorum değil. "Kötü" bir ölçüm değildir; "üç alandan üçü de `n/a`
  döndü" ölçümdür. Prompt ve çıktının ilgili kısmı yazılır.
- **öneri** — ve **kimin** olduğu: `[operatör]` fiyat/politika kararıysa, `[kod]` kod işiyse,
  `[açık]` henüz karar verilmemişse.

**Bir bulgu, ölçülmeden yazılmaz.** Bu projede bir oturumda altı yanlış iddia bu yüzden çıktı.

## Sınıflar

| sınıf | ne demek |
|---|---|
| `SEÇİM` | LLM doğal cümleden **yanlış tool'u** seçti ya da hiçbirini seçemedi → kusur **açıklamada** |
| `ARGÜMAN` | Doğru tool seçildi ama argüman düz cümleden **doldurulamadı** ya da yanlış dolduruldu → kusur **şema açıklamasında** |
| `VERİ` | Çağrı çalıştı ama alanlar **boş / `n/a` / anlamsız** → vendor sözleşmesi kaymış olabilir |
| `ÇIKTI` | Veri doğru ama sunum **okunmuyor ya da eyleme dönmüyor** — sayı var, cevap yok |
| `DEĞER` | Fiyat ↔ verilen değer dengesi. **Fiyat önerisi NEVER#6'dır, imzasız uygulanmaz** |
| `KAPSAM` | Tool'un yapmadığı ama yapması beklenen şey; ya da hiç olmaması gereken şey |

## Kapsam kuralı — para

Ücretli her çağrı **gerçek vendor parası** harcar. Günlük tavan **$3,00**, fail-closed.
Bir tool'u **birden fazla kez** koşturmak gerekiyorsa (ör. `discover_keywords`'ün dört mode'u)
o karta yazılır. Tavana yaklaşırsan **dur ve yaz** — ertesi gün devam.

`DFS_LIVE` kapalıysa her ücretli tool "not enabled" döner: **0 kredi, 0 defter satırı**, ve
inceleme **hiçbir şey ölçmemiş** olur. İlk ücretli çağrıda bunu doğrula.

---

## BULGULAR

> Aşağıya append edilir. Boşken bırakmak da bir ölçümdür: "bakıldı, bulgu yok" ayrı bir satırdır,
> "bakılmadı"dan farklıdır.

| tool | sınıf | ne görüldü (ÖLÇÜM) | öneri (kimin) |
|---|---|---|---|
| _(ilk bulgu buraya)_ | | | |

---

## KAPSAMA İZLEME — hangi tool bakıldı

> Bu tablo oturumun **kendi dürüstlüğü**: "36'sına da baktık" ölçülmeden yazılmaz.

### Ücretsiz — 11 tool (para harcamaz, önce bunlar)

| tool | bakıldı | not |
|---|---|---|
| `setup_project` | ☐ | |
| `list_projects` | ☐ | |
| `get_credit_balance` | ☐ | |
| `get_job_status` | ☐ | |
| `whats_next` | ☐ | yönlendirme kalitesi — diğer 35'i tanıtan tool |
| `connect_gsc` | ☐ | dış dünya, dikkat |
| `list_gsc_properties` | ☐ | |
| `track_gsc_property` | ☐ | |
| `untrack_project` | ☐ | |
| `track_keywords` | ☐ | |
| `keyword_positions` | ☐ | 10 kredi ama vendor maliyeti SIFIR |

### Ucuz — 6 tool, 5–15 kredi

| tool | kredi | bakıldı | not |
|---|---|---|---|
| `audit_schema` | 5 | ☐ | |
| `pull_gsc_data` | 5 | ☐ | |
| `serp_snapshot` | 5+8/kw | ☐ | **fixture'ı zaten saklanabilir satır üretemiyordu** |
| `find_quick_wins` | 10 | ☐ | |
| `detect_cannibalization` | 10 | ☐ | |
| `analyze_content_decay` | 10 | ☐ | |

### Orta — 7 tool, 12–35 kredi

| tool | kredi | bakıldı | not |
|---|---|---|---|
| `audit_content` | 12 | ☐ | |
| `audit_tech` | 15 | ☐ | |
| `audit_speed` | 15 | ☐ | |
| `generate_report` | 15 | ☐ | |
| `crawl_site` | 20 | ☐ | asenkron — `get_job_status` ile birlikte |
| `research_keywords` | 25 | ☐ | |
| `audit_onpage` | 30 | ☐ | |

### Pahalı — 12 tool, 35–90 kredi · **burada dikkat**

| tool | kredi | bakıldı | not |
|---|---|---|---|
| `backlink_changes` | 35 | ☐ | fixture GERÇEK yakalama |
| `backlink_details` | 35 | ☐ | fixture GERÇEK yakalama |
| `disavow_candidates` | 40 | ☐ | fixture karışık |
| `discover_keywords` | 40 | ☐ | **dört mode = dört ayrı uç, dördü de ayrı incelenir** |
| `my_pages` | 40 | ☐ | |
| `keyword_gap` | 45 | ☐ | |
| `link_gap` | 45 | ☐ | |
| `ranked_keywords` | 65 | ☐ | `n/a`'yı en çok basan renderer |
| `analyze_backlinks` | 70 | ☐ | üç blok, üçü de ayrı fixture |
| `compare_competitors` | 90 | ☐ | |
| `ai_visibility` | 90 | ☐ | **LLM Mentions'tan hiç canlı yanıt yakalanmadı** |
| `ai_visibility_compare` | 90/hedef | ☐ | 3 hedef = 270 → **200 onay eşiğini aşmalı** |

---

## OTURUM SONUNDA — üç satır, hepsi ölçülmüş

1. **Kaç tool'a bakıldı / 36.** Bakılmayan varsa **adıyla** yazılır.
2. **Kaç bulgu, sınıfa göre dağılımı.**
3. **Harcanan vendor doları** (`select dfs_spend_today_usd()`), ve tavana ne kadar kaldığı.

Sonra bulgular **sınıfa ve sahibine** göre gruplanır: `[kod]` olanlar chip envanterine, `[operatör]`
olanlar imza kuyruğuna, `[açık]` olanlar bir sonraki oturumun karar listesine.
