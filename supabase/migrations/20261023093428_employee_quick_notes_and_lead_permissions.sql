-- Allow workflow timestamps maintained by database triggers to change during
-- an employee's otherwise-permitted lead edit. Assignment and source remain
-- protected, and the existing lead rows are not rewritten by this migration.
create or replace function public.block_employee_core_lead_update()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if public.current_user_role()::text = 'employee' and (
    (to_jsonb(new) - array[
      'name', 'phone', 'email', 'gender', 'city', 'disease',
      'insurance_status', 'remarks', 'status', 'temperature',
      'lead_date', 'follow_up_date', 'opd_booked_date',
      'opd_done_date', 'ipd_done_date', 'updated_at',
      'assigned_fresh_since', 'first_agent_touch_at', 'closed_status_since',
      'lead_day', 'follow_up_day', 'treatment_key', 'workflow_bucket'
    ]) is distinct from
    (to_jsonb(old) - array[
      'name', 'phone', 'email', 'gender', 'city', 'disease',
      'insurance_status', 'remarks', 'status', 'temperature',
      'lead_date', 'follow_up_date', 'opd_booked_date',
      'opd_done_date', 'ipd_done_date', 'updated_at',
      'assigned_fresh_since', 'first_agent_touch_at', 'closed_status_since',
      'lead_day', 'follow_up_day', 'treatment_key', 'workflow_bucket'
    ])
  ) then
    raise exception 'You can update lead details and notes. Assignment and source can only be changed by admins and managers.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

-- A quick note updates both the visible Remarks field and the activity timeline
-- atomically. SECURITY INVOKER keeps the caller's existing RLS permissions in
-- force for both writes.
create or replace function public.crm_add_lead_note(p_lead_id uuid, p_note text)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  clean_note text := btrim(coalesce(p_note, ''));
  current_remarks text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to add a note';
  end if;
  if p_lead_id is null or length(clean_note) < 1 or length(clean_note) > 5000 then
    raise exception 'Enter a note between 1 and 5000 characters';
  end if;

  select l.remarks into current_remarks
  from public.leads l
  where l.id = p_lead_id
  for update;
  if not found then
    raise exception 'Lead not found or you do not have access to it';
  end if;

  update public.leads
  set remarks = concat_ws(E'\n', nullif(nullif(current_remarks, '-'), ''), clean_note)
  where id = p_lead_id;
  if not found then
    raise exception 'You do not have permission to update this lead';
  end if;

  insert into public.lead_activities (lead_id, user_id, action_type, description)
  values (p_lead_id, auth.uid(), 'Note', clean_note);
end;
$function$;

revoke all on function public.crm_add_lead_note(uuid, text) from public, anon;
grant execute on function public.crm_add_lead_note(uuid, text) to authenticated;
