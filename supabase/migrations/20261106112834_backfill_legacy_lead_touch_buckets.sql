-- Reconstruct workflow markers for legacy leads created before imported
-- dispositions were kept in New/Fresh until a real CRM interaction.
-- Do not modify patient data, dispositions, owners, or assignment history.
-- Temporarily pause row triggers so this metadata-only backfill cannot create
-- new timeline/assignment events or rewrite updated_at while recalculating it.

alter table public.leads disable trigger user;

with historical_touches as (
  select a.lead_id, min(a.created_at) as first_touch_at
  from public.lead_activities a
  join public.profiles p on p.id = a.user_id
  join public.leads l on l.id = a.lead_id
  where l.first_agent_touch_at is null
    and p.role::text in ('admin', 'manager', 'employee')
    and lower(btrim(coalesce(a.action_type, ''))) not in (
      'automation', 'assignment', 'transfer', 'import', 'created'
    )
  group by a.lead_id
)
update public.leads l
set first_agent_touch_at = t.first_touch_at,
    fresh_pending_since = null
from historical_touches t
where l.id = t.lead_id;

-- Old assigned leads with no recorded user interaction start Fresh from their
-- last known assignment date. Unassigned intake starts Fresh from its creation
-- date. The generated workflow bucket then follows the same rule as new rows.
update public.leads l
set assigned_fresh_since = coalesce(l.assigned_at, l.created_at, now()),
    closed_status_since = case
      when public.crm_is_closed_lead_status(l.status) then null
      else l.closed_status_since
    end
where l.first_agent_touch_at is null
  and l.assigned_fresh_since is null
  and nullif(lower(btrim(coalesce(l.assigned_to, ''))), '') not in ('-', 'unassigned');

update public.leads l
set fresh_pending_since = coalesce(l.fresh_pending_since, l.created_at, now()),
    closed_status_since = case
      when public.crm_is_closed_lead_status(l.status) then null
      else l.closed_status_since
    end
where l.first_agent_touch_at is null
  and l.assigned_fresh_since is null
  and l.fresh_pending_since is null
  and (
    nullif(lower(btrim(coalesce(l.assigned_to, ''))), '') is null
    or lower(btrim(coalesce(l.assigned_to, ''))) in ('-', 'unassigned')
  );

-- Imported closed statuses must not inherit an old review deadline. The first
-- actual CRM interaction starts a new seven-day review window via the trigger.
update public.leads l
set closed_status_since = null
where l.first_agent_touch_at is null
  and l.closed_status_since is not null
  and public.crm_is_closed_lead_status(l.status);

-- Match the normal lead-update trigger: reviews are removed when an imported
-- closed disposition is recognized as untouched and its cleanup clock clears.
delete from public.crm_lead_deletion_reviews r
using public.leads l
where r.lead_id = l.id
  and r.decision = 'pending'
  and l.first_agent_touch_at is null
  and l.closed_status_since is null
  and public.crm_is_closed_lead_status(l.status);

alter table public.leads enable trigger user;
