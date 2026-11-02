-- Keep the initial sheet disposition visible until CRM explicitly changes the
-- status or schedules/clears a real follow-up date. This distinguishes an
-- imported "Follow-Up" label from a CRM follow-up with an active calendar date.
alter table public.leads
  add column if not exists imported_status text;

create or replace function crm_private.clear_imported_status_after_crm_change()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if old.imported_status is not null
     and (new.status is distinct from old.status
       or new.follow_up_date is distinct from old.follow_up_date) then
    new.imported_status := null;
  end if;
  return new;
end;
$function$;

revoke all on function crm_private.clear_imported_status_after_crm_change() from public, anon, authenticated;
drop trigger if exists crm_clear_imported_status_after_crm_change on public.leads;
create trigger crm_clear_imported_status_after_crm_change
before update of status, follow_up_date on public.leads
for each row execute function crm_private.clear_imported_status_after_crm_change();
