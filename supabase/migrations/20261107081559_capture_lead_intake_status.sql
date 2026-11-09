alter table public.leads
  add column if not exists intake_status text;

-- Existing imports have no activity audit for their source disposition. Keep
-- their last reliable intake value before normalizing untouched Fresh leads.
update public.leads
set intake_status = coalesce(
      nullif(btrim(imported_status), ''),
      nullif(btrim(status), ''),
      'New'
    ),
    status = case
      when workflow_bucket = 'fresh' and first_agent_touch_at is null then 'New'
      else status
    end
where intake_status is null
  and (
    imported_status is not null
    or (workflow_bucket = 'fresh' and first_agent_touch_at is null)
  );

create or replace function crm_private.capture_lead_intake_status()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' then
    new.intake_status := old.intake_status;
    return new;
  end if;

  new.intake_status := coalesce(nullif(btrim(new.status), ''), 'New');
  new.status := 'New';
  return new;
end;
$function$;

revoke all on function crm_private.capture_lead_intake_status() from public, anon, authenticated;
drop trigger if exists crm_capture_lead_intake_status on public.leads;
create trigger crm_capture_lead_intake_status
before insert or update on public.leads
for each row execute function crm_private.capture_lead_intake_status();
