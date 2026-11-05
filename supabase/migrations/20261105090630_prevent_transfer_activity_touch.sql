-- A transfer history entry is created inside the lead update trigger. It must
-- not recursively update the same lead or count assignment as agent work.
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
  if lower(btrim(coalesce(new.action_type, ''))) in ('automation', 'assignment', 'transfer', 'import', 'created') then
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
