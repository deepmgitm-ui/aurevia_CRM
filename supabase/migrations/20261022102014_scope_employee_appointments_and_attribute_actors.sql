-- Keep employee appointment access tied to the appointment's current owner.
update public.crm_appointments a
set assigned_profile_id = p.id
from public.leads l
left join public.profiles p
  on lower(btrim(p.name)) = lower(btrim(l.assigned_to))
where a.lead_id = l.id
  and a.assigned_profile_id is distinct from p.id;

create or replace function crm_private.sync_appointment_owner_from_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare owner_profile_id uuid;
begin
  select p.id into owner_profile_id
  from public.profiles p
  where lower(btrim(p.name)) = lower(btrim(coalesce(new.assigned_to, '')))
  limit 1;

  update public.crm_appointments
  set assigned_profile_id = owner_profile_id
  where lead_id = new.id
    and assigned_profile_id is distinct from owner_profile_id;
  return new;
end;
$$;
revoke all on function crm_private.sync_appointment_owner_from_lead() from public, anon, authenticated;
drop trigger if exists crm_sync_appointment_owner_from_lead on public.leads;
create trigger crm_sync_appointment_owner_from_lead
after update of assigned_to on public.leads
for each row
when (new.assigned_to is distinct from old.assigned_to)
execute function crm_private.sync_appointment_owner_from_lead();

drop policy if exists crm_appointment_read on public.crm_appointments;
create policy crm_appointment_read on public.crm_appointments
for select to authenticated
using (
  (select public.current_user_role())::text in ('admin', 'manager')
  or (
    (select public.current_user_role())::text = 'employee'
    and assigned_profile_id = (select auth.uid())
  )
);

drop policy if exists crm_appointment_update on public.crm_appointments;
create policy crm_appointment_update on public.crm_appointments
for update to authenticated
using (
  (select public.current_user_role())::text in ('admin', 'manager')
  or (
    (select public.current_user_role())::text = 'employee'
    and assigned_profile_id = (select auth.uid())
  )
)
with check (
  (select public.current_user_role())::text in ('admin', 'manager')
  or (
    (select public.current_user_role())::text = 'employee'
    and assigned_profile_id = (select auth.uid())
  )
);

drop policy if exists crm_appointment_event_read on public.crm_appointment_events;
create policy crm_appointment_event_read on public.crm_appointment_events
for select to authenticated
using (
  exists (
    select 1
    from public.crm_appointments a
    where a.id = appointment_id
  )
);
