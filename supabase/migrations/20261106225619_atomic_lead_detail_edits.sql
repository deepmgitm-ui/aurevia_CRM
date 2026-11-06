-- Commit detail edits and their timeline receipt together so a partial write
-- cannot leave the drawer showing an unlogged or stale change.
create or replace function public.crm_update_lead_details(
  p_lead_id uuid,
  p_updates jsonb,
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
  old_values jsonb;
  new_values jsonb;
  field_name text;
  field_label text;
  change_items text[] := array[]::text[];
  activity_type text;
  has_changes boolean := false;
  fields text[] := array[
    'name', 'phone', 'email', 'gender', 'city', 'disease',
    'insurance_status', 'remarks', 'status', 'assigned_to',
    'lead_date', 'follow_up_date', 'source'
  ];
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Sign in before editing leads.';
  end if;
  select p.role::text into actor_role from public.profiles p where p.id = actor_id;
  if actor_role is null or actor_role not in ('admin', 'manager', 'employee') then
    raise exception using errcode = '42501', message = 'Your account cannot edit leads.';
  end if;
  if p_lead_id is null or p_expected_updated_at is null
     or jsonb_typeof(p_updates) is distinct from 'object'
     or p_updates = '{}'::jsonb
     or exists (
       select 1 from jsonb_object_keys(p_updates) as item(key)
       where not (item.key = any(fields))
          or jsonb_typeof(p_updates->item.key) is distinct from 'string'
     ) then
    raise exception using errcode = '22023', message = 'The lead update contains invalid fields.';
  end if;
  if p_updates ? 'assigned_to' and actor_role is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Only admins can assign or transfer leads.';
  end if;
  if p_updates ? 'source' and actor_role not in ('admin', 'manager') then
    raise exception using errcode = '42501', message = 'Only admins and managers can update lead sources.';
  end if;
  if p_updates ? 'status' and p_updates->>'status' not in (
    'New', 'Follow-Up', 'DNP', 'DNP2', 'DNP3', 'RNR',
    'Not Interested', 'Didn’t Enquired', 'Budget Issue', 'Location Issue',
    'Language Issue', 'Non Surgical', 'OPD Booked', 'OPD Done',
    'IPD Done', 'IPD Booked', 'Dropped', 'Invalid Number', 'CallBack',
    'Wrong Number'
  ) then
    raise exception using errcode = '22023', message = 'Choose one of the available lead statuses.';
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
  if p_updates ? 'assigned_to'
     and p_updates->>'assigned_to' is distinct from coalesce(current_lead.assigned_to, '') then
    raise exception using errcode = '42501', message = 'Assignment changes must use the admin transfer flow.';
  end if;
  old_values := to_jsonb(current_lead);
  foreach field_name in array fields loop
    if p_updates ? field_name and old_values->>field_name is distinct from p_updates->>field_name then
      has_changes := true;
      exit;
    end if;
  end loop;
  if not has_changes then return current_lead; end if;

  update public.leads l
  set name = case when p_updates ? 'name' then p_updates->>'name' else l.name end,
      phone = case when p_updates ? 'phone' then p_updates->>'phone' else l.phone end,
      email = case when p_updates ? 'email' then p_updates->>'email' else l.email end,
      gender = case when p_updates ? 'gender' then p_updates->>'gender' else l.gender end,
      city = case when p_updates ? 'city' then p_updates->>'city' else l.city end,
      disease = case when p_updates ? 'disease' then p_updates->>'disease' else l.disease end,
      insurance_status = case when p_updates ? 'insurance_status' then p_updates->>'insurance_status' else l.insurance_status end,
      remarks = case when p_updates ? 'remarks' then p_updates->>'remarks' else l.remarks end,
      status = case when p_updates ? 'status' then p_updates->>'status' else l.status end,
      assigned_to = case when p_updates ? 'assigned_to' then p_updates->>'assigned_to' else l.assigned_to end,
      lead_date = case when p_updates ? 'lead_date' then p_updates->>'lead_date' else l.lead_date end,
      follow_up_date = case when p_updates ? 'follow_up_date' then p_updates->>'follow_up_date' else l.follow_up_date end,
      source = case when p_updates ? 'source' then p_updates->>'source' else l.source end
  where l.id = p_lead_id
  returning l.* into updated_lead;
  if not found then
    raise exception using errcode = '40001', message = 'This lead changed or is no longer available. Reopen it and try again.';
  end if;

  old_values := to_jsonb(current_lead);
  new_values := to_jsonb(updated_lead);
  foreach field_name in array fields loop
    if p_updates ? field_name and old_values->>field_name is distinct from new_values->>field_name then
      field_label := case field_name
        when 'name' then 'Patient name'
        when 'phone' then 'Phone number'
        when 'email' then 'Email'
        when 'gender' then 'Gender'
        when 'city' then 'City'
        when 'disease' then 'Treatment / disease'
        when 'insurance_status' then 'Insurance status'
        when 'remarks' then 'Remarks'
        when 'status' then 'Status'
        when 'assigned_to' then 'Assignment'
        when 'lead_date' then 'Lead date'
        when 'follow_up_date' then 'Follow-up date'
        when 'source' then 'Source'
      end;
      if field_name = 'status' then
        change_items := array_append(change_items, format('Status: %s → %s', coalesce(nullif(btrim(old_values->>'status'), ''), '—'), new_values->>'status'));
      elsif field_name in ('lead_date', 'follow_up_date') then
        change_items := array_append(change_items, format('%s: %s → %s', field_label, coalesce(nullif(btrim(old_values->>field_name), ''), '—'), coalesce(nullif(btrim(new_values->>field_name), ''), '—')));
      else
        change_items := array_append(change_items, field_label || ' updated');
      end if;
    end if;
  end loop;

  if cardinality(change_items) > 0 then
    activity_type := case when current_lead.status is distinct from updated_lead.status
      then 'Status changed' else 'Lead details updated' end;
    insert into public.lead_activities(lead_id, user_id, action_type, description)
    values (p_lead_id, actor_id, activity_type, 'Changed: ' || array_to_string(change_items, '; ') || '.');
  end if;
  return updated_lead;
end;
$function$;

revoke all on function public.crm_update_lead_details(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.crm_update_lead_details(uuid, jsonb, timestamptz) to authenticated;

-- Keep single-lead assignment, the edit and its timeline entry in one commit.
create or replace function public.crm_update_lead_details_admin(
  p_lead_id uuid,
  p_updates jsonb,
  p_expected_updated_at timestamptz default null,
  p_send_as_fresh boolean default false
)
returns public.leads
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  actor_id uuid := (select auth.uid());
  actor_name text;
  actor_role text;
  current_lead public.leads%rowtype;
  updated_lead public.leads%rowtype;
  target_name text;
  next_batch_id uuid;
  assignment_changed boolean := false;
  assignment_at timestamptz := now();
  has_changes boolean := false;
  old_values jsonb;
  new_values jsonb;
  field_name text;
  field_label text;
  change_items text[] := array[]::text[];
  activity_type text;
  fields text[] := array[
    'name', 'phone', 'email', 'gender', 'city', 'disease',
    'insurance_status', 'remarks', 'status', 'assigned_to',
    'lead_date', 'follow_up_date', 'source'
  ];
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Sign in before editing leads.';
  end if;
  select p.role::text, p.name into actor_role, actor_name
  from public.profiles p where p.id = actor_id;
  if actor_role is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Only admins can change lead assignments.';
  end if;
  if p_lead_id is null or jsonb_typeof(p_updates) is distinct from 'object'
     or p_updates = '{}'::jsonb
     or exists (
       select 1 from jsonb_object_keys(p_updates) as item(key)
       where not (item.key = any(fields))
          or jsonb_typeof(p_updates->item.key) is distinct from 'string'
     ) then
    raise exception using errcode = '22023', message = 'The lead update contains invalid fields.';
  end if;
  if p_send_as_fresh is null then
    raise exception using errcode = '22023', message = 'Choose whether to keep the status or send this lead as fresh.';
  end if;
  if p_updates ? 'status' and p_updates->>'status' not in (
    'New', 'Follow-Up', 'DNP', 'DNP2', 'DNP3', 'RNR',
    'Not Interested', 'Didn’t Enquired', 'Budget Issue', 'Location Issue',
    'Language Issue', 'Non Surgical', 'OPD Booked', 'OPD Done',
    'IPD Done', 'IPD Booked', 'Dropped', 'Invalid Number', 'CallBack',
    'Wrong Number'
  ) then
    raise exception using errcode = '22023', message = 'Choose one of the available lead statuses.';
  end if;

  select l.* into current_lead
  from public.leads l
  where l.id = p_lead_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Lead not found.';
  end if;
  if p_expected_updated_at is not null and current_lead.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'This lead changed while you were editing. Reopen it and try again.';
  end if;

  target_name := case when p_updates ? 'assigned_to'
    then coalesce(nullif(btrim(p_updates->>'assigned_to'), ''), '-')
    else coalesce(current_lead.assigned_to, '-') end;
  assignment_changed := p_updates ? 'assigned_to'
    and target_name is distinct from coalesce(current_lead.assigned_to, '');
  old_values := to_jsonb(current_lead);
  if assignment_changed and p_send_as_fresh then
    has_changes := true;
  else
    foreach field_name in array fields loop
      if p_updates ? field_name and old_values->>field_name is distinct from p_updates->>field_name then
        has_changes := true;
        exit;
      end if;
    end loop;
  end if;
  if not has_changes then return current_lead; end if;

  if assignment_changed and lower(target_name) not in ('-', 'unassigned') then
    if not exists (select 1 from public.profiles p where p.name = target_name) then
      raise exception using errcode = '22023', message = 'That team member is unavailable for assignment.';
    end if;
    insert into public.crm_assignment_batches(label, created_by, created_by_name, target_names, lead_count)
    values (
      left('Assignment - ' || to_char(assignment_at at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM') || ' - ' || target_name, 120),
      actor_id,
      coalesce(nullif(btrim(actor_name), ''), 'Team member'),
      array[target_name],
      1
    ) returning id into next_batch_id;
  elsif assignment_changed then
    next_batch_id := null;
  end if;

  update public.leads l
  set name = case when p_updates ? 'name' then p_updates->>'name' else l.name end,
      phone = case when p_updates ? 'phone' then p_updates->>'phone' else l.phone end,
      email = case when p_updates ? 'email' then p_updates->>'email' else l.email end,
      gender = case when p_updates ? 'gender' then p_updates->>'gender' else l.gender end,
      city = case when p_updates ? 'city' then p_updates->>'city' else l.city end,
      disease = case when p_updates ? 'disease' then p_updates->>'disease' else l.disease end,
      insurance_status = case when p_updates ? 'insurance_status' then p_updates->>'insurance_status' else l.insurance_status end,
      remarks = case when p_updates ? 'remarks' then p_updates->>'remarks' else l.remarks end,
      assigned_to = case when assignment_changed then target_name else l.assigned_to end,
      assignment_batch_id = case when assignment_changed then next_batch_id else l.assignment_batch_id end,
      assigned_at = case when assignment_changed and lower(target_name) not in ('-', 'unassigned') then assignment_at else l.assigned_at end,
      lead_date = case when p_updates ? 'lead_date' then p_updates->>'lead_date' else l.lead_date end,
      follow_up_date = case when p_send_as_fresh and assignment_changed then '-'
        when p_updates ? 'follow_up_date' then p_updates->>'follow_up_date' else l.follow_up_date end,
      source = case when p_updates ? 'source' then p_updates->>'source' else l.source end,
      status = case when p_send_as_fresh and assignment_changed then 'New'
        when p_updates ? 'status' then p_updates->>'status' else l.status end,
      assigned_fresh_since = case when p_send_as_fresh and assignment_changed then assignment_at else l.assigned_fresh_since end,
      first_agent_touch_at = case when p_send_as_fresh and assignment_changed then null else l.first_agent_touch_at end
  where l.id = p_lead_id
  returning l.* into updated_lead;
  if not found then
    raise exception using errcode = '40001', message = 'This lead changed or is no longer available. Reopen it and try again.';
  end if;

  old_values := to_jsonb(current_lead);
  new_values := to_jsonb(updated_lead);
  foreach field_name in array fields loop
    if p_updates ? field_name and old_values->>field_name is distinct from new_values->>field_name then
      field_label := case field_name
        when 'name' then 'Patient name'
        when 'phone' then 'Phone number'
        when 'email' then 'Email'
        when 'gender' then 'Gender'
        when 'city' then 'City'
        when 'disease' then 'Treatment / disease'
        when 'insurance_status' then 'Insurance status'
        when 'remarks' then 'Remarks'
        when 'status' then 'Status'
        when 'assigned_to' then 'Assignment'
        when 'lead_date' then 'Lead date'
        when 'follow_up_date' then 'Follow-up date'
        when 'source' then 'Source'
      end;
      if field_name = 'status' then
        change_items := array_append(change_items, format('Status: %s → %s', coalesce(nullif(btrim(old_values->>'status'), ''), '—'), new_values->>'status'));
      elsif field_name in ('lead_date', 'follow_up_date') then
        change_items := array_append(change_items, format('%s: %s → %s', field_label, coalesce(nullif(btrim(old_values->>field_name), ''), '—'), coalesce(nullif(btrim(new_values->>field_name), ''), '—')));
      else
        change_items := array_append(change_items, field_label || ' updated');
      end if;
    end if;
  end loop;

  if cardinality(change_items) > 0 then
    activity_type := case when current_lead.status is distinct from updated_lead.status
      then 'Status changed' else 'Lead details updated' end;
    insert into public.lead_activities(lead_id, user_id, action_type, description)
    values (p_lead_id, actor_id, activity_type, 'Changed: ' || array_to_string(change_items, '; ') || '.');
  end if;
  return updated_lead;
end;
$function$;

revoke all on function public.crm_update_lead_details_admin(uuid, jsonb, timestamptz, boolean) from public, anon;
grant execute on function public.crm_update_lead_details_admin(uuid, jsonb, timestamptz, boolean) to authenticated;
