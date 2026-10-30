-- Preserve existing assignment and closed-status behaviour. Only future edits
-- to a lead already assigned to the same agent count as a touch; assignment
-- alone and an explicit fresh transfer do not.
create or replace function crm_private.track_agent_lead_workflow()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  actor_role text;
  actor_name text;
  assigned_name text;
  same_assignee boolean;
  changed_payload boolean;
begin
  assigned_name := nullif(btrim(coalesce(new.assigned_to, '')), '');
  if lower(coalesce(assigned_name, '')) in ('-', 'unassigned') then assigned_name := null; end if;

  if tg_op = 'INSERT' then
    if assigned_name is not null then
      new.assigned_at := coalesce(new.assigned_at, now());
      new.assigned_fresh_since := coalesce(new.assigned_fresh_since, new.assigned_at, now());
    else
      new.assigned_fresh_since := null;
    end if;
    if public.crm_is_closed_lead_status(new.status) then
      new.closed_status_since := coalesce(new.closed_status_since, now());
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

  if public.crm_is_closed_lead_status(new.status) then
    if not public.crm_is_closed_lead_status(old.status) then
      new.closed_status_since := now();
    else
      new.closed_status_since := coalesce(old.closed_status_since, new.closed_status_since, now());
    end if;
  else
    new.closed_status_since := null;
  end if;

  if auth.uid() is not null and assigned_name is not null and same_assignee then
    select p.role::text, p.name into actor_role, actor_name
    from public.profiles p where p.id = auth.uid();
    changed_payload := (to_jsonb(new) - array[
      'updated_at', 'assigned_at', 'assigned_fresh_since', 'first_agent_touch_at',
      'closed_status_since', 'workflow_bucket', 'assignment_batch_id'
    ]) is distinct from (to_jsonb(old) - array[
      'updated_at', 'assigned_at', 'assigned_fresh_since', 'first_agent_touch_at',
      'closed_status_since', 'workflow_bucket', 'assignment_batch_id'
    ]);
    if changed_payload
       and (actor_role in ('admin', 'manager') or
         (actor_role = 'employee' and lower(btrim(coalesce(actor_name, ''))) = lower(assigned_name)))
       and not (actor_role in ('admin', 'manager') and old.first_agent_touch_at is not null and new.first_agent_touch_at is null)
    then
      new.first_agent_touch_at := coalesce(new.first_agent_touch_at, now());
    end if;
  end if;
  return new;
end;
$function$;

-- Record the previous owner for new events only; existing history is retained.
alter table public.crm_assignment_events
  add column if not exists previous_assigned_to text,
  add column if not exists event_kind text;

create or replace function crm_private.track_assignment()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  previous_name text;
begin
  if btrim(coalesce(new.assigned_to, '')) not in ('', '-')
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    if tg_op = 'UPDATE' then
      previous_name := nullif(btrim(coalesce(old.assigned_to, '')), '');
      if lower(coalesce(previous_name, '')) in ('-', 'unassigned') then previous_name := null; end if;
    end if;
    insert into public.crm_assignment_events
      (lead_id, assigned_profile_id, assigned_to, assigned_at, actor_id, previous_assigned_to, event_kind)
    values
      (new.id, (select id from public.profiles where lower(btrim(name)) = lower(btrim(new.assigned_to)) limit 1),
       new.assigned_to, coalesce(new.assigned_at, now()), auth.uid(), previous_name,
       case when previous_name is null then 'assignment' else 'transfer' end);
  end if;
  return new;
end;
$function$;
