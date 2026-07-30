-- E-commerce support: per-client type + revenue/transaction columns on GA4.
-- Idempotent - safe to re-run.

-- 1) Client type. Engagement clients (DRE, OLX) never show revenue/ROAS;
--    e-commerce clients (MIRACLE, SUNEW) do.
alter table public.clients
  add column if not exists client_type text not null default 'engagement';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clients_client_type_check'
  ) then
    alter table public.clients
      add constraint clients_client_type_check
      check (client_type in ('engagement', 'ecommerce'));
  end if;
end $$;

-- 2) Revenue + transactions on GA4 daily totals (grosze / count).
alter table public.ga4_daily
  add column if not exists revenue_minor_units bigint not null default 0;
alter table public.ga4_daily
  add column if not exists transactions bigint not null default 0;

-- 3) Flag the e-commerce clients (matched by display name, slug-independent).
update public.clients
  set client_type = 'ecommerce'
  where upper(name) in ('MIRACLE', 'SUNEW');
