-- Migration 0024: audit'lere KOŞU ekseni. Koşulan her audit bir satır.
--
-- Bugün üç audit tool'u (audit_onpage / audit_tech / audit_schema) SENKRON koşar, metni
-- döndürür ve HİÇBİR İZ BIRAKMAZ. Sonuç yalnız o anki sohbettedir: panel bir audit'in
-- koşulduğunu gösteremez, "geçen haftaya göre ne değişti" sorulamaz, ve bir kiracı ödediği
-- audit'in çıktısını ikinci kez göremez. Bu tablo o ekseni açar.
--
-- YAPISAL RAPOR SAKLANIR, RENDER EDİLMİŞ METİN DEĞİL. `report`, kural motorunun ürettiği
-- OnpageReport / TechReport / SchemaReport nesnesidir (apps/mcp/src/audit/rules/*.ts) —
-- tool'un döndürdüğü biçimlenmiş metin DEĞİL. Metin insan içindir ve biçimi değişebilir;
-- sayılar (kaç sayfa, kaç 4xx, kaç sayfada şema) sorgulanabilir olmalıdır. Metni saklamak,
-- paneli "kaç sayfada bulgu var" diye sorabilmek için cümle ayrıştırmaya mahkûm ederdi.
--
-- `crawl_job_id`: audit'in OKUDUĞU crawl. Bir audit kendi başına bir ölçüm değildir — belirli
-- bir crawl'ın üzerinde koşan bir kural motorudur, ve iki audit koşusunu karşılaştırmak ancak
-- hangi crawl'ları okuduklarını bilerek anlamlıdır. NOT NULL: crawl'ı olmayan bir audit zaten
-- koşamaz (audit/load.ts önce onu arar ve yoksa ücretsiz reddeder).

create table public.audit_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid not null,
  -- Audit'in üzerinde koştuğu SUCCEEDED crawl_site işi (getLatestSucceededCrawl'ın döndürdüğü).
  crawl_job_id uuid not null,
  -- Üç senkron audit tool'u. CHECK, tabloyu bu üç koşuya bağlar: dördüncü bir tool'un buraya
  -- yazması, bu dilimde tasarlanmamış bir şeydir ve sessizce sızmak yerine INSERT'te düşer.
  tool text not null check (tool in ('audit_onpage', 'audit_tech', 'audit_schema')),
  -- YAPISAL rapor (jsonb): kural motorunun nesnesi. Şekli tool'a göre değişir ve KASTEN
  -- şemasızdır — üç raporun ortak bir kolon kümesi yok, ve her birine kolon açmak tabloyu
  -- üçünün birleşimi kadar seyrek yapardı. Okuyucular (panel) alt alanları TEK TEK seçer
  -- (`report->pageCount`), bütünü indirmez: rapor crawl başına ≤100 sayfayla sınırlıdır
  -- (MAX_PAGES_PERSISTED) ama yine de sayfa sayısıyla büyüyen alanlar taşır.
  report jsonb not null,
  created_at timestamptz not null default now(),

  -- CROSS-TENANT ZIRHI, 0017 deseni (0023:56-72 ile birebir aynı gerekçe). Tek kolonlu bir
  -- `crawl_job_id -> jobs (id)` yalnız "bu id var mı" diye sorar; bileşik anahtar "ve AYNI
  -- kiracıya mı ait" diye de sorar. jobs ve projects'in `(user_id, id)` unique kısıtları
  -- 0017'de kondu, dolayısıyla bu iki FK yeni bir parent kısıtı gerektirmez.
  --
  -- Her iki kolon çifti de NOT NULL, yani MATCH SIMPLE her satırda GERÇEKTEN kontrol eder.
  -- Kolon listesiz CASCADE: crawl işi ya da proje silindiğinde o crawl'ın audit'leri de gider —
  -- okuduğu crawl artık olmayan bir audit koşusu, kimsenin yorumlayamayacağı bir satırdır.
  constraint audit_runs_user_id_crawl_job_id_fkey
    foreign key (user_id, crawl_job_id) references public.jobs (user_id, id)
    on delete cascade,
  constraint audit_runs_user_id_project_id_fkey
    foreign key (user_id, project_id) references public.projects (user_id, id)
    on delete cascade
);
-- Reverse: drop table public.audit_runs;

-- PANELİN SORGUSU. /app/projects proje başına her tool'un EN SON koşusunu okur:
--   where user_id = ? and project_id = ? and tool = ? order by created_at desc limit 1
-- Bu index ilk iki kolonu ve sıralamayı verir; `tool` artık (residual) filtre olarak kalır —
-- bir projenin audit koşusu sayısı üç haneli mertebede olduğu için o filtreyi index'e sokmak
-- ölçülebilir bir şey kazandırmaz. Aynı index `projects` parent-delete aramasının da backing
-- index'idir (user_id ön-eki).
create index audit_runs_user_project_created_idx
  on public.audit_runs (user_id, project_id, created_at desc);
-- Reverse: drop index public.audit_runs_user_project_created_idx;

-- `jobs` parent-delete araması (user_id, crawl_job_id) için AYRI bir index yok: bir job silmesi
-- yalnız hesap/proje cascade'i üzerinden gerçekleşir ve o yol bu tabloyu zaten user_id
-- ön-ekiyle tarar — 0023'ün (0023:88-91) ve 0017'nin (0017:96-98) verdiği gerekçenin aynısı.

alter table public.audit_runs enable row level security;
alter table public.audit_runs force row level security;
-- Reverse: alter table public.audit_runs disable row level security;

create policy "audit_runs_select_own"
  on public.audit_runs for select to authenticated
  using (user_id = (select auth.uid()));
-- Reverse: drop policy "audit_runs_select_own" on public.audit_runs;

-- 0021:38-44'te ölçülen şey (0023:105-112'de tekrarlandı): taban imajın yeni bir public tablo
-- için verdiği default ACL SADECE Dxtm'dir, DML DEĞİL. GRANT olmadan service_role'un insert'i —
-- RLS'i bypass etmesine rağmen — `permission denied for table audit_runs` ile düşer. RLS ikinci
-- kapıdır, birincinin yerine geçmez.
--
-- service_role: select + insert. UPDATE/DELETE kasten YOK. Bir audit koşusu, o an ölçülmüş
-- olanın kaydıdır; sonradan düzeltilecek bir şey değildir. Bir kuralı düzeltmek YENİ bir koşu
-- üretir, eskisini yeniden yazmaz — aksi hâlde "geçen hafta ne diyordu" sorusu, cevabı geriye
-- dönük değiştirilebilen bir soru olurdu. Satırlar yalnız parent'ları (crawl işi / proje /
-- hesap) silindiğinde, cascade ile gider.
--
-- authenticated: tablo düzeyinde select. Hiçbir kolon sır taşımaz — `report` kiracının kendi
-- sitesinden okunmuş halka açık HTML sinyallerinin türevidir.
grant select on public.audit_runs to authenticated;
grant select, insert on public.audit_runs to service_role;
-- Reverse: revoke select, insert on public.audit_runs from service_role;
--          revoke select on public.audit_runs from authenticated;

-- 0016 deseni (0016:111-117), tabloya uygulanmış — beklenen durumda NO-OP, yine de yazılıyor:
-- 0016'nın kendi belgelediği artık boşluk (`supabase_admin` grantor'lı ikinci default ACL) bu
-- tabloyu başka bir rol yaratırsa geçerli kalır, ve TRUNCATE tek başına RLS'i de, satır-düzeyi
-- her tetiği de yürüyüp geçer. Asıl savunma public-truncate-armor.db.test.ts'in ENUMERASYONU —
-- bu tablo var olduğu andan itibaren o iddianın içindedir.
revoke truncate on table public.audit_runs from anon, authenticated, service_role;

-- Additive: hiçbir mevcut tablo, policy, grant ya da FK değişmedi. credit_ledger'a (NEVER #2)
-- dokunulmadı; bu tablo para taşımaz — audit'in ücreti ledger'da, koşunun kendisi burada.
