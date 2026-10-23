-- Keep today's untouched assignments in New Leads. At the clinic-day boundary,
-- those same untouched leads naturally appear in Fresh Leads until first touch.

create or replace function public.crm_daily_work_counts(p_day date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select jsonb_build_object(
    'assigned', (
      select count(*)
      from public.leads l
      where l.assigned_at >= p_day::timestamp at time zone 'Asia/Kolkata'
        and l.assigned_at < (p_day + 1)::timestamp at time zone 'Asia/Kolkata'
        and (
          p_day <> (now() at time zone 'Asia/Kolkata')::date
          or l.workflow_bucket = 'fresh'
        )
    ),
    'opd', (
      select count(distinct lead_id)
      from public.crm_appointments
      where starts_on = p_day
        and kind in ('opdBooked', 'opdDone')
        and status not in ('cancelled', 'no_show')
    ),
    'opdDone', (
      select count(distinct lead_id)
      from public.crm_appointments
      where starts_on = p_day
        and kind in ('opdBooked', 'opdDone')
        and status = 'completed'
    ),
    'ipdDone', (
      select count(distinct lead_id)
      from public.crm_appointments
      where starts_on = p_day
        and kind = 'ipdDone'
        and status = 'completed'
    ),
    'ipd', (
      select count(distinct lead_id)
      from public.crm_appointments
      where starts_on = p_day
        and kind = 'ipdDone'
        and status not in ('cancelled', 'no_show')
    )
  );
$function$;

revoke all on function public.crm_daily_work_counts(date) from public, anon;
grant execute on function public.crm_daily_work_counts(date) to authenticated;

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

  select jsonb_build_object(
    'total', count(*),
    'fresh', count(*) filter (
      where l.workflow_bucket = 'fresh'
        and l.assigned_fresh_since < today_start
    ),
    'followUp', count(*) filter (where l.workflow_bucket = 'followup'),
    'opdBooked', count(*) filter (where l.workflow_bucket = 'opdBooked'),
    'opdDone', count(*) filter (where l.workflow_bucket = 'opdDone'),
    'ipdBooked', count(*) filter (where l.workflow_bucket = 'ipdBooked'),
    'ipdDone', count(*) filter (where l.workflow_bucket = 'ipdDone')
  ) into result
  from public.leads l
  where (p_assigned_to is null or lower(btrim(l.assigned_to)) = lower(btrim(p_assigned_to)));

  return result;
end;
$function$;

revoke all on function public.crm_lead_bucket_summary(text) from public, anon;
grant execute on function public.crm_lead_bucket_summary(text) to authenticated;

create or replace function public.crm_team_bucket_groups()
returns table(assigned_to text, bucket text, lead_count bigint)
language sql
stable
security invoker
set search_path = ''
as $function$
  with today as (
    select date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' as starts_at
  )
  select
    l.assigned_to,
    case
      when l.workflow_bucket = 'fresh' and l.assigned_fresh_since >= today.starts_at then 'new'
      else l.workflow_bucket
    end as bucket,
    count(*)
  from public.leads l
  cross join today
  group by l.assigned_to, case
    when l.workflow_bucket = 'fresh' and l.assigned_fresh_since >= today.starts_at then 'new'
    else l.workflow_bucket
  end
  order by l.assigned_to, bucket;
$function$;

revoke all on function public.crm_team_bucket_groups() from public, anon;
grant execute on function public.crm_team_bucket_groups() to authenticated;
