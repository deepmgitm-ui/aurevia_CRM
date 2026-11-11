-- Keep the prior clinic month's appointment totals available for dashboard comparison.
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
  current_month_start date := date_trunc('month', now() at time zone 'Asia/Kolkata')::date;
  previous_month_start date := (date_trunc('month', now() at time zone 'Asia/Kolkata') - interval '1 month')::date;
  next_month_start date := (date_trunc('month', now() at time zone 'Asia/Kolkata') + interval '1 month')::date;
  result jsonb;
begin
  if viewer_id is null or viewer_role not in ('admin', 'manager', 'employee') then
    raise exception 'Sign in to view monthly appointment counts';
  end if;
  select p.name into viewer_name from public.profiles p where p.id = viewer_id;
  if viewer_role = 'employee' then p_assigned_to := viewer_name; end if;

  with scoped as materialized (
    select a.lead_id, a.kind, a.status, a.starts_on, l.assigned_to
    from public.crm_appointments a
    join public.leads l on l.id = a.lead_id
    where a.starts_on >= previous_month_start
      and a.starts_on < next_month_start
      and (p_assigned_to is null or lower(btrim(l.assigned_to)) = lower(btrim(p_assigned_to)))
  ),
  totals as (
    select
      count(distinct lead_id) filter (where starts_on >= current_month_start and kind = 'opdBooked' and status not in ('cancelled', 'no_show')) as opd_booked,
      count(distinct lead_id) filter (where starts_on >= current_month_start and kind in ('opdBooked', 'opdDone') and status = 'completed') as opd_done,
      count(distinct lead_id) filter (where starts_on >= current_month_start and kind = 'ipdDone' and status in ('booked', 'confirmed', 'arrived')) as ipd_booked,
      count(distinct lead_id) filter (where starts_on >= current_month_start and kind = 'ipdDone' and status = 'completed') as ipd_done,
      count(distinct lead_id) filter (where starts_on < current_month_start and kind = 'opdBooked' and status not in ('cancelled', 'no_show')) as previous_opd_booked,
      count(distinct lead_id) filter (where starts_on < current_month_start and kind in ('opdBooked', 'opdDone') and status = 'completed') as previous_opd_done,
      count(distinct lead_id) filter (where starts_on < current_month_start and kind = 'ipdDone' and status in ('booked', 'confirmed', 'arrived')) as previous_ipd_booked,
      count(distinct lead_id) filter (where starts_on < current_month_start and kind = 'ipdDone' and status = 'completed') as previous_ipd_done
    from scoped
  ),
  agent_totals as (
    select assigned_to,
      count(distinct lead_id) filter (where kind = 'opdBooked' and status not in ('cancelled', 'no_show')) as opd_booked,
      count(distinct lead_id) filter (where kind in ('opdBooked', 'opdDone') and status = 'completed') as opd_done,
      count(distinct lead_id) filter (where kind = 'ipdDone' and status in ('booked', 'confirmed', 'arrived')) as ipd_booked,
      count(distinct lead_id) filter (where kind = 'ipdDone' and status = 'completed') as ipd_done
    from scoped
    where starts_on >= current_month_start
      and nullif(btrim(assigned_to), '') is not null and btrim(assigned_to) <> '-'
    group by assigned_to
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', current_month_start, 'to', next_month_start - 1),
    'previousPeriod', jsonb_build_object('from', previous_month_start, 'to', current_month_start - 1),
    'counts', jsonb_build_object(
      'opdBooked', totals.opd_booked, 'opdDone', totals.opd_done,
      'ipdBooked', totals.ipd_booked, 'ipdDone', totals.ipd_done
    ),
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
  ) into result
  from totals;
  return result;
end;
$function$;

revoke all on function public.crm_monthly_appointment_summary(text) from public, anon;
grant execute on function public.crm_monthly_appointment_summary(text) to authenticated;
