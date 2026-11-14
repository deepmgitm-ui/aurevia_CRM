-- Count current, non-dropped IPD bookings without an admission date by the day
-- the booking status changed, matching the undated OPD booking behavior.
create or replace function public.crm_monthly_appointment_lead_ids(
  p_assigned_to text,
  p_kind text,
  p_month date
)
returns table(id uuid)
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  viewer_role text := coalesce((select public.current_user_role())::text, '');
  viewer_id uuid := auth.uid();
  viewer_name text;
  month_start date := date_trunc('month', p_month)::date;
  month_end date := (date_trunc('month', p_month) + interval '1 month')::date;
  month_start_at timestamptz := month_start::timestamp at time zone 'Asia/Kolkata';
  month_end_at timestamptz := month_end::timestamp at time zone 'Asia/Kolkata';
begin
  if viewer_id is null or viewer_role not in ('admin', 'manager', 'employee') then
    raise exception 'Sign in to view monthly appointment leads';
  end if;

  select p.name into viewer_name from public.profiles p where p.id = viewer_id;
  if viewer_role = 'employee' then p_assigned_to := viewer_name; end if;

  return query
    select matching.id
    from (
      select distinct l.id
      from public.crm_appointments a
      join public.leads l on l.id = a.lead_id
      where a.starts_on >= month_start
        and a.starts_on < month_end
        and (p_assigned_to is null or lower(btrim(l.assigned_to)) = lower(btrim(p_assigned_to)))
        and lower(btrim(l.status)) not in ('dropped', 'lost')
        and case p_kind
          when 'opdBooked' then a.kind = 'opdBooked'
            and a.legacy_column = 'opd_booked_date'
            and a.status not in ('cancelled', 'no_show')
            and lower(btrim(l.status)) in ('opd booked', 'consultation booked')
          when 'opdDone' then a.kind in ('opdBooked', 'opdDone') and a.status = 'completed'
          when 'ipdBooked' then a.kind = 'ipdDone'
            and a.legacy_column = 'ipd_done_date'
            and a.status in ('booked', 'confirmed', 'arrived')
            and lower(btrim(l.status)) in ('ipd booked', 'surgery scheduled')
          when 'ipdDone' then a.kind = 'ipdDone' and a.status = 'completed'
          else false
        end

      union

      select l.id
      from public.leads l
      left join lateral (
        select max(activity.created_at) as created_at
        from public.lead_activities activity
        where activity.lead_id = l.id
          and activity.action_type = 'Status changed'
          and (
            (lower(btrim(l.status)) in ('opd booked', 'consultation booked')
              and (activity.description like '% → OPD Booked'
                or activity.description like '% → Consultation Booked'))
            or (lower(btrim(l.status)) in ('ipd booked', 'surgery scheduled')
              and (activity.description like '% → IPD Booked'
                or activity.description like '% → Surgery Scheduled'))
          )
      ) status_change on true
      where p_kind in ('opdBooked', 'ipdBooked')
        and lower(btrim(l.status)) in ('opd booked', 'consultation booked', 'ipd booked', 'surgery scheduled')
        and (p_assigned_to is null or lower(btrim(l.assigned_to)) = lower(btrim(p_assigned_to)))
        and (
          (p_kind = 'opdBooked'
            and lower(btrim(l.status)) in ('opd booked', 'consultation booked')
            and public.crm_date(l.opd_booked_date) is null
            and not exists (
              select 1 from public.crm_appointments a
              where a.lead_id = l.id and a.kind = 'opdBooked'
                and a.legacy_column = 'opd_booked_date'
            ))
          or (p_kind = 'ipdBooked'
            and lower(btrim(l.status)) in ('ipd booked', 'surgery scheduled')
            and public.crm_date(l.ipd_done_date) is null
            and not exists (
              select 1 from public.crm_appointments a
              where a.lead_id = l.id and a.kind = 'ipdDone'
                and a.legacy_column = 'ipd_done_date'
            ))
        )
        and coalesce(status_change.created_at, l.created_at) >= month_start_at
        and coalesce(status_change.created_at, l.created_at) < month_end_at
    ) matching
    order by matching.id;
end;
$function$;

revoke all on function public.crm_monthly_appointment_lead_ids(text, text, date) from public, anon;
grant execute on function public.crm_monthly_appointment_lead_ids(text, text, date) to authenticated;

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
  previous_month_start date := (date_trunc('month', now() at time zone 'Asia/Kolkata') - interval '1 month')::date;
  next_month date := (date_trunc('month', now() at time zone 'Asia/Kolkata') + interval '1 month')::date;
  month_start_at timestamptz := month_start::timestamp at time zone 'Asia/Kolkata';
  next_month_at timestamptz := next_month::timestamp at time zone 'Asia/Kolkata';
  result jsonb;
begin
  if viewer_id is null or viewer_role not in ('admin', 'manager', 'employee') then
    raise exception 'Sign in to view monthly appointment counts';
  end if;

  select p.name into viewer_name from public.profiles p where p.id = viewer_id;
  if viewer_role = 'employee' then p_assigned_to := viewer_name; end if;

  with dated_appointments as materialized (
    select a.lead_id, a.kind, a.status, a.starts_on, l.assigned_to, l.status as lead_status
    from public.crm_appointments a
    join public.leads l on l.id = a.lead_id
    where a.starts_on >= previous_month_start
      and a.starts_on < next_month
      and (p_assigned_to is null or lower(btrim(l.assigned_to)) = lower(btrim(p_assigned_to)))
      and lower(btrim(l.status)) not in ('dropped', 'lost')
      and (a.kind <> 'opdBooked' or lower(btrim(l.status)) in ('opd booked', 'consultation booked'))
      and (a.kind <> 'opdBooked' or a.legacy_column = 'opd_booked_date')
      and (a.kind <> 'ipdDone' or a.status = 'completed'
        or (a.legacy_column = 'ipd_done_date'
          and lower(btrim(l.status)) in ('ipd booked', 'surgery scheduled')))
  ),
  undated_bookings as materialized (
    select l.id as lead_id,
      case when lower(btrim(l.status)) in ('ipd booked', 'surgery scheduled')
        then 'ipdDone'::text else 'opdBooked'::text end as kind,
      'booked'::text as status,
      (coalesce(status_change.created_at, l.created_at) at time zone 'Asia/Kolkata')::date as starts_on,
      l.assigned_to
    from public.leads l
    left join lateral (
      select activity.created_at
      from public.lead_activities activity
      where activity.lead_id = l.id
        and activity.action_type = 'Status changed'
        and (
          (lower(btrim(l.status)) in ('opd booked', 'consultation booked')
            and (activity.description like '% → OPD Booked'
              or activity.description like '% → Consultation Booked'))
          or (lower(btrim(l.status)) in ('ipd booked', 'surgery scheduled')
            and (activity.description like '% → IPD Booked'
              or activity.description like '% → Surgery Scheduled'))
        )
      order by activity.created_at desc, activity.id desc
      limit 1
    ) status_change on true
    where lower(btrim(l.status)) in ('opd booked', 'consultation booked', 'ipd booked', 'surgery scheduled')
      and (p_assigned_to is null or lower(btrim(l.assigned_to)) = lower(btrim(p_assigned_to)))
      and (
        (lower(btrim(l.status)) in ('opd booked', 'consultation booked')
          and public.crm_date(l.opd_booked_date) is null
          and not exists (
            select 1 from public.crm_appointments a
            where a.lead_id = l.id and a.kind = 'opdBooked'
              and a.legacy_column = 'opd_booked_date'
          ))
        or (lower(btrim(l.status)) in ('ipd booked', 'surgery scheduled')
          and public.crm_date(l.ipd_done_date) is null
          and not exists (
            select 1 from public.crm_appointments a
            where a.lead_id = l.id and a.kind = 'ipdDone'
              and a.legacy_column = 'ipd_done_date'
          ))
      )
      and coalesce(status_change.created_at, l.created_at) >= (previous_month_start::timestamp at time zone 'Asia/Kolkata')
      and coalesce(status_change.created_at, l.created_at) < next_month_at
  ),
  scoped as materialized (
    select lead_id, kind, status, starts_on, assigned_to from dated_appointments
    union all
    select lead_id, kind, status, starts_on, assigned_to from undated_bookings
  ),
  totals as (
    select
      count(distinct lead_id) filter (where starts_on >= month_start and kind = 'opdBooked' and status not in ('cancelled', 'no_show')) as opd_booked,
      count(distinct lead_id) filter (where starts_on >= month_start and kind in ('opdBooked', 'opdDone') and status = 'completed') as opd_done,
      count(distinct lead_id) filter (where starts_on >= month_start and kind = 'ipdDone' and status in ('booked', 'confirmed', 'arrived')) as ipd_booked,
      count(distinct lead_id) filter (where starts_on >= month_start and kind = 'ipdDone' and status = 'completed') as ipd_done,
      count(distinct lead_id) filter (where starts_on < month_start and kind = 'opdBooked' and status not in ('cancelled', 'no_show')) as previous_opd_booked,
      count(distinct lead_id) filter (where starts_on < month_start and kind in ('opdBooked', 'opdDone') and status = 'completed') as previous_opd_done,
      count(distinct lead_id) filter (where starts_on < month_start and kind = 'ipdDone' and status in ('booked', 'confirmed', 'arrived')) as previous_ipd_booked,
      count(distinct lead_id) filter (where starts_on < month_start and kind = 'ipdDone' and status = 'completed') as previous_ipd_done
    from scoped
  ),
  agent_totals as (
    select assigned_to,
      count(distinct lead_id) filter (where starts_on >= month_start and kind = 'opdBooked' and status not in ('cancelled', 'no_show')) as opd_booked,
      count(distinct lead_id) filter (where starts_on >= month_start and kind in ('opdBooked', 'opdDone') and status = 'completed') as opd_done,
      count(distinct lead_id) filter (where starts_on >= month_start and kind = 'ipdDone' and status in ('booked', 'confirmed', 'arrived')) as ipd_booked,
      count(distinct lead_id) filter (where starts_on >= month_start and kind = 'ipdDone' and status = 'completed') as ipd_done
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
    'previousPeriod', jsonb_build_object('from', previous_month_start, 'to', month_start - 1),
    'previousMonthCounts', jsonb_build_object(
      'opdBooked', totals.previous_opd_booked, 'opdDone', totals.previous_opd_done,
      'ipdBooked', totals.previous_ipd_booked, 'ipdDone', totals.previous_ipd_done
    ),
    'byAgent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignedTo', agent_totals.assigned_to,
        'opdBooked', agent_totals.opd_booked, 'opdDone', agent_totals.opd_done,
        'ipdBooked', agent_totals.ipd_booked, 'ipdDone', agent_totals.ipd_done
      ) order by agent_totals.assigned_to)
      from agent_totals
    ), '[]'::jsonb)
  ) into result from totals;
  return result;
end;
$function$;

revoke all on function public.crm_monthly_appointment_summary(text) from public, anon;
grant execute on function public.crm_monthly_appointment_summary(text) to authenticated;
