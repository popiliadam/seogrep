# İMZA PAKETİ — OPERATÖR ONAYI (2026-08-25)

> **Bu dosya bir NEVER#6 imzasıdır.** Kaynak: `docs/plans/2026-08-26-tool-revizyon-duzeltme-handoff.md` §4.
> Sorulan 15 madde tek mesajda operatöre sunuldu; ölçümler ve şef önerisi her maddede yazılıydı.

## Onay metni (birebir)

> *"en iyi senaryo ne olacaksa o şekilde olsun gerekli bütün izinleri onayları veriyorum.
> tamamen senin önerilerine göre otonom ilerleyelim."*

**Kapsam:** 15 maddenin **hepsi**, **şefin yazılı önerisi neyse o hâliyle** onaylandı.
Operatör ayrı bir rakam ya da yön belirtmedi → **öneri metni bağlayıcı karardır**, şefin sonradan
genişletme yetkisi YOKTUR. Bir madde önerinin dışına çıkacaksa **yeniden imza gerekir**.

## Karar tablosu — uygulanacak hâl

| # | karar | **ONAYLANAN DAVRANIŞ** | fiyat |
|---|---|---|---|
| 1 | `audit_schema` | Açıklama "coverage report" diye düzeltilir; **yalnız `@type` sayımı yaptığı** açıkça yazılır. Gerçek JSON-LD doğrulaması **ayrı tool** olarak ayrı fiyatlanır (bu turda yapılmaz) | **5 kredi sabit** |
| 2 | `audit_content` | Kapsama oranı (`1.065/6.972 çift · 20/26 sayfa`) çıktının **başında** | **12 kredi sabit** |
| 3 | GSC üçlüsü | **Tavsiye katmanı** eklenir (`find_quick_wins`, `detect_cannibalization`, `analyze_content_decay`) | **10 kredi sabit** |
| 4 | `compare_competitors` | **Fark tablosu** eklenir (hedef vs rakip, sütun sütun) | **90 kredi sabit** |
| 5 | `research_keywords` | S12 Labs ucuna taşır. **Taşınana kadar boş sonuçta ücret ALINMAZ** | 25 kredi sabit · boş sonuç **0** |
| 6 | `serp_snapshot` | **Vendor tarafı başarısızsa ücretsiz-ret** (emsal: `keyword_positions`) | 5+8/kw sabit · başarısız **0** |
| 7 | başarısız vendor çağrısı | Harcama defterine **YAZILIR** (gerçek para gitti) **+ kırık tool bütçe koruması + operatör uyarısı** | — |
| 8 | AI ailesi | **ŞARTLI:** S3 kök nedeni bulup düzeltirse **yüzeyde kalır**; çözülemezse **çekilir** (36→34) ve docs+pricing güncellenir | 90 sabit |
| 9 | `generate_report` | **Hız bölümü** eklenir; 15↔30 örtüşmesi kabul | **15 kredi sabit** |
| 10 | `discover_keywords` | Gürültülü modlarda (`for_site`, `ideas`) **uyarı + varsayılan hacim tavanı** | **40 kredi sabit** |
| 11 | 6 `www.` kaydı | S4 **ileriye dönük** düzeltir. Geçmiş birleştirme onaylı **ama** `credit_ledger` **APPEND-ONLY** — ledger satırı yazılmaz/silinmez/güncellenmez; yalnız referans yeniden işaretlenir. **Uygulanmadan önce ölçüm raporu yazılır** | — |
| 12 | crawl tohumlama | DFS sıralayan-sayfa listesinden tohumlanır. **Ek maliyet kabul: `my_pages` ≈ 40 kredi** | ek 40 kredi |
| 13 | `disavow_candidates` | `dofollow_only` varsayılanı **`false` kalır**; nofollow adaylar **işaretlenir, elenmez** | **40 kredi sabit** |
| 14 | ölü alan adı | **Uyarı, engelleme değil** | — |
| 15 | üç yeni ücretsiz uç | "son işlerim" · "arşivim" · "harcama geçmişi" **0 kredi** ile eklenir; yüzey **36 → 38**; docs+pricing metinleri güncellenir | **0 kredi** |

## Bu imzanın KAPSAMADIĞI

- Mevcut hiçbir tool'un kredi fiyatını değiştirmek (hiçbir maddede istenmedi, hiçbirinde onaylanmadı).
- Günlük vendor tavanını ($3,00 fail-closed) yükseltmek.
- Paket/abonelik rakamları.
- Madde 1'in "ayrı tool olarak fiyatlanması" — o **ayrı bir imza** gerektirir, bu turda yapılmaz.

