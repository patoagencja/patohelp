-- Example monthly budget for DRE so the progress bar has something to show.
-- Edit this value from the UI once the budget editor is live.
insert into public.client_budgets (client_id, month, platform, budget_minor_units)
select id, date '2026-07-01', 'total', 1500000 -- 15 000,00 PLN
from public.clients
where slug = 'dre'
on conflict (client_id, month, platform) do nothing;
