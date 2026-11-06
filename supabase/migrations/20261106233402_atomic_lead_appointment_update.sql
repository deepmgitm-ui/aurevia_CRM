-- Save appointment dates and their actor-attributed timeline entry together.
create or replace function public.crm_update_lead_appointment(
  p_lead_id uuid,
  p_column text,
  p_value text,
  p_expected_updated_at timestamptz
)
returns public.leads
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  actor_id uuid := (select auth.uid());
  actor_role text;
  current_lead public.leads%rowtype;
  updated_lead public.leads%rowtype;
  old_date text;
  date_label text;
  parsed_date date;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Sign in before changing an appointment date.';
  end if;
  select p.role::text into actor_role from public.profiles p where p.id = actor_id;
  if actor_role is null or actor_role not in ('admin', 'manager', 'employee') then
    raise exception using errcode = '42501', message = 'Your account cannot edit appointment dates.';
  end if;
  if p_lead_id is null or p_expected_updated_at is null or p_column is null
     or p_column not in ('opd_booked_date', 'opd_done_date', 'ipd_done_date') then
    raise exception using errcode = '22023', message = 'Choose a valid appointment date field and lead.';
  end if;
  if p_value is not null then
    if p_value !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception using errcode = '22023', message = 'Enter a real calendar date or clear the date field.';
    end if;
    begin
      parsed_date := p_value::date;
    exception when others then
      raise exception using errcode = '22023', message = 'Enter a real calendar date or clear the date field.';
    end;
    if to_char(parsed_date, 'YYYY-MM-DD') is distinct from p_value then
      raise exception using errcode = '22023', message = 'Enter a real calendar date or clear the date field.';
    end if;
  end if;

  select l.* into current_lead
  from public.leads l
  where l.id = p_lead_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Lead not found or access denied.';
  end if;
  if current_lead.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'This lead changed while you were editing. Reopen it and try again.';
  end if;

  old_date := case p_column
    when 'opd_booked_date' then current_lead.opd_booked_date
    when 'opd_done_date' then current_lead.opd_done_date
    else current_lead.ipd_done_date
  end;
  if old_date is not distinct from p_value then return current_lead; end if;

  execute pg_catalog.format('update public.leads set %I = $1 where id = $2 returning *', p_column)
    into updated_lead using p_value, p_lead_id;
  if not found then
    raise exception using errcode = '40001', message = 'This lead changed or is no longer available. Reopen it and try again.';
  end if;

  date_label := case p_column
    when 'opd_booked_date' then 'OPD booked date'
    when 'opd_done_date' then 'OPD done date'
    else 'IPD done date'
  end;
  insert into public.lead_activities(lead_id, user_id, action_type, description)
  values (
    p_lead_id,
    actor_id,
    'Appointment date updated',
    format('%s: %s → %s', date_label, coalesce(old_date::text, '—'), coalesce(p_value::text, '—'))
  );
  return updated_lead;
end;
$function$;

revoke all on function public.crm_update_lead_appointment(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.crm_update_lead_appointment(uuid, text, text, timestamptz) to authenticated;
