-- Appointment completion changes the lead's current disposition. Record that
-- transition in the lead timeline in the same transaction as the status write.
create or replace function public.crm_change_appointment_status(p_id uuid, p_status text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  appointment public.crm_appointments;
  clinic_today date := (now() at time zone 'Asia/Kolkata')::date;
  callback_day date;
  previous_lead_status text;
  next_lead_status text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if p_status not in ('booked', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show') then
    raise exception 'Invalid appointment status';
  end if;

  select * into appointment
  from public.crm_appointments
  where id = p_id
  for update;
  if not found then raise exception 'Appointment unavailable'; end if;
  if p_status = 'completed' and appointment.starts_on > clinic_today then
    raise exception 'A future appointment cannot be completed';
  end if;

  update public.crm_appointments set status = p_status where id = p_id;
  if p_status = 'completed' then
    select l.status into previous_lead_status
    from public.leads l
    where l.id = appointment.lead_id
    for update;
    if not found then raise exception 'Lead unavailable'; end if;

    next_lead_status := case appointment.kind when 'ipdDone' then 'IPD Done' else 'OPD Done' end;
    update public.leads
    set status = next_lead_status,
        opd_done_date = case when appointment.kind in ('opdBooked', 'opdDone') then appointment.starts_on::text else opd_done_date end,
        ipd_done_date = case when appointment.kind = 'ipdDone' then appointment.starts_on::text else ipd_done_date end
    where id = appointment.lead_id;

    if previous_lead_status is distinct from next_lead_status then
      insert into public.lead_activities (lead_id, user_id, action_type, description)
      values (appointment.lead_id, auth.uid(), 'Status changed', coalesce(previous_lead_status, '—') || ' → ' || next_lead_status);
    end if;
  elsif p_status = 'no_show' and appointment.status is distinct from 'no_show' then
    update public.leads
    set follow_up_date = case when follow_up_day is null or follow_up_day <= clinic_today then (clinic_today + 1)::text else follow_up_date end,
        follow_up_at = case when follow_up_day is null or follow_up_day <= clinic_today then null else follow_up_at end
    where id = appointment.lead_id
    returning follow_up_day into callback_day;
    insert into public.lead_activities (lead_id, user_id, action_type, description)
    values (appointment.lead_id, auth.uid(), 'follow_up', 'Appointment marked no-show. Callback follow-up scheduled for ' || coalesce(callback_day::text, (clinic_today + 1)::text) || '.');
  end if;
end;
$$;

revoke all on function public.crm_change_appointment_status(uuid, text) from public, anon;
grant execute on function public.crm_change_appointment_status(uuid, text) to authenticated;

-- Editing an existing calendar appointment may also update the lead status.
-- Keep the old/new status receipt atomic with the appointment and lead updates.
create or replace function public.crm_save_calendar_entry(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  lead_row public.leads;
  appointment public.crm_appointments;
  column_name text;
  appointment_kind text;
  appointment_date date;
  appointment_status text;
  appointment_time time;
  normalized_phone text;
  appointment_id uuid;
  change_status boolean;
  next_lead_status text;
begin
  if auth.uid() is null or coalesce(public.current_user_role()::text, '') <> 'admin' then
    raise exception 'Only admins can edit calendar appointments';
  end if;

  appointment_kind := p->>'kind';
  column_name := case appointment_kind
    when 'opdBooked' then 'opd_booked_date'
    when 'opdDone' then 'opd_done_date'
    when 'ipdDone' then 'ipd_done_date'
  end;
  if column_name is null then raise exception 'Invalid appointment type'; end if;

  appointment_date := (p->>'date')::date;
  appointment_status := coalesce(nullif(p->>'appointmentStatus', ''), case appointment_kind when 'opdDone' then 'completed' else 'booked' end);
  if appointment_status not in ('booked', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show') then
    raise exception 'Invalid appointment status';
  end if;
  if appointment_status = 'completed' and appointment_date > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'A future appointment cannot be completed';
  end if;

  appointment_time := nullif(p->>'time', '')::time;
  change_status := coalesce((p->>'updateStatus')::boolean, false);
  normalized_phone := right(regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g'), 10);
  if normalized_phone = '' then normalized_phone := '-'; end if;
  if length(btrim(coalesce(p->>'name', ''))) = 0 or length(p->>'name') > 200 then raise exception 'Patient name required'; end if;
  if normalized_phone <> '-' and length(normalized_phone) <> 10 then raise exception 'Enter a valid phone'; end if;
  if length(coalesce(p->>'remarks', '')) > 5000 or length(coalesce(p->>'appointmentNotes', '')) > 5000 or length(coalesce(p->>'city', '')) > 200 then
    raise exception 'Patient details are too long';
  end if;
  if normalized_phone <> '-' then perform pg_advisory_xact_lock(hashtextextended(normalized_phone, 0)); end if;

  if p->>'mode' = 'new' then
    if nullif(p->>'assignedTo', '') is not null and not exists(select 1 from public.profiles where name = p->>'assignedTo') then
      raise exception 'Invalid agent';
    end if;
    insert into public.leads(name, phone, city, remarks, status, assigned_to, source, temperature, lead_date, source_batch_id, source_batch_label, source_batch_created_at)
    values (
      btrim(p->>'name'), normalized_phone, coalesce(nullif(btrim(p->>'city'), ''), '-'), coalesce(nullif(btrim(p->>'remarks'), ''), '-'),
      case when appointment_status = 'completed' then case appointment_kind when 'ipdDone' then 'IPD Done' else 'OPD Done' end when appointment_kind = 'ipdDone' then 'IPD Booked' else 'OPD Booked' end,
      coalesce(nullif(p->>'assignedTo', ''), '-'), 'Manual', 'Warm', to_char((now() at time zone 'Asia/Kolkata')::date, 'DD/MM/YYYY'), gen_random_uuid(), 'Calendar entry', now()
    ) returning * into lead_row;
  elsif p->>'mode' = 'existing' then
    select * into lead_row from public.leads where id = (p->>'leadId')::uuid for update;
    if not found then raise exception 'Patient unavailable'; end if;
    if lead_row.updated_at is distinct from (p->>'expectedUpdatedAt')::timestamptz then
      raise exception 'Patient changed elsewhere. Reload before saving';
    end if;
  else
    raise exception 'Invalid entry mode';
  end if;

  if normalized_phone <> '-' and exists(select 1 from public.leads where right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = normalized_phone and id <> lead_row.id) then
    raise exception 'Phone already belongs to another patient';
  end if;

  if nullif(p->>'appointmentId', '') is not null then
    select * into appointment from public.crm_appointments
    where id = (p->>'appointmentId')::uuid and lead_id = lead_row.id
    for update;
    if not found then raise exception 'Appointment unavailable'; end if;
    if appointment.updated_at is distinct from (p->>'expectedAppointmentUpdatedAt')::timestamptz then
      raise exception 'Appointment changed elsewhere. Reopen before saving';
    end if;
    appointment_id := appointment.id;
    update public.crm_appointments set legacy_column = null where lead_id = lead_row.id and legacy_column = column_name and id <> appointment_id;
    update public.crm_appointments
    set kind = appointment_kind, status = appointment_status, starts_on = appointment_date, starts_at = appointment_time,
        notes = coalesce(p->>'appointmentNotes', ''), legacy_column = column_name
    where id = appointment_id;
  else
    update public.crm_appointments set legacy_column = null where lead_id = lead_row.id and legacy_column = column_name;
    insert into public.crm_appointments(lead_id, kind, status, starts_on, starts_at, notes, legacy_column, created_by)
    values (lead_row.id, appointment_kind, appointment_status, appointment_date, appointment_time, coalesce(p->>'appointmentNotes', ''), column_name, auth.uid())
    returning id into appointment_id;
  end if;

  if change_status then
    next_lead_status := case when appointment_status = 'completed' then case appointment_kind when 'ipdDone' then 'IPD Done' else 'OPD Done' end when appointment_kind = 'ipdDone' then 'IPD Booked' else 'OPD Booked' end;
  else
    next_lead_status := lead_row.status;
  end if;

  update public.leads
  set name = btrim(p->>'name'), phone = normalized_phone, city = coalesce(nullif(btrim(p->>'city'), ''), '-'),
      remarks = coalesce(nullif(btrim(p->>'remarks'), ''), '-'),
      opd_booked_date = case when column_name = 'opd_booked_date' then appointment_date::text else opd_booked_date end,
      opd_done_date = case when column_name = 'opd_done_date' then appointment_date::text else opd_done_date end,
      ipd_done_date = case when column_name = 'ipd_done_date' then appointment_date::text else ipd_done_date end,
      status = next_lead_status
  where id = lead_row.id;

  if p->>'mode' = 'existing' and lead_row.status is distinct from next_lead_status then
    insert into public.lead_activities(lead_id, user_id, action_type, description)
    values (lead_row.id, auth.uid(), 'Status changed', coalesce(lead_row.status, '—') || ' → ' || next_lead_status);
  end if;
  insert into public.lead_activities(lead_id, user_id, action_type, description)
  values (lead_row.id, auth.uid(), 'note', 'Calendar appointment saved: ' || appointment_date::text || ' (' || appointment_status || ')');
  return jsonb_build_object('id', lead_row.id, 'appointmentId', appointment_id);
end;
$$;

revoke all on function public.crm_save_calendar_entry(jsonb) from public, anon;
grant execute on function public.crm_save_calendar_entry(jsonb) to authenticated;
