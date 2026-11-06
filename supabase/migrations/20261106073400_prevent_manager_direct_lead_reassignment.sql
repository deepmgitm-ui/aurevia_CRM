-- Managers can edit team leads, but assignment is an admin-only operation.
-- Enforce the same boundary at the database layer so direct PostgREST updates
-- cannot bypass the application action checks. Existing lead rows are untouched.
create or replace function public.block_manager_lead_reassignment()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if public.current_user_role()::text = 'manager'
     and new.assigned_to is distinct from old.assigned_to then
    raise exception 'Only admins can assign or transfer leads.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

revoke all on function public.block_manager_lead_reassignment() from public, anon, authenticated;

drop trigger if exists leads_manager_assignment_guard on public.leads;
create trigger leads_manager_assignment_guard
before update of assigned_to on public.leads
for each row execute function public.block_manager_lead_reassignment();
