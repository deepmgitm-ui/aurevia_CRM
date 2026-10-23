-- Include closed/lost outcomes in every role-scoped lead summary and team view.

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
    'ipdDone', count(*) filter (where l.workflow_bucket = 'ipdDone'),
    'lost', count(*) filter (where l.workflow_bucket = 'closed')
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
      when l.workflow_bucket = 'closed' then 'lost'
      else l.workflow_bucket
    end as bucket,
    count(*)
  from public.leads l
  cross join today
  group by l.assigned_to, case
    when l.workflow_bucket = 'fresh' and l.assigned_fresh_since >= today.starts_at then 'new'
    when l.workflow_bucket = 'closed' then 'lost'
    else l.workflow_bucket
  end
  order by l.assigned_to, bucket;
$function$;

revoke all on function public.crm_team_bucket_groups() from public, anon;
grant execute on function public.crm_team_bucket_groups() to authenticated;
