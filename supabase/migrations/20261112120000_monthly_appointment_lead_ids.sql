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
begin
  if viewer_id is null or viewer_role not in ('admin', 'manager', 'employee') then
    raise exception 'Sign in to view monthly appointment leads';
  end if;

  select p.name into viewer_name from public.profiles p where p.id = viewer_id;
  if viewer_role = 'employee' then p_assigned_to := viewer_name; end if;

  return query
    select distinct a.lead_id as id
    from public.crm_appointments a
    join public.leads l on l.id = a.lead_id
    where a.starts_on >= month_start
      and a.starts_on < (month_start + interval '1 month')::date
      and (p_assigned_to is null or lower(btrim(l.assigned_to)) = lower(btrim(p_assigned_to)))
      and case p_kind
        when 'opdBooked' then a.kind = 'opdBooked' and a.status not in ('cancelled', 'no_show')
        when 'opdDone' then a.kind in ('opdBooked', 'opdDone') and a.status = 'completed'
        when 'ipdBooked' then a.kind = 'ipdDone' and a.status in ('booked', 'confirmed', 'arrived')
        when 'ipdDone' then a.kind = 'ipdDone' and a.status = 'completed'
        else false
      end
    order by id;
end;
$function$;

revoke all on function public.crm_monthly_appointment_lead_ids(text, text, date) from public, anon;
grant execute on function public.crm_monthly_appointment_lead_ids(text, text, date) to authenticated;