-- A CRM follow-up date can be scheduled while the imported disposition remains
-- Follow-Up. Keep the provenance label in that case; clear it only when the
-- actual CRM status changes to a different disposition.
create or replace function crm_private.clear_imported_status_after_crm_change()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if old.imported_status is not null
     and new.status is distinct from old.status then
    new.imported_status := null;
  end if;
  return new;
end;
$function$;
