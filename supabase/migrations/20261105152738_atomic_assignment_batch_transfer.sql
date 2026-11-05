-- Keep bulk assignment-batch transfers and their roster change atomic.
-- A failed lead update or roster update rolls the whole transfer back.
create or replace function public.crm_transfer_assignment_batch(
  p_batch_id uuid,
  p_target_name text,
  p_as_fresh boolean default false
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  actor_role text;
  target_name text;
  assignment_at timestamptz := now();
  transferred integer;
  batch_rows integer;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Sign in before transferring an assignment batch.';
  end if;

  select p.role::text into actor_role
  from public.profiles p
  where p.id = (select auth.uid());
  if actor_role is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Only admins can transfer assignment batches.';
  end if;

  target_name := nullif(btrim(coalesce(p_target_name, '')), '');
  if target_name is null or lower(target_name) in ('-', 'unassigned') then
    raise exception using errcode = '22023', message = 'Select a valid team member.';
  end if;
  if not exists (select 1 from public.profiles p where p.name = target_name) then
    raise exception using errcode = '22023', message = 'That team member is unavailable for assignment.';
  end if;

  perform b.id
  from public.crm_assignment_batches b
  where b.id = p_batch_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Assignment batch not found.';
  end if;

  if p_as_fresh is true then
    update public.leads l
    set assigned_to = target_name,
        status = 'New',
        follow_up_date = '-',
        assigned_at = assignment_at,
        assigned_fresh_since = assignment_at,
        first_agent_touch_at = null
    where l.assignment_batch_id = p_batch_id
      and l.assigned_to is distinct from target_name;
  else
    update public.leads l
    set assigned_to = target_name,
        assigned_at = assignment_at
    where l.assignment_batch_id = p_batch_id
      and l.assigned_to is distinct from target_name;
  end if;
  get diagnostics transferred = row_count;

  if transferred > 0 then
    update public.crm_assignment_batches
    set target_names = array[target_name]
    where id = p_batch_id;
    get diagnostics batch_rows = row_count;
    if batch_rows <> 1 then
      raise exception using errcode = '40001', message = 'The assignment batch could not be updated. No leads were transferred.';
    end if;
  end if;

  return transferred;
end;
$function$;

revoke all on function public.crm_transfer_assignment_batch(uuid, text, boolean) from public, anon;
grant execute on function public.crm_transfer_assignment_batch(uuid, text, boolean) to authenticated;
