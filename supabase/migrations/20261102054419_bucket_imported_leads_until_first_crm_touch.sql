-- Imported disposition is retained as the lead's visible status, but an
-- assigned lead stays in New/Fresh until somebody actually works it in CRM.
-- Rebuild the stored generated bucket so existing rows are recalculated without
-- touching their timestamps or other lead data.

drop index if exists public.leads_assigned_workflow_bucket_idx;
alter table public.leads drop column workflow_bucket;

create or replace function public.crm_lead_workflow_bucket(
  p_status text,
  p_assigned_fresh_since timestamptz,
  p_first_agent_touch_at timestamptz
)
returns text
language sql
immutable
set search_path = ''
as $function$
  select case
    when p_assigned_fresh_since is not null and p_first_agent_touch_at is null then 'fresh'
    when public.crm_is_closed_lead_status(p_status) then 'closed'
    when lower(btrim(coalesce(p_status, ''))) in ('opd booked', 'consultation booked') then 'opdBooked'
    when lower(btrim(coalesce(p_status, ''))) in ('opd done', 'consultation attended') then 'opdDone'
    when lower(btrim(coalesce(p_status, ''))) in ('ipd booked', 'surgery scheduled') then 'ipdBooked'
    when lower(btrim(coalesce(p_status, ''))) in ('ipd done', 'won', 'surgery completed') then 'ipdDone'
    else 'followup'
  end;
$function$;

alter table public.leads add column workflow_bucket text generated always as (
  public.crm_lead_workflow_bucket(status, assigned_fresh_since, first_agent_touch_at)
) stored;

create index leads_assigned_workflow_bucket_idx
  on public.leads (assigned_to, workflow_bucket);
