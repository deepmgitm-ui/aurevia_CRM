-- A lead belongs to New only while it is untouched and its assignment window
-- started today (Asia/Kolkata). Use the same assignment window for daily cards,
-- drill-down lists, and team summaries. Historical daily views remain based on
-- assigned_at so their assignment history is preserved.

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
      from public.leads l
      cross join requested_day d
      where case when d.is_today
          then l.workflow_bucket = 'fresh'
            and l.assigned_fresh_since >= d.starts_at and l.assigned_fresh_since < d.ends_at
          else l.assigned_at >= d.starts_at and l.assigned_at < d.ends_at
        end
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

create or replace function public.crm_team_bucket_groups()
returns table(assigned_to text, bucket text, lead_count bigint)
language sql
stable
security invoker
set search_path = ''
as $function$
  with clinic_day as (
    select
      date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' as starts_at,
      (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day') at time zone 'Asia/Kolkata' as ends_at
  ), categorized as (
    select l.assigned_to, case
      when l.workflow_bucket = 'fresh'
        and l.assigned_fresh_since >= d.starts_at
        and l.assigned_fresh_since < d.ends_at then 'new'
      when l.workflow_bucket = 'fresh' and l.assigned_fresh_since < d.starts_at then 'fresh'
      when l.workflow_bucket = 'closed' then 'lost'
      when l.workflow_bucket = 'followup' and public.crm_is_followup_work_status(l.status) then 'followup'
      when l.workflow_bucket = 'followup' then null
      when l.workflow_bucket = 'fresh' then null
      else l.workflow_bucket
    end as bucket
    from public.leads l
    cross join clinic_day d
  )
  select assigned_to, bucket, count(*)
  from categorized
  where bucket is not null
  group by assigned_to, bucket
  order by assigned_to, bucket;
$function$;

revoke all on function public.crm_team_bucket_groups() from public, anon;
grant execute on function public.crm_team_bucket_groups() to authenticated;
