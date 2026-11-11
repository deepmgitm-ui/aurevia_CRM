-- Keep the daily Fresh queue on the India calendar day, move untouched earlier
-- leads to New at midnight, and scope appointment totals to the clinic month.

update public.leads
set fresh_pending_since = coalesce(created_at, assigned_fresh_since, now())
where workflow_bucket = 'fresh' and fresh_pending_since is null;

create index if not exists leads_untouched_intake_at_idx
  on public.leads (fresh_pending_since)
  where workflow_bucket = 'fresh';

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
  today_start timestamptz := ((now() at time zone 'Asia/Kolkata')::date::timestamp at time zone 'Asia/Kolkata');
  tomorrow_start timestamptz := (((now() at time zone 'Asia/Kolkata')::date + 1)::timestamp at time zone 'Asia/Kolkata');
  result jsonb;
begin
  if viewer_id is null or viewer_role not in ('admin', 'manager', 'employee') then
    raise exception 'Sign in to view lead buckets';
  end if;
  select p.name into viewer_name from public.profiles p where p.id = viewer_id;
  if viewer_role = 'employee' then p_assigned_to := viewer_name; end if;

  with scoped as materialized (
    select l.workflow_bucket, l.fresh_pending_since, l.assigned_fresh_since, l.created_at, l.status
    from public.leads l
    where p_assigned_to is null or lower(btrim(l.assigned_to)) = lower(btrim(p_assigned_to))
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
      when lower(btrim(status)) in ('didn''t enquired') then 'Didn''t Enquired'
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
    end label, count(*) amount
    from scoped
    group by 1
  ),
  pipeline as (
    select count(*) total,
      count(*) filter (where workflow_bucket = 'fresh'
        and coalesce(fresh_pending_since, assigned_fresh_since, created_at) < today_start) new_leads,
      count(*) filter (where workflow_bucket = 'fresh'
        and coalesce(fresh_pending_since, assigned_fresh_since, created_at) >= today_start
        and coalesce(fresh_pending_since, assigned_fresh_since, created_at) < tomorrow_start) fresh,
      max(tomorrow_start) filter (where workflow_bucket = 'fresh'
        and coalesce(fresh_pending_since, assigned_fresh_since, created_at) >= today_start
        and coalesce(fresh_pending_since, assigned_fresh_since, created_at) < tomorrow_start) next_fresh_at,
      count(*) filter (where workflow_bucket = 'followup' and public.crm_is_followup_work_status(status)) follow_up,
      count(*) filter (where workflow_bucket = 'opdBooked') opd_booked,
      count(*) filter (where workflow_bucket = 'opdDone') opd_done,
      count(*) filter (where workflow_bucket = 'ipdBooked') ipd_booked,
      count(*) filter (where workflow_bucket = 'ipdDone') ipd_done,
      count(*) filter (where workflow_bucket = 'closed') lost
    from scoped
  )
  select jsonb_build_object(
    'total', pipeline.total, 'new', pipeline.new_leads, 'fresh', pipeline.fresh,
    'nextFreshAt', pipeline.next_fresh_at, 'followUp', pipeline.follow_up, 'lost', pipeline.lost,
    'opdBooked', pipeline.opd_booked, 'opdDone', pipeline.opd_done,
    'ipdBooked', pipeline.ipd_booked, 'ipdDone', pipeline.ipd_done,
    'statuses', coalesce((select jsonb_object_agg(label, amount) from status_counts), '{}'::jsonb)
  ) into result from pipeline;
  return result;
end;
$function$;

revoke all on function public.crm_lead_bucket_summary(text) from public, anon;
grant execute on function public.crm_lead_bucket_summary(text) to authenticated;

create or replace function public.crm_monthly_appointment_summary(p_assigned_to text default null)
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
  month_start date := date_trunc('month', now() at time zone 'Asia/Kolkata')::date;
  next_month date := (date_trunc('month', now() at time zone 'Asia/Kolkata') + interval '1 month')::date;
  result jsonb;
begin
  if viewer_id is null or viewer_role not in ('admin', 'manager', 'employee') then
    raise exception 'Sign in to view monthly appointment counts';
  end if;
  select p.name into viewer_name from public.profiles p where p.id = viewer_id;
  if viewer_role = 'employee' then p_assigned_to := viewer_name; end if;

  with scoped as materialized (
    select a.lead_id, a.kind, a.status, l.assigned_to
    from public.crm_appointments a
    join public.leads l on l.id = a.lead_id
    where a.starts_on >= month_start
      and a.starts_on < next_month
      and (p_assigned_to is null or lower(btrim(l.assigned_to)) = lower(btrim(p_assigned_to)))
  ),
  totals as (
    select
      count(distinct lead_id) filter (where kind = 'opdBooked' and status not in ('cancelled', 'no_show')) as opd_booked,
      count(distinct lead_id) filter (where kind in ('opdBooked', 'opdDone') and status = 'completed') as opd_done,
      count(distinct lead_id) filter (where kind = 'ipdDone' and status in ('booked', 'confirmed', 'arrived')) as ipd_booked,
      count(distinct lead_id) filter (where kind = 'ipdDone' and status = 'completed') as ipd_done
    from scoped
  ),
  agent_totals as (
    select assigned_to,
      count(distinct lead_id) filter (where kind = 'opdBooked' and status not in ('cancelled', 'no_show')) as opd_booked,
      count(distinct lead_id) filter (where kind in ('opdBooked', 'opdDone') and status = 'completed') as opd_done,
      count(distinct lead_id) filter (where kind = 'ipdDone' and status in ('booked', 'confirmed', 'arrived')) as ipd_booked,
      count(distinct lead_id) filter (where kind = 'ipdDone' and status = 'completed') as ipd_done
    from scoped
    where nullif(btrim(assigned_to), '') is not null and btrim(assigned_to) <> '-'
    group by assigned_to
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', month_start, 'to', next_month - 1),
    'counts', jsonb_build_object(
      'opdBooked', totals.opd_booked, 'opdDone', totals.opd_done,
      'ipdBooked', totals.ipd_booked, 'ipdDone', totals.ipd_done
    ),
    'byAgent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignedTo', agent_totals.assigned_to,
        'opdBooked', agent_totals.opd_booked, 'opdDone', agent_totals.opd_done,
        'ipdBooked', agent_totals.ipd_booked, 'ipdDone', agent_totals.ipd_done
      ) order by agent_totals.assigned_to)
      from agent_totals
    ), '[]'::jsonb)
  ) into result
  from totals;
  return result;
end;
$function$;

revoke all on function public.crm_monthly_appointment_summary(text) from public, anon;
grant execute on function public.crm_monthly_appointment_summary(text) to authenticated;

-- The stored workflow bucket still means untouched. New/Fresh are computed
-- from the original intake timestamp at the India midnight boundary.
create or replace function public.crm_team_bucket_groups()
returns table(assigned_to text, bucket text, lead_count bigint)
language sql
stable
security invoker
set search_path = ''
as $function$
  with today as (
    select
      ((now() at time zone 'Asia/Kolkata')::date::timestamp at time zone 'Asia/Kolkata') as starts_at,
      (((now() at time zone 'Asia/Kolkata')::date + 1)::timestamp at time zone 'Asia/Kolkata') as ends_at
  ),
  categorized as (
    select l.assigned_to, case
      when l.workflow_bucket = 'fresh'
        and coalesce(l.fresh_pending_since, l.created_at) >= d.starts_at
        and coalesce(l.fresh_pending_since, l.created_at) < d.ends_at then 'fresh'
      when l.workflow_bucket = 'fresh'
        and coalesce(l.fresh_pending_since, l.created_at) < d.starts_at then 'new'
      when l.workflow_bucket = 'closed' then 'lost'
      when l.workflow_bucket = 'followup' and public.crm_is_followup_work_status(l.status) then 'followup'
      when l.workflow_bucket = 'followup' then null
      else l.workflow_bucket
    end as bucket
    from public.leads l cross join today d
  )
  select categorized.assigned_to, categorized.bucket, count(*)
  from categorized
  where categorized.bucket is not null
  group by categorized.assigned_to, categorized.bucket
  order by categorized.assigned_to, categorized.bucket;
$function$;

revoke all on function public.crm_team_bucket_groups() from public, anon;
grant execute on function public.crm_team_bucket_groups() to authenticated;

-- Today's untouched intake appears in daily work until IST midnight. Historic
-- assignment views continue to use the original assigned_at date window.
create or replace function public.crm_daily_work_counts(p_day date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with requested_day as (
    select
      p_day::timestamp at time zone 'Asia/Kolkata' as starts_at,
      (p_day + 1)::timestamp at time zone 'Asia/Kolkata' as ends_at,
      p_day = (now() at time zone 'Asia/Kolkata')::date as is_today
  )
  select jsonb_build_object(
    'assigned', (
      select count(*)
      from public.leads l cross join requested_day d
      where case when d.is_today then
        l.workflow_bucket = 'fresh'
        and coalesce(l.fresh_pending_since, l.created_at) >= d.starts_at
        and coalesce(l.fresh_pending_since, l.created_at) < d.ends_at
      else l.assigned_at >= d.starts_at and l.assigned_at < d.ends_at
      end
    ),
    'opd', (
      select count(distinct lead_id)
      from public.crm_appointments
      where starts_on = p_day and kind in ('opdBooked', 'opdDone')
        and status not in ('cancelled', 'no_show')
    ),
    'opdDone', (
      select count(distinct lead_id)
      from public.crm_appointments
      where starts_on = p_day and kind in ('opdBooked', 'opdDone') and status = 'completed'
    ),
    'ipdDone', (
      select count(distinct lead_id)
      from public.crm_appointments
      where starts_on = p_day and kind = 'ipdDone' and status = 'completed'
    ),
    'ipd', (
      select count(distinct lead_id)
      from public.crm_appointments
      where starts_on = p_day and kind = 'ipdDone' and status not in ('cancelled', 'no_show')
    )
  );
$function$;

revoke all on function public.crm_daily_work_counts(date) from public, anon;
grant execute on function public.crm_daily_work_counts(date) to authenticated;
