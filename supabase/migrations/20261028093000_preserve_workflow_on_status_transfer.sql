create or replace function crm_private.track_agent_lead_workflow()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  actor_role text;
  actor_name text;
  assigned_name text;
  changed_payload boolean;
begin
  assigned_name := nullif(btrim(coalesce(new.assigned_to, '')), '');
  if assigned_name in ('-', 'Unassigned') then assigned_name := null; end if;

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

  if lower(btrim(coalesce(new.assigned_to, ''))) is distinct from lower(btrim(coalesce(old.assigned_to, ''))) then
    if assigned_name is null then
      new.assigned_fresh_since := null;
      new.assigned_at := null;
    else
      new.assigned_at := now();
      new.assigned_fresh_since := now();
    end if;
    -- A status-preserving transfer keeps the prior touch marker. The explicit
    -- Fresh Lead action clears it in the same update, while a newly assigned
    -- untouched lead already has no marker to preserve.
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

  if auth.uid() is not null then
    select p.role::text, p.name into actor_role, actor_name
    from public.profiles p where p.id = auth.uid();
    changed_payload := (to_jsonb(new) - array[
      'updated_at', 'assigned_at', 'assigned_fresh_since', 'first_agent_touch_at',
      'closed_status_since', 'workflow_bucket'
    ]) is distinct from (to_jsonb(old) - array[
      'updated_at', 'assigned_at', 'assigned_fresh_since', 'first_agent_touch_at',
      'closed_status_since', 'workflow_bucket'
    ]);
    if actor_role = 'employee'
       and lower(btrim(coalesce(actor_name, ''))) = lower(btrim(coalesce(new.assigned_to, '')))
       and lower(btrim(coalesce(new.assigned_to, ''))) not in ('', '-', 'unassigned')
       and changed_payload then
      new.first_agent_touch_at := coalesce(new.first_agent_touch_at, now());
    end if;
  end if;
  return new;
end;
$function$;
