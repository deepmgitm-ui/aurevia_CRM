-- Preserve assignment history when an admin removes a lead from its current owner.
create or replace function crm_private.track_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  previous_name text;
  target_name text;
begin
  target_name := nullif(btrim(coalesce(new.assigned_to, '')), '');
  if lower(coalesce(target_name, '')) in ('-', 'unassigned') then
    target_name := null;
  end if;

  if tg_op = 'INSERT' then
    if target_name is not null then
      insert into public.crm_assignment_events
        (lead_id, assigned_profile_id, assigned_to, assigned_at, actor_id, previous_assigned_to, event_kind)
      values
        (new.id,
         (select id from public.profiles where lower(btrim(name)) = lower(btrim(target_name)) limit 1),
         target_name, coalesce(new.assigned_at, now()), auth.uid(), null, 'assignment');
    end if;
    return new;
  end if;

  previous_name := nullif(btrim(coalesce(old.assigned_to, '')), '');
  if lower(coalesce(previous_name, '')) in ('-', 'unassigned') then
    previous_name := null;
  end if;

  if lower(coalesce(previous_name, '')) is not distinct from lower(coalesce(target_name, '')) then
    return new;
  end if;

  if target_name is null then
    insert into public.crm_assignment_events
      (lead_id, assigned_profile_id, assigned_to, assigned_at, actor_id, previous_assigned_to, event_kind)
    values
      (new.id, null, 'Unassigned', now(), auth.uid(), previous_name, 'unassignment');
  else
    insert into public.crm_assignment_events
      (lead_id, assigned_profile_id, assigned_to, assigned_at, actor_id, previous_assigned_to, event_kind)
    values
      (new.id,
       (select id from public.profiles where lower(btrim(name)) = lower(btrim(target_name)) limit 1),
       target_name, coalesce(new.assigned_at, now()), auth.uid(), previous_name,
       case when previous_name is null then 'assignment' else 'transfer' end);
  end if;

  return new;
end;
$function$;
