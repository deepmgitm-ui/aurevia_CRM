-- Make the intentional status reset from Send as Fresh visible in the timeline.
-- Assignment and status remain in the same transaction as the lead update.
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
  owner_changed boolean;
  sent_as_fresh boolean := new.status = 'New'
    and old.status is distinct from new.status
    and new.first_agent_touch_at is null
    and new.assigned_fresh_since is not null
    and new.assigned_fresh_since is distinct from old.assigned_fresh_since;
begin
  if previous_owner in ('-', 'Unassigned') then previous_owner := null; end if;
  if next_owner in ('-', 'Unassigned') then next_owner := null; end if;
  owner_changed := previous_owner is distinct from next_owner;
  if not owner_changed and not sent_as_fresh then return new; end if;

  if actor_id is not null then
    select p.role::text into actor_role from public.profiles p where p.id = actor_id;
    if owner_changed and previous_owner is not null
       and coalesce(actor_role, '') not in ('admin', 'manager') then
      raise exception 'Only admins and managers can transfer leads';
    end if;
    if sent_as_fresh and coalesce(actor_role, '') not in ('admin', 'manager') then
      raise exception 'Only admins and managers can send leads as fresh';
    end if;
  else
    select p.id into actor_id from public.profiles p
    where lower(btrim(p.name)) = lower(btrim(coalesce(next_owner, previous_owner)))
    order by case when p.role::text = 'employee' then 0 else 1 end limit 1;
  end if;

  if previous_owner is not null then
    new.had_previous_assignment := true;
  end if;

  if actor_id is not null and owner_changed and previous_owner is not null then
    insert into public.lead_activities (lead_id, user_id, action_type, description)
    values (
      new.id,
      actor_id,
      'Transfer',
      format(
        'Transferred from %s to %s. Previous notes and call history are retained.%s',
        coalesce(previous_owner, 'Unassigned'),
        coalesce(next_owner, 'Unassigned'),
        case when sent_as_fresh then format(
          ' Disposition: %s → New (sent as fresh).',
          coalesce(nullif(btrim(old.status), ''), '—')
        ) else '' end
      )
    );
  elsif actor_id is not null and sent_as_fresh then
    insert into public.lead_activities (lead_id, user_id, action_type, description)
    values (
      new.id,
      actor_id,
      'Assignment',
      format(
        '%s. Disposition: %s → New (sent as fresh).',
        case when owner_changed
          then format('Assigned to %s', coalesce(next_owner, 'Unassigned'))
          else format('Sent to %s as fresh', coalesce(next_owner, 'the current owner'))
        end,
        coalesce(nullif(btrim(old.status), ''), '—')
      )
    );
  end if;
  return new;
end;
$function$;

revoke all on function public.crm_mark_previous_lead_assignment() from public, anon, authenticated;
