-- Migration 0022: projeye ARŞİV ekseni. Silme değil, gizleme.
--
-- Operatör 27 GSC property'sinden yalnız birkaçını takip etmek istiyor ve çıkardığını
-- GERİ ALABİLMEK istiyor. Silme bunu vermez: gsc_connections `on delete cascade` ile
-- yok olur, jobs.project_id `on delete set null` ile sahipsiz kalır, ve yeni proje yeni
-- id alacağı için eski işler ona BİR DAHA bağlanmaz.
--
-- `unique (user_id, domain)` (migration 0010) burada bir NİMET: arşivlenmiş bir domain'i
-- yeniden INSERT etmek zaten imkânsız, dolayısıyla "geri al" ayrı bir kod yolu değil,
-- track'in tek doğru davranışıdır — aynı id, aynı geçmiş, aynı eşleme.
--
-- Nullable ve DEFAULT'SUZ: null = aktif. Bir default (örn. now()) her yeni projeyi
-- doğuşunda arşivlenmiş sayardı; project-archive.db.test.ts bunu pinliyor.
-- Grant gerekmiyor: 0006'daki izinler tablo düzeyinde (`grant select on public.projects`),
-- kolon listesi taşımıyor, dolayısıyla yeni kolonu kendiliğinden kapsıyor.
alter table public.projects add column archived_at timestamptz;

-- Reverse: alter table public.projects drop column archived_at;
