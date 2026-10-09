-- Meta "conversions" were the sum of every action type containing
-- "conversion" (+ "lead"): one form lead under three overlapping types
-- counted three times, page views and add-to-carts counted as conversions.
-- The sync now takes the largest value per family and sums the families
-- (lib/integrations/meta-ads.ts CONVERSION_FAMILIES). This recounts the
-- stored history from the actions each row already keeps in raw_data, so
-- old and new days compare like with like. Safe to run again.

with fam(action_type, family) as (
  values
    ('lead', 'lead'),
    ('onsite_conversion.lead_grouped', 'lead'),
    ('offsite_conversion.fb_pixel_lead', 'lead'),
    ('onsite_web_lead', 'lead'),
    ('omni_purchase', 'purchase'),
    ('purchase', 'purchase'),
    ('offsite_conversion.fb_pixel_purchase', 'purchase'),
    ('onsite_web_purchase', 'purchase'),
    ('onsite_conversion.purchase', 'purchase'),
    ('omni_complete_registration', 'registration'),
    ('complete_registration', 'registration'),
    ('offsite_conversion.fb_pixel_complete_registration', 'registration'),
    ('onsite_conversion.messaging_conversation_started_7d', 'messaging'),
    ('contact_total', 'contact'),
    ('contact', 'contact'),
    ('offsite_conversion.fb_pixel_contact', 'contact'),
    ('schedule_total', 'schedule'),
    ('schedule', 'schedule'),
    ('offsite_conversion.fb_pixel_schedule', 'schedule'),
    ('submit_application_total', 'application'),
    ('offsite_conversion.fb_pixel_submit_application', 'application'),
    ('offsite_conversion.fb_pixel_custom', 'custom')
),
recount as (
  select d.id,
         coalesce((
           select sum(best)
           from (
             select max(round(coalesce(nullif(x->>'value', ''), '0')::numeric)) as best
             from jsonb_array_elements(
               case when jsonb_typeof(d.raw_data->'actions') = 'array' then d.raw_data->'actions' else '[]'::jsonb end
             ) x
             join fam f on f.action_type = x->>'action_type'
             group by f.family
           ) per_family
         ), 0)::integer as conversions
  from public.ads_daily d
  where d.provider = 'meta_ads'
)
update public.ads_daily d
set conversions = r.conversions
from recount r
where d.id = r.id
  and d.conversions is distinct from r.conversions;
