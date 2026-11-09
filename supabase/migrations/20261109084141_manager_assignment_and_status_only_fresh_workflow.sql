-- Let managers run standard lead assignment flows, while the database itself
-- limits manager targets to employee accounts. Keep all existing validation,
-- atomic updates, and assignment history triggers intact.
do $migration$
declare
  function_signature text;
  function_definition text;
  old_fragment text;
  new_fragment text;
  replacement_count integer;
begin
  foreach function_signature in array array[
    'public.crm_assign_leads_bulk(jsonb,text,boolean,boolean,uuid)',
    'public.crm_transfer_assignment_batch(uuid,text,boolean)',
    'public.crm_add_leads_to_assignment_batch(uuid,jsonb)',
    'public.crm_update_lead_details_admin(uuid,jsonb,timestamp with time zone,boolean)'
  ] loop
    function_definition := pg_get_functiondef(function_signature::regprocedure);

    old_fragment := 'if actor_role is distinct from ''admin'' then';
    new_fragment := 'if actor_role not in (''admin'', ''manager'') then';
    replacement_count := (length(function_definition) - length(replace(function_definition, old_fragment, ''))) / length(old_fragment);
    if replacement_count <> 1 then
      raise exception 'Expected one admin-only role check in %, found %', function_signature, replacement_count;
    end if;
    function_definition := replace(function_definition, old_fragment, new_fragment);

    if function_signature = 'public.crm_assign_leads_bulk(jsonb,text,boolean,boolean,uuid)' then
      old_fragment := 'where not exists (select 1 from public.profiles p where p.name = selected_target.name)';
      new_fragment := 'where not exists (select 1 from public.profiles p where p.name = selected_target.name and (actor_role = ''admin'' or p.role::text = ''employee''))';
    elsif function_signature = 'public.crm_transfer_assignment_batch(uuid,text,boolean)' then
      old_fragment := 'if not exists (select 1 from public.profiles p where p.name = target_name) then';
      new_fragment := 'if not exists (select 1 from public.profiles p where p.name = target_name and (actor_role = ''admin'' or p.role::text = ''employee'')) then';
    elsif function_signature = 'public.crm_add_leads_to_assignment_batch(uuid,jsonb)' then
      old_fragment := 'or not exists (select 1 from public.profiles p where p.name = selected.name)';
      new_fragment := 'or not exists (select 1 from public.profiles p where p.name = selected.name and (actor_role = ''admin'' or p.role::text = ''employee''))';
    else
      old_fragment := 'if not exists (select 1 from public.profiles p where p.name = target_name) then';
      new_fragment := 'if not exists (select 1 from public.profiles p where p.name = target_name and (actor_role = ''admin'' or p.role::text = ''employee'')) then';
    end if;
    replacement_count := (length(function_definition) - length(replace(function_definition, old_fragment, ''))) / length(old_fragment);
    if replacement_count <> 1 then
      raise exception 'Expected one target-role check in %, found %', function_signature, replacement_count;
    end if;
    function_definition := replace(function_definition, old_fragment, new_fragment);

    if function_signature = 'public.crm_update_lead_details_admin(uuid,jsonb,timestamp with time zone,boolean)' then
      old_fragment := E'\n  update public.leads l\n  set name =';
      new_fragment := E'\n  perform set_config(''crm.assignment_as_fresh'', p_send_as_fresh::text, true);\n\n  update public.leads l\n  set name =';
      replacement_count := (length(function_definition) - length(replace(function_definition, old_fragment, ''))) / length(old_fragment);
      if replacement_count <> 1 then
        raise exception 'Could not mark the single-lead Fresh transfer mode in %', function_signature;
      end if;
      function_definition := replace(function_definition, old_fragment, new_fragment);
    end if;

    execute function_definition;
  end loop;
end;
$migration$;

-- Keep call/touch/note events in the activity log without treating a note or
-- opening the record as a disposition change that removes a lead from Fresh.
create or replace function crm_private.mark_agent_touch_from_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  return new;
end;
$function$;

-- A Fresh lead leaves that bucket only when its status actually changes.
-- Assignment timestamps and Fresh resets keep their existing behavior.
create or replace function crm_private.track_agent_lead_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_role text;
  actor_name text;
  assigned_name text;
  authorized_actor boolean := false;
  assignment_fresh_reset boolean := false;
begin
  assigned_name := nullif(btrim(coalesce(new.assigned_to, '')), '');
  if lower(coalesce(assigned_name, '')) in ('-', 'unassigned') then assigned_name := null; end if;

  if tg_op = 'INSERT' then
    new.fresh_pending_since := coalesce(new.fresh_pending_since, now());
    if assigned_name is not null then
      new.assigned_at := coalesce(new.assigned_at, now());
      new.assigned_fresh_since := coalesce(new.assigned_fresh_since, new.assigned_at, now());
    else
      new.assigned_fresh_since := null;
    end if;
    if public.crm_is_closed_lead_status(new.status) then
      new.closed_status_since := null;
    end if;
    return new;
  end if;

  if lower(btrim(coalesce(new.assigned_to, ''))) is distinct from lower(btrim(coalesce(old.assigned_to, ''))) then
    if assigned_name is null then
      new.assigned_fresh_since := null;
      new.assigned_at := null;
    else
      new.assigned_at := now();
      new.assigned_fresh_since := now();
    end if;
  end if;

  if new.status is distinct from old.status and auth.uid() is not null then
    select p.role::text, p.name into actor_role, actor_name
    from public.profiles p where p.id = auth.uid();
    authorized_actor := actor_role in ('admin', 'manager') or
      (actor_role = 'employee' and lower(btrim(coalesce(actor_name, ''))) = lower(coalesce(assigned_name, '')));
    assignment_fresh_reset := case
      when nullif(current_setting('crm.assignment_as_fresh', true), '') is not null
        then current_setting('crm.assignment_as_fresh', true) = 'true'
      else new.status = 'New'
        and new.first_agent_touch_at is null
        and new.assigned_fresh_since is distinct from old.assigned_fresh_since
    end;

    if authorized_actor and not assignment_fresh_reset then
      new.first_agent_touch_at := coalesce(new.first_agent_touch_at, now());
      new.fresh_pending_since := null;
    end if;
  end if;

  if public.crm_is_closed_lead_status(new.status) then
    if new.first_agent_touch_at is null then
      new.closed_status_since := null;
    elsif not public.crm_is_closed_lead_status(old.status) or old.first_agent_touch_at is null then
      new.closed_status_since := now();
    else
      new.closed_status_since := coalesce(old.closed_status_since, new.closed_status_since, now());
    end if;
  else
    new.closed_status_since := null;
  end if;
  return new;
end;
$function$;

-- Persist the patient identity alongside every status-change receipt so a
-- timeline export or notification remains understandable outside the row.
create or replace function crm_private.identify_status_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  patient_name text;
  patient_phone text;
begin
  if lower(btrim(coalesce(new.action_type, ''))) <> 'status changed'
     or new.lead_id is null
     or coalesce(new.description, '') like 'Patient:%' then
    return new;
  end if;

  select l.name, l.phone into patient_name, patient_phone
  from public.leads l where l.id = new.lead_id;
  new.description := format(
    'Patient: %s · %s | %s',
    coalesce(nullif(btrim(patient_name), ''), 'Unknown'),
    coalesce(nullif(btrim(patient_phone), ''), 'No phone'),
    coalesce(nullif(btrim(new.description), ''), 'Status updated')
  );
  return new;
end;
$function$;

revoke all on function crm_private.identify_status_activity() from public, anon, authenticated;
drop trigger if exists crm_identify_status_activity on public.lead_activities;
create trigger crm_identify_status_activity
before insert on public.lead_activities
for each row execute function crm_private.identify_status_activity();
