-- Admin edits that change ownership must create their batch and update the
-- lead in one transaction. This prevents stale edits from leaving orphaned
-- assignment batches and keeps all edited fields together.
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
     or exists (select 1 from jsonb_object_keys(p_updates) as item(key) where not (item.key = any(fields))) then
    raise exception using errcode = '22023', message = 'The lead update contains invalid fields.';
  end if;
  if p_send_as_fresh is null then
    raise exception using errcode = '22023', message = 'Choose whether to keep the status or send this lead as fresh.';
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
  return updated_lead;
end;
$function$;

revoke all on function public.crm_update_lead_details_admin(uuid, jsonb, timestamptz, boolean) from public, anon;
grant execute on function public.crm_update_lead_details_admin(uuid, jsonb, timestamptz, boolean) to authenticated;
