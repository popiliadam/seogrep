-- Migration 0023: crawl sonucuna SATIR ekseni. Bir crawl'ın her sayfası bir satır.
--
-- Bugün bir crawl'ın tamamı `jobs.result` içinde TEK bir jsonb'dir (12 MB tavanı
-- boundCrawlResult'ta). Bu, tek bir işi okumak için mükemmel ve başka HER ŞEY için
-- kötüdür: "bu projede canonical'ı eksik olan sayfalar" ya da "iki crawl arasında
-- ne değişti" soruları, jsonb'yi uygulama tarafında açmadan sorulamaz. Bu tablo o
-- ekseni açar.
--
-- BU MIGRATION HİÇBİR OKUMA YOLUNU DEĞİŞTİRMEZ. `jobs.result` yazımı, şekli ve
-- tüketicileri (audit'ler, get_job_status, rapor) bu dilimde BİREBİR aynı kalır;
-- worker aynı sonucu İKİNCİ bir yere de yazar (çift-yazım) ve parite testle pinlenir.
-- Okuma yolunun satırlara geçmesi sonraki dilimin işidir — o gelene kadar bu tablo
-- yazılan ama okunmayan bir defterdir, ve öyle olması kasıtlıdır: satırların
-- jsonb ile aynı şeyi söylediği ÖNCE kanıtlanır, sonra tüketici taşınır.
--
-- Şekil, `PageRecord` ve `SkippedUrl`'ün (apps/mcp/src/crawler/crawl.ts) düzleştirilmiş
-- hâlidir. `kind` iki kaydı ayırır: 'page' bir gerçekten çekilmiş sayfadır, 'skipped'
-- crawl'ın atladığı bir URL'dir ve YALNIZ o satırda `reason` doludur. İkisi tek tabloda,
-- çünkü ikisi de aynı crawl'ın çıktısıdır ve `seq` ikisini TEK bir sırada tutar —
-- ayrı tablo, "bu crawl ne yaptı" sorusunu iki sorguya bölerdi.

create table public.crawl_pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid not null,
  job_id uuid not null,
  -- 'page' = çekilmiş sayfa (status/title/... dolu, reason null)
  -- 'skipped' = atlanmış URL (reason dolu, sayfa alanları null)
  kind text not null check (kind in ('page', 'skipped')),
  url text not null,
  -- Sayfa alanları. Hepsi nullable: bir 'skipped' satırında hiçbiri yoktur, ve bir
  -- 'page' satırında da PageRecord'un kendisi title/canonical/robotsMeta için null
  -- taşıyabilir. NOT NULL + '' karışımı, "yoktu" ile "boştu"yu ayırt edilemez yapardı.
  status int,
  title text,
  meta_description text,
  h1s jsonb,
  canonical text,
  robots_meta text,
  -- links tek sayfada 1000 kayda kadar çıkabilir (MAX_LINKS_PER_PAGE); satır boyutu
  -- kabul edilebilir, TOAST bunu zaten sıkıştırıp satır dışına taşır.
  links jsonb,
  word_count int,
  json_ld_types jsonb,
  issues jsonb,
  -- Yalnız 'skipped' satırlarında dolu: crawl'ın o URL'yi neden atladığı.
  reason text,
  -- Dequeue sırası: crawl'ın URL'leri gerçekten hangi sırayla işlediği. Bir crawl
  -- içinde 0'dan başlar, önce pages, sonra skipped devam eder. jsonb dizisindeki
  -- konumun ta kendisi — pariteyi ölçülebilir kılan alan budur.
  seq int not null,
  created_at timestamptz not null default now(),

  -- CROSS-TENANT ZIRHI, 0017 deseni (bkz. 0017:47-128). Tek kolonlu bir
  -- `job_id -> jobs (id)` yalnız "bu id var mı" diye sorar; bileşik anahtar
  -- "ve AYNI kiracıya mı ait" diye de sorar. jobs ve projects'in `(user_id, id)`
  -- unique kısıtları 0017'de (0017:61-67) zaten kondu, dolayısıyla bu iki FK
  -- yeni bir parent kısıtı gerektirmez.
  --
  -- Her iki kolon çifti de NOT NULL, yani MATCH SIMPLE her satırda GERÇEKTEN
  -- kontrol eder (0017'nin nullable kenarlarının aksine — 0017:76-81). Kolon
  -- listesiz CASCADE: bir iş ya da proje silindiğinde onun sayfaları da gider;
  -- `set null` burada mümkün DEĞİL (iki kolon da NOT NULL) ve doğru da olmazdı —
  -- sahibi olmayan bir crawl sayfası kimsenin cevaplayamayacağı bir satırdır.
  -- İki cascade yolu (hesap silme -> projects -> buraya, ve -> jobs -> buraya)
  -- aynı satırlara varır; PostgreSQL için bu sorun değildir.
  constraint crawl_pages_user_id_job_id_fkey
    foreign key (user_id, job_id) references public.jobs (user_id, id)
    on delete cascade,
  constraint crawl_pages_user_id_project_id_fkey
    foreign key (user_id, project_id) references public.projects (user_id, id)
    on delete cascade
);
-- Reverse: drop table public.crawl_pages;

-- Kiracının kendi crawl geçmişi (user_id = ? and job_id = ?), ve aynı zamanda
-- `jobs` parent-delete aramasının backing index'i.
create index crawl_pages_user_job_idx on public.crawl_pages (user_id, job_id);
-- Reverse: drop index public.crawl_pages_user_job_idx;

-- Bir işin sayfalarını KENDİ sırasında okumak: order by seq. Parite testinin
-- koştuğu sorgu birebir budur.
create index crawl_pages_job_seq_idx on public.crawl_pages (job_id, seq);
-- Reverse: drop index public.crawl_pages_job_seq_idx;

-- `projects` parent-delete araması (user_id, project_id) için ayrı bir index
-- EKLENMEDİ: bir proje silmesi yalnız hesap cascade'i üzerinden gerçekleşir ve o
-- yol bu tabloyu zaten user_id ön-ekiyle tarar (crawl_pages_user_job_idx) —
-- 0017'nin jobs -> projects kenarı için verdiği gerekçenin aynısı (0017:96-98).

alter table public.crawl_pages enable row level security;
alter table public.crawl_pages force row level security;
-- Reverse: alter table public.crawl_pages disable row level security;

create policy "crawl_pages_select_own"
  on public.crawl_pages for select to authenticated
  using (user_id = (select auth.uid()));
-- Reverse: drop policy "crawl_pages_select_own" on public.crawl_pages;

-- 0021:38-44'te ölçülen şey: taban imajın yeni bir public tablo için verdiği default ACL
-- SADECE Dxtm'dir, DML DEĞİL. GRANT olmadan service_role'un insert'i — RLS'i bypass
-- etmesine rağmen — `permission denied for table crawl_pages` ile düşer. RLS ikinci
-- kapıdır, birincinin yerine geçmez.
--
-- service_role: select + insert. UPDATE/DELETE kasten YOK. Bir crawl'ın satırları o
-- crawl'ın çıktısıdır; sonradan düzeltilecek bir şey değildir, ve tabloyu append-only
-- tutmak, bir sonraki dilimin okuma yolunun altından satır kaydırılamayacağı anlamına
-- gelir. Satırlar yalnız parent'ları (job/proje/hesap) silindiğinde, cascade ile gider.
--
-- authenticated: tablo düzeyinde select. 0021'in kolon listesi buraya GEREKMİYOR —
-- orada tabloda `encrypted_refresh_token` vardı; burada hiçbir kolon sır taşımaz,
-- hepsi kiracının kendi sitesinden okunmuş halka açık HTML sinyalleridir.
grant select on public.crawl_pages to authenticated;
grant select, insert on public.crawl_pages to service_role;
-- Reverse: revoke select, insert on public.crawl_pages from service_role;
--          revoke select on public.crawl_pages from authenticated;

-- 0016 deseni (0016:111-117), tabloya uygulanmış. 0016 default privilege'ları
-- `current_user` (postgres) için zaten kısarak yeni tabloların TRUNCATE ile DOĞMASINI
-- durdurdu, dolayısıyla bu satır beklenen durumda bir NO-OP'tur. Yine de yazılıyor:
-- 0016'nın kendi belgelediği artık boşluk (`supabase_admin` grantor'lı ikinci default
-- ACL — 0016:98-104) bu tabloyu başka bir rol yaratırsa geçerli kalır, ve TRUNCATE
-- tek başına RLS'i de, satır-düzeyi her tetiği de yürüyüp geçer. Asıl savunma yine
-- public-truncate-armor.db.test.ts'in ENUMERASYONU — bu tablo var olduğu andan
-- itibaren o iddianın içindedir, kimsenin listeye eklemesi gerekmez.
revoke truncate on table public.crawl_pages from anon, authenticated, service_role;

-- Additive: hiçbir mevcut tablo, policy, grant ya da FK değişmedi. credit_ledger'a
-- (NEVER #2) dokunulmadı; bu tablo para taşımaz.
