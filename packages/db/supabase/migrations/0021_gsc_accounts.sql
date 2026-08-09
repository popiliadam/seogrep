-- Migration 0021: kimlik bilgisini PROJE ekseninden HESAP eksenine taşı.
--
-- ÖLÇÜLDÜ 2026-08-10, çıkarım değil: altı GSC-bağlı projenin DÖRDÜNDE refresh token ölü.
-- Sebep sunucu log'undan okundu — 12 referansın 12'si de:
--   Tool "pull_gsc_data" failed [ref …]: Google token endpoint failed (400): invalid_grant
-- Çalışan iki proje, yeniden onaylanan tam olarak o ikisiydi. Yani bir Google hesabı için
-- N proje = N token = N bağımsız ölüm; ve `connect_gsc` canlı ile ölüyü ayırt edemiyor.
--
-- Bu migration TOKEN'LARI SİLER, EŞLEMEYİ KORUR. `gsc_property` her satırda kalır; kullanıcı
-- Google hesabı başına BİR kez yeniden onay verir ve eşlemeleri yeniden seçmek zorunda kalmaz.

create table public.gsc_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Google'ın stabil kullanıcı kimliği. UNIQUE burada, e-postada DEĞİL: e-posta değişebilir,
  -- `sub` değişmez; e-postaya anahtarlamak aynı hesabı iki kez bağlatırdı.
  google_account_sub text not null,
  google_account_email text not null,
  encrypted_refresh_token bytea not null,
  -- Yalnız `invalid_grant` bunu 'invalid' yapar; geçici 5xx/ağ hatası bağlantıyı ölü ilan etmez.
  -- Başarılı her yenileme 'active' yazar → alan en son GÖZLENEN gerçeği taşır.
  token_status text not null default 'active' check (token_status in ('active', 'invalid')),
  token_checked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint gsc_accounts_user_sub_key unique (user_id, google_account_sub)
);
-- Reverse: drop table public.gsc_accounts;

alter table public.gsc_accounts enable row level security;
alter table public.gsc_accounts force row level security;
-- Reverse: alter table public.gsc_accounts disable row level security;

create policy "gsc_accounts_select_own"
  on public.gsc_accounts for select to authenticated
  using (user_id = (select auth.uid()));
-- Reverse: drop policy "gsc_accounts_select_own" on public.gsc_accounts;

-- The base image's default ACL for a new public table grants only Dxtm (TRUNCATE / REFERENCES /
-- TRIGGER / MAINTAIN) — never DML (measured here: without these two GRANTs, a service_role
-- select/insert/delete against a freshly-created gsc_accounts fails `permission denied for table
-- gsc_accounts` even though service_role bypasses RLS; RLS is a second gate, not a substitute for
-- the first). service_role gets the full table-level DML surface Task 4's write layer and this
-- migration's own mutation test both require — including DELETE, because `disconnectAccount`
-- (Task 7) removes a gsc_accounts row outright and this file's own db-test deletes one to prove
-- `on delete set null` holds.
--
-- authenticated does NOT get a table-level grant (unlike 0006's gsc_connections). gsc_connections
-- held one project's token per row; gsc_accounts concentrates EVERY Google credential a user has
-- into one table, so `grant select on public.gsc_accounts to authenticated` would hand an owner
-- read access to their own `encrypted_refresh_token` ciphertext over the Data API — the RLS policy
-- above restricts to the OWN row, not to which columns of it. A column-level grant is the fix:
-- every column except the ciphertext. No UI ever needs the ciphertext client-side; only
-- service_role decrypts (Task 4's accessTokenFor).
grant select (id, user_id, google_account_sub, google_account_email, token_status, token_checked_at, created_at)
  on public.gsc_accounts to authenticated;
grant select, insert, update, delete on public.gsc_accounts to service_role;
-- Reverse: revoke select, insert, update, delete on public.gsc_accounts from service_role;
--          revoke select (id, user_id, google_account_sub, google_account_email, token_status, token_checked_at, created_at)
--            on public.gsc_accounts from authenticated;

-- `on delete set null`, CASCADE DEĞİL: bir hesabı koparmak eşlemeleri SİLMEMELİ. Cascade
-- olsaydı disconnect, bu migration'ın özenle koruduğu şeyi yok ederdi. set null ile hesabı
-- koparmak, migration'ın ürettiği durumun AYNISINA düşer — tek zihinsel model.
alter table public.gsc_connections
  add column account_id uuid references public.gsc_accounts (id) on delete set null;
-- Reverse: alter table public.gsc_connections drop column account_id;

-- Kimlik bilgisi artık hesapta. Bu kolonun düşmesi, v3 (proje-bağlı) şifreli metnin bir daha
-- ASLA okunmayacağı anlamına gelir — Task 3 kripto legleri buna dayanarak siler.
alter table public.gsc_connections drop column encrypted_refresh_token;
-- Reverse: alter table public.gsc_connections add column encrypted_refresh_token bytea;
