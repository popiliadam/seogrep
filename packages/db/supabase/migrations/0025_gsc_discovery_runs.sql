-- Migration 0025: discovery analyses'e KOŞU ekseni. Koşulan her analiz bir satır.
--
-- 0024 bunu audit'ler için yaptı; üç DISCOVERY tool'u (find_quick_wins / detect_cannibalization
-- / analyze_content_decay) hâlâ SENKRON koşuyor, metni döndürüyor ve HİÇBİR İZ BIRAKMIYOR.
-- Sonuç yalnız o anki sohbette: panel bir analizin koşulduğunu gösteremez, "geçen ayki quick
-- win'ler neydi" sorulamaz, ve kiracı ödediği analizi ikinci kez göremez.
--
-- AYRI BİR TABLO, audit_runs'a bir tool daha eklemek DEĞİL. 0024'ün CHECK'i o tabloyu üç AUDIT
-- koşusuna bağlar, ve bağlayan tek şey o CHECK değil: `crawl_job_id` NOT NULL orada bir CRAWL'a
-- işaret eder. Bir discovery analizi crawl okumaz — GSC PULL'u okur, ve bir pull'a işaret eden
-- satırı crawl kolonuna sıkıştırmak, kolonun adını bir yalana çevirirdi. İki eksen, iki tablo.
--
-- YAPISAL RAPOR SAKLANIR, RENDER EDİLMİŞ METİN DEĞİL — 0024'ün kuralı, aynı gerekçeyle.
-- `report`, motorun ürettiği nesnedir (QuickWin[] / CannibalGroup[] / PageDecay[] artı üstünde
-- taşınan sayaçlar ve pencere bilgisi; apps/mcp/src/gsc-data/runs.ts), tool'un döndürdüğü
-- biçimlenmiş metin DEĞİL. Metin insan içindir ve biçimi değişebilir; sayılar (kaç quick win,
-- en büyük grup, kaç tıklama kaybı) sorgulanabilir olmalıdır.
--
-- `pull_job_id`: analizin OKUDUĞU pull. Bir discovery analizi kendi başına bir ölçüm değildir —
-- belirli bir pull'ın üzerinde koşan saf bir motordur, ve iki koşuyu karşılaştırmak ancak hangi
-- pull'ları okuduklarını bilerek anlamlıdır. NOT NULL: pull'ı olmayan bir analiz zaten koşamaz
-- (gsc-data/load.ts önce onu arar ve yoksa ücretsiz reddeder).

create table public.gsc_discovery_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid not null,
  -- Analizin üzerinde koştuğu SUCCEEDED pull_gsc_data işi (getLatestSucceededPull'un döndürdüğü).
  pull_job_id uuid not null,
  -- Üç senkron discovery tool'u. CHECK, tabloyu bu üç koşuya bağlar: dördüncü bir tool'un buraya
  -- yazması, bu dilimde tasarlanmamış bir şeydir ve sessizce sızmak yerine INSERT'te düşer.
  tool text not null check (
    tool in ('find_quick_wins', 'detect_cannibalization', 'analyze_content_decay')
  ),
  -- YAPISAL rapor (jsonb): motorun nesnesi. Şekli tool'a göre değişir ve KASTEN şemasızdır —
  -- üç raporun ortak bir kolon kümesi yok (biri sorgu listesi, biri grup listesi, biri sayfa
  -- listesi taşır) ve her birine kolon açmak tabloyu üçünün birleşimi kadar seyrek yapardı.
  -- Okuyucular (panel) alt alanları TEK TEK seçer (`report->total`, `report->top`), bütünü
  -- indirmez: listeler pull'un satır sayısıyla büyür (quick win kısa listesi 50'de kapalı ama
  -- cannibalization grupları ve decay sayfaları kapaksız), ve panelin bastığı iki sayı
  -- raporun TEPESİNDE O(1) alan olarak durur, tam da bu yüzden.
  report jsonb not null,
  created_at timestamptz not null default now(),

  -- CROSS-TENANT ZIRHI, 0017 deseni (0024:56-72 ile birebir aynı gerekçe). Tek kolonlu bir
  -- `pull_job_id -> jobs (id)` yalnız "bu id var mı" diye sorar; bileşik anahtar "ve AYNI
  -- kiracıya mı ait" diye de sorar. jobs ve projects'in `(user_id, id)` unique kısıtları
  -- 0017'de kondu, dolayısıyla bu iki FK yeni bir parent kısıtı gerektirmez.
  --
  -- Her iki kolon çifti de NOT NULL, yani MATCH SIMPLE her satırda GERÇEKTEN kontrol eder.
  -- Kolon listesiz CASCADE: pull işi ya da proje silindiğinde o pull'ın analizleri de gider —
  -- okuduğu pull artık olmayan bir analiz koşusu, kimsenin yorumlayamayacağı bir satırdır.
  constraint gsc_discovery_runs_user_id_pull_job_id_fkey
    foreign key (user_id, pull_job_id) references public.jobs (user_id, id)
    on delete cascade,
  constraint gsc_discovery_runs_user_id_project_id_fkey
    foreign key (user_id, project_id) references public.projects (user_id, id)
    on delete cascade
);
-- Reverse: drop table public.gsc_discovery_runs;

-- PANELİN SORGUSU. /app/projects proje başına her tool'un EN SON koşusunu okur:
--   where user_id = ? and project_id = ? and tool = ? order by created_at desc limit 1
-- Bu index ilk iki kolonu ve sıralamayı verir; `tool` artık (residual) filtre olarak kalır —
-- bir projenin discovery koşusu sayısı üç haneli mertebede olduğu için o filtreyi index'e
-- sokmak ölçülebilir bir şey kazandırmaz (0024:75-80'in aynısı). Aynı index `projects`
-- parent-delete aramasının da backing index'idir (user_id ön-eki).
create index gsc_discovery_runs_user_project_created_idx
  on public.gsc_discovery_runs (user_id, project_id, created_at desc);
-- Reverse: drop index public.gsc_discovery_runs_user_project_created_idx;

-- `jobs` parent-delete araması (user_id, pull_job_id) için AYRI bir index yok: bir job silmesi
-- yalnız hesap/proje cascade'i üzerinden gerçekleşir ve o yol bu tabloyu zaten user_id
-- ön-ekiyle tarar — 0024'ün (0024:82-84), 0023'ün ve 0017'nin verdiği gerekçenin aynısı.

alter table public.gsc_discovery_runs enable row level security;
alter table public.gsc_discovery_runs force row level security;
-- Reverse: alter table public.gsc_discovery_runs disable row level security;

create policy "gsc_discovery_runs_select_own"
  on public.gsc_discovery_runs for select to authenticated
  using (user_id = (select auth.uid()));
-- Reverse: drop policy "gsc_discovery_runs_select_own" on public.gsc_discovery_runs;

-- 0021:38-44'te ölçülen şey (0023 ve 0024'te tekrarlandı): taban imajın yeni bir public tablo
-- için verdiği default ACL SADECE Dxtm'dir, DML DEĞİL. GRANT olmadan service_role'un insert'i —
-- RLS'i bypass etmesine rağmen — `permission denied for table gsc_discovery_runs` ile düşer.
-- RLS ikinci kapıdır, birincinin yerine geçmez.
--
-- service_role: select + insert. UPDATE/DELETE kasten YOK. Bir analiz koşusu, o an ölçülmüş
-- olanın kaydıdır; sonradan düzeltilecek bir şey değildir. Bir eşiği düzeltmek YENİ bir koşu
-- üretir, eskisini yeniden yazmaz — aksi hâlde "geçen ay ne diyordu" sorusu, cevabı geriye
-- dönük değiştirilebilen bir soru olurdu. Satırlar yalnız parent'ları (pull işi / proje /
-- hesap) silindiğinde, cascade ile gider.
--
-- authenticated: tablo düzeyinde select. Hiçbir kolon sır taşımaz — `report` kiracının KENDİ
-- Search Console verisinin türevidir ve o veri zaten `jobs.result` üzerinden aynı role okunur.
grant select on public.gsc_discovery_runs to authenticated;
grant select, insert on public.gsc_discovery_runs to service_role;
-- Reverse: revoke select, insert on public.gsc_discovery_runs from service_role;
--          revoke select on public.gsc_discovery_runs from authenticated;

-- 0016 deseni (0016:111-117), tabloya uygulanmış — beklenen durumda NO-OP, yine de yazılıyor:
-- 0016'nın kendi belgelediği artık boşluk (`supabase_admin` grantor'lı ikinci default ACL) bu
-- tabloyu başka bir rol yaratırsa geçerli kalır, ve TRUNCATE tek başına RLS'i de, satır-düzeyi
-- her tetiği de yürüyüp geçer. Asıl savunma public-truncate-armor.db.test.ts'in ENUMERASYONU —
-- bu tablo var olduğu andan itibaren o iddianın içindedir.
revoke truncate on table public.gsc_discovery_runs from anon, authenticated, service_role;

-- Additive: hiçbir mevcut tablo, policy, grant ya da FK değişmedi. audit_runs'a ve onun tool
-- CHECK'ine DOKUNULMADI (bu tablo onun ikizi, uzantısı değil); credit_ledger'a (NEVER #2)
-- dokunulmadı — bu tablo para taşımaz: analizin ücreti ledger'da, koşunun kendisi burada.
