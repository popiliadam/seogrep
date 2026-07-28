-- SYNTHETIC WEAKENING - never applied. Layered on top of fixtures/healthy by
-- check-guards-selftest.sh. Residual leak R2: DROP TABLE takes the REVOKEs and the
-- append-only trigger down with it, so the armorless CREATE TABLE that follows starts from
-- default privileges and no trigger. A parser that keeps the pre-DROP state reports a
-- false GREEN.
-- check-append-only.sh MUST go RED on this.
drop table public.credit_ledger cascade;

create table public.credit_ledger (
  id bigint generated always as identity primary key,
  delta bigint not null
);
alter table public.credit_ledger enable row level security;
alter table public.credit_ledger force row level security;
