-- SYNTHETIC WEAKENING - never applied. The gsc_accounts case, reduced to its bones, and the one
-- that cost the most to find. A column-level grant is written as the defence for a secret column
-- ("everything except the ciphertext"), and the table-level SELECT is never revoked. A column
-- grant confers no table-level privilege, so it does NOT displace the default's table-wide
-- SELECT -- it sits beside it, and the owner reads the ciphertext anyway. A gate that treats a
-- column grant as "SELECT decided" turns this GREEN and re-opens the exact hole.
create table public.account_secrets (
  id uuid primary key,
  user_id uuid not null,
  label text not null,
  encrypted_token bytea not null
);
alter table public.account_secrets enable row level security;
alter table public.account_secrets force row level security;
grant select (id, user_id, label) on public.account_secrets to authenticated;
grant select, insert, update, delete on public.account_secrets to service_role;
revoke select, insert, update, delete on public.account_secrets from anon;
revoke insert, update, delete on public.account_secrets from authenticated;
