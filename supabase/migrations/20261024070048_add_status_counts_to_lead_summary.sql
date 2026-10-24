-- Add one-pass current-status counts to the existing role-scoped summary.
-- This is read-only and does not alter any lead rows.
create or replace function public.crm_lead_bucket_summary(p_assigned_to text default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  viewer_role text := coalesce((select public.current_user_role())::text, '');
  viewer_id uuid := auth.uid();
  viewer_name text;
  today_start timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  result jsonb;
begin
  if viewer_id is null or viewer_role not in ('admin', 'manager', 'employee') then
    raise exception 'Sign in to view lead buckets';
  end if;

  select p.name into viewer_name from public.profiles p where p.id = viewer_id;
  if viewer_role = 'employee' then
    p_assigned_to := viewer_name;
  end if;

  with scoped as materialized (
    select l.workflow_bucket, l.assigned_fresh_since, l.status
    from public.leads l
    where p_assigned_to is null
      or lower(btrim(l.assigned_to)) = lower(btrim(p_assigned_to))
  ),
  status_counts as (
    select case
      when status is null or lower(btrim(status)) in ('', '-', '--', 'new', 'new lead') then 'New'
      when lower(btrim(status)) in ('follow-up', 'follow up', 'contacted') then 'Follow-Up'
      when lower(btrim(status)) = 'dnp' then 'DNP'
      when lower(btrim(status)) in ('dnp2', 'dnp 2') then 'DNP2'
      when lower(btrim(status)) in ('dnp3', 'dnp 3') then 'DNP3'
      when lower(btrim(status)) in ('rnr', 'not reachable') then 'RNR'
      when lower(btrim(status)) = 'not interested' then 'Not Interested'
      when lower(btrim(status)) in ('didn’t enquired', 'didn''t enquired') then 'Didn’t Enquired'
      when lower(btrim(status)) = 'budget issue' then 'Budget Issue'
      when lower(btrim(status)) = 'location issue' then 'Location Issue'
      when lower(btrim(status)) = 'non surgical' then 'Non Surgical'
      when lower(btrim(status)) in ('opd booked', 'consultation booked') then 'OPD Booked'
      when lower(btrim(status)) in ('opd done', 'consultation attended') then 'OPD Done'
      when lower(btrim(status)) in ('ipd done', 'won', 'surgery completed') then 'IPD Done'
      when lower(btrim(status)) = 'ipd booked' then 'IPD Booked'
      when lower(btrim(status)) in ('dropped', 'lost') then 'Dropped'
      when lower(btrim(status)) = 'invalid number' then 'Invalid Number'
      when lower(btrim(status)) in ('callback', 'call back', 'call back later') then 'CallBack'
      when lower(btrim(status)) = 'wrong number' then 'Wrong Number'
      else btrim(status)
    end as label,
    count(*) as amount
    from scoped
    group by 1
  ),
  pipeline as (
    select
      count(*) as total,
      count(*) filter (where workflow_bucket = 'fresh' and assigned_fresh_since < today_start) as fresh,
      count(*) filter (where workflow_bucket = 'followup') as follow_up,
      count(*) filter (where workflow_bucket = 'opdBooked') as opd_booked,
      count(*) filter (where workflow_bucket = 'opdDone') as opd_done,
      count(*) filter (where workflow_bucket = 'ipdBooked') as ipd_booked,
      count(*) filter (where workflow_bucket = 'ipdDone') as ipd_done,
      count(*) filter (where workflow_bucket = 'closed') as lost
    from scoped
  )
  select jsonb_build_object(
    'total', pipeline.total,
    'fresh', pipeline.fresh,
    'followUp', pipeline.follow_up,
    'opdBooked', pipeline.opd_booked,
    'opdDone', pipeline.opd_done,
    'ipdBooked', pipeline.ipd_booked,
    'ipdDone', pipeline.ipd_done,
    'lost', pipeline.lost,
    'statuses', coalesce((select jsonb_object_agg(label, amount) from status_counts), '{}'::jsonb)
  ) into result
  from pipeline;

  return result;
end;
$function$;

revoke all on function public.crm_lead_bucket_summary(text) from public, anon;
grant execute on function public.crm_lead_bucket_summary(text) to authenticated;
