-- Report templates no longer require a Google Slides file: the primary engine
-- is now the bundled OLX v3 PPTX filled server-side (no Google APIs). A row
-- with template_presentation_id NULL uses the built-in template; a non-null id
-- still goes through the Slides copy+fill path.
alter table public.report_templates
  alter column template_presentation_id drop not null;

-- Seed the 14 recurring OLX decks (from the agency's monthly checklist) with
-- best-guess campaign-name filters per the OLX naming convention
-- (PILAR: GOODS/JOBS/PARTS/SVC - TYP: CAMP/CEP/FEED/LIST/PROMO). Verify each
-- filter's match count in the panel / debug preview and tweak all_of/any_of
-- in this table if a segment catches 0 or the wrong campaigns.
insert into public.report_templates (client_id, name, campaign_filter, sort_order)
select c.id, seed.name, seed.filter::jsonb, seed.ord
from public.clients c
cross join (values
  ('Goods Inpost',        '{"all_of": ["GOODS", "INPOST"], "any_of": []}', 1),
  ('Goods Feed',          '{"all_of": ["GOODS", "FEED"], "any_of": []}', 2),
  ('Goods CEP',           '{"all_of": ["GOODS", "CEP"], "any_of": []}', 3),
  ('Goods Promo Kross',   '{"all_of": ["GOODS", "KROSS"], "any_of": []}', 4),
  ('Parts Feed',          '{"all_of": ["PARTS", "FEED"], "any_of": []}', 5),
  ('Parts CEP',           '{"all_of": ["PARTS", "CEP"], "any_of": []}', 6),
  ('Jobs Feed',           '{"all_of": ["JOBS", "FEED"], "any_of": []}', 7),
  ('Jobs Ongoing Promo',  '{"all_of": ["JOBS", "PROMO"], "any_of": []}', 8),
  ('Jobs Ogloszenia',     '{"all_of": ["JOBS", "LIST"], "any_of": []}', 9),
  ('Jobs Biznes OLX',     '{"all_of": ["JOBS", "BIZNES"], "any_of": []}', 10),
  ('Services Feed',       '{"all_of": ["SVC", "FEED"], "any_of": []}', 11),
  ('Services Kazdy Fach', '{"all_of": ["SVC", "FACH"], "any_of": []}', 12),
  ('Services STR',        '{"all_of": ["SVC", "STR"], "any_of": []}', 13),
  ('Services Ogloszenia', '{"all_of": ["SVC", "LIST"], "any_of": []}', 14)
) as seed(name, filter, ord)
where c.slug in ('olx', 'https-www-olx-pl')
  and not exists (
    select 1 from public.report_templates rt
    where rt.client_id = c.id and rt.name = seed.name
  );
