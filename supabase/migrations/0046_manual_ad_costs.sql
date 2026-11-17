-- Ad costs from channels the panel has no integration for (Pinterest,
-- Microsoft Bing, X, ChatGPT ads, anything else) - and TikTok for days its
-- integration has no data. Shops keep these in their own sheet today; the
-- "Wynik dzień po dniu" page (/<client>/wynik) takes them from here and
-- subtracts them from the shop's revenue next to Meta, Google and TikTok.
--
-- One row per (client, day, channel), money in PLN minor units (grosze)
-- like the rest of the schema. A day's integration number always wins over
-- a hand entry for the same channel, so nothing is counted twice. Zero is
-- never stored: clearing a cell deletes its row.
--
-- Reads: agency users see every client, a client user only their own (the
-- usual policy). Writes go through a Server Action with the service role,
-- after a guard that lets in agency users and that client's own users (they
-- keep the sheet today) - so no insert/update/delete policies.
--
-- Idempotent: safe to run more than once.

create table if not exists public.manual_ad_costs (
  client_id uuid not null references public.clients (id) on delete cascade,
  date date not null,
  channel text not null,
  amount_minor_units bigint not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users (id) on delete set null,
  primary key (client_id, date, channel)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'manual_ad_costs_channel_check'
      and conrelid = 'public.manual_ad_costs'::regclass
  ) then
    alter table public.manual_ad_costs
      add constraint manual_ad_costs_channel_check
      check (channel in ('pinterest', 'bing', 'x', 'chatgpt', 'tiktok', 'other'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'manual_ad_costs_amount_check'
      and conrelid = 'public.manual_ad_costs'::regclass
  ) then
    alter table public.manual_ad_costs
      add constraint manual_ad_costs_amount_check
      check (amount_minor_units > 0);
  end if;
end $$;

alter table public.manual_ad_costs enable row level security;

-- Same rule as ads_daily / shop_sales_daily: the helpers sit in sub-selects
-- so Postgres evaluates them once per query instead of once per row.
drop policy if exists manual_ad_costs_select on public.manual_ad_costs;
create policy manual_ad_costs_select on public.manual_ad_costs
  for select to authenticated
  using ((select public.is_agency_user()) or client_id = (select public.current_client_id()));

notify pgrst, 'reload schema';
