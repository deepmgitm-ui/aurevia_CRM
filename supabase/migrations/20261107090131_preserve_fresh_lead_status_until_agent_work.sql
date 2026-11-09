-- Keep the source/current disposition visible while untouched records remain
-- in the Fresh workflow bucket. A status-only edit is not an agent touch.

update public.leads
set status = coalesce(nullif(btrim(intake_status), ''), status, 'New')
where workflow_bucket = 'fresh'
  and first_agent_touch_at is null
  and intake_status is not null
  and status is distinct from intake_status;

create or replace function crm_private.capture_lead_intake_status()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' then
    new.intake_status := old.intake_status;
    return new;
  end if;

  new.intake_status := coalesce(nullif(btrim(new.status), ''), 'New');
  return new;
end;
$function$;

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
  same_assignee boolean;
  changed_payload boolean;
  authorized_actor boolean := false;
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

  same_assignee := lower(btrim(coalesce(new.assigned_to, ''))) = lower(btrim(coalesce(old.assigned_to, '')));
  if not same_assignee then
    if assigned_name is null then
      new.assigned_fresh_since := null;
      new.assigned_at := null;
    else
      new.assigned_at := now();
      new.assigned_fresh_since := now();
    end if;
  end if;

  if auth.uid() is not null and same_assignee then
    select p.role::text, p.name into actor_role, actor_name
    from public.profiles p where p.id = auth.uid();
    changed_payload := (to_jsonb(new) - array[
      'status', 'imported_status', 'lead_day', 'follow_up_day', 'treatment_key', 'updated_at', 'assigned_at',
      'assigned_fresh_since', 'first_agent_touch_at', 'fresh_pending_since', 'closed_status_since',
      'workflow_bucket', 'assignment_batch_id'
    ]) is distinct from (to_jsonb(old) - array[
      'status', 'imported_status', 'lead_day', 'follow_up_day', 'treatment_key', 'updated_at', 'assigned_at',
      'assigned_fresh_since', 'first_agent_touch_at', 'fresh_pending_since', 'closed_status_since',
      'workflow_bucket', 'assignment_batch_id'
    ]);
    authorized_actor := actor_role in ('admin', 'manager') or
      (actor_role = 'employee' and lower(btrim(coalesce(actor_name, ''))) = lower(coalesce(assigned_name, '')));

    if changed_payload and authorized_actor
       and not (actor_role in ('admin', 'manager') and old.first_agent_touch_at is not null and new.first_agent_touch_at is null)
    then
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

-- The status restoration above can itself fire the previous workflow trigger.
-- Clear any legacy timer after the new trigger rules are in place.
update public.leads
set closed_status_since = null
where workflow_bucket = 'fresh'
  and first_agent_touch_at is null
  and public.crm_is_closed_lead_status(status)
  and closed_status_since is not null;

delete from public.crm_lead_deletion_reviews r
using public.leads l
where r.lead_id = l.id
  and r.decision = 'pending'
  and l.workflow_bucket = 'fresh'
  and l.first_agent_touch_at is null
  and l.closed_status_since is null
  and public.crm_is_closed_lead_status(l.status);

create or replace function crm_private.mark_agent_touch_from_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_role text;
  actor_name text;
  assigned_name text;
begin
  if lower(btrim(coalesce(new.action_type, ''))) in
    ('automation', 'assignment', 'transfer', 'import', 'created', 'status changed') then
    return new;
  end if;

  select p.role::text, p.name into actor_role, actor_name
  from public.profiles p where p.id = new.user_id;
  if actor_role is null or actor_role not in ('admin', 'manager', 'employee') then return new; end if;

  if actor_role = 'employee' then
    select l.assigned_to into assigned_name from public.leads l where l.id = new.lead_id;
    if lower(btrim(coalesce(assigned_name, ''))) <> lower(btrim(coalesce(actor_name, ''))) then
      return new;
    end if;
  end if;

  update public.leads
  set first_agent_touch_at = coalesce(first_agent_touch_at, new.created_at, now()),
      fresh_pending_since = null
  where id = new.lead_id;
  return new;
end;
$function$;
