create or replace function public.crm_mark_previous_lead_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  previous_owner text := nullif(btrim(coalesce(old.assigned_to, '')), '');
  next_owner text := nullif(btrim(coalesce(new.assigned_to, '')), '');
  actor_id uuid := auth.uid();
  actor_role text;
begin
  if previous_owner in ('-', 'Unassigned') then previous_owner := null; end if;
  if next_owner in ('-', 'Unassigned') then next_owner := null; end if;
  if previous_owner is null or previous_owner is not distinct from next_owner then return new; end if;
  if actor_id is not null then
    select p.role::text into actor_role from public.profiles p where p.id = actor_id;
    if coalesce(actor_role, '') not in ('admin', 'manager') then raise exception 'Only admins and managers can transfer leads'; end if;
  else
    select p.id into actor_id from public.profiles p
    where lower(btrim(p.name)) = lower(btrim(coalesce(next_owner, previous_owner)))
    order by case when p.role::text = 'employee' then 0 else 1 end limit 1;
  end if;
  new.had_previous_assignment := true;
  if actor_id is not null then
    insert into public.lead_activities (lead_id, user_id, action_type, description)
    values (new.id, actor_id, 'Transfer', format(
      'Transferred from %s to %s. Previous notes and call history are retained.',
      coalesce(previous_owner, 'Unassigned'), coalesce(next_owner, 'Unassigned')));
  end if;
  return new;
end;
$function$;
revoke all on function public.crm_mark_previous_lead_assignment() from public, anon, authenticated;
