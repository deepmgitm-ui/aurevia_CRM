-- MANUAL: review, then run this entire file in your project's Supabase SQL Editor.
-- No patient records are deleted or reassigned. Everything commits together.
-- Admins/managers retain access; employees see and update only their own leads.
begin;

-- Assignment currently uses profile names, so duplicates are unsafe identities.
do $$
begin
  if exists (
    select 1 from public.profiles where btrim(coalesce(name, '')) <> ''
    group by lower(btrim(name)) having count(*) > 1
  ) then
    raise exception 'Duplicate staff names found. Resolve these before enabling agent access.';
  end if;
end;
$$;

create unique index if not exists profiles_unique_assignment_name_idx
on public.profiles (lower(btrim(name))) where btrim(coalesce(name, '')) <> '';

alter table public.leads enable row level security;
alter table public.lead_activities enable row level security;
revoke all on public.leads, public.lead_activities from anon;
grant select, insert, update, delete on public.leads, public.lead_activities to authenticated;

drop policy if exists leads_employee_select on public.leads;
create policy leads_employee_select on public.leads for select to authenticated
using (
  public.current_user_role() = 'employee'
  and exists (select 1 from public.profiles p where p.id = (select auth.uid())
    and lower(btrim(p.name)) not in ('', '-', 'unassigned')
    and lower(btrim(p.name)) = lower(btrim(leads.assigned_to)))
);

drop policy if exists leads_employee_insert on public.leads;
create policy leads_employee_insert on public.leads for insert to authenticated
with check (
  public.current_user_role() = 'employee'
  and exists (select 1 from public.profiles p where p.id = (select auth.uid())
    and lower(btrim(p.name)) not in ('', '-', 'unassigned')
    and lower(btrim(p.name)) = lower(btrim(leads.assigned_to)))
);

drop policy if exists leads_employee_update on public.leads;
create policy leads_employee_update on public.leads for update to authenticated
using (
  public.current_user_role() = 'employee'
  and exists (select 1 from public.profiles p where p.id = (select auth.uid())
    and lower(btrim(p.name)) not in ('', '-', 'unassigned')
    and lower(btrim(p.name)) = lower(btrim(leads.assigned_to)))
)
with check (
  public.current_user_role() = 'employee'
  and exists (select 1 from public.profiles p where p.id = (select auth.uid())
    and lower(btrim(p.name)) not in ('', '-', 'unassigned')
    and lower(btrim(p.name)) = lower(btrim(leads.assigned_to)))
);

-- Employees can change status, notes, follow-up and appointment dates.
-- Patient identity, assignment and source remain controlled by management.
create or replace function public.block_employee_core_lead_update()
returns trigger language plpgsql security invoker set search_path = public, pg_temp
as $$
begin
  if public.current_user_role() = 'employee' and (
    (to_jsonb(new) - array['status','remarks','follow_up_date',
      'opd_booked_date','opd_done_date','ipd_done_date','updated_at'])
    is distinct from
    (to_jsonb(old) - array['status','remarks','follow_up_date',
      'opd_booked_date','opd_done_date','ipd_done_date','updated_at'])
  ) then
    raise exception 'Employees cannot change patient identity, lead assignment or source.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists block_employee_core_lead_update on public.leads;
create trigger block_employee_core_lead_update before update on public.leads
for each row execute function public.block_employee_core_lead_update();

drop policy if exists lead_activities_employee_select_own on public.lead_activities;
create policy lead_activities_employee_select_own on public.lead_activities for select to authenticated
using (public.current_user_role() = 'employee' and exists (
  select 1 from public.leads l where l.id = lead_activities.lead_id
));
drop policy if exists lead_activities_employee_insert on public.lead_activities;
create policy lead_activities_employee_insert on public.lead_activities for insert to authenticated
with check (public.current_user_role() = 'employee' and user_id = (select auth.uid())
  and exists (select 1 from public.leads l where l.id = lead_activities.lead_id));

-- The aggregate view must also obey the caller's lead policies (Postgres 15+).
alter view public.lead_rollup set (security_invoker = true);
revoke all on public.lead_rollup from anon;
grant select on public.lead_rollup to authenticated;

-- Close unrestricted self-profile UPDATE. Existing profile-edit RPC remains.
drop policy if exists "Allow users to update their own profile" on public.profiles;
create or replace function public.guard_staff_identity()
returns trigger language plpgsql security invoker set search_path = public, pg_temp
as $$
declare viewer_role text := public.current_user_role()::text;
begin
  -- Trusted backend/SQL maintenance is not a user self-service request.
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.role::text <> 'employee' and viewer_role is distinct from 'admin' then
      raise exception 'Only admins can create privileged staff accounts.' using errcode = '42501';
    end if;
  else
    if new.id is distinct from old.id then
      raise exception 'Staff account identity cannot be changed.' using errcode = '42501';
    end if;
    if new.role is distinct from old.role and viewer_role is distinct from 'admin' then
      raise exception 'Only admins can change staff roles.' using errcode = '42501';
    end if;
    if viewer_role = 'employee' and new.name is distinct from old.name then
      raise exception 'Ask an administrator to change your assignment name.' using errcode = '42501';
    end if;
  end if;
  if btrim(coalesce(new.name, '')) <> '' and exists (
    select 1 from public.profiles p where p.id <> new.id
      and lower(btrim(p.name)) = lower(btrim(new.name))
  ) then
    raise exception 'Staff names used for assignment must be unique.' using errcode = '23505';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_guard_identity on public.profiles;
create trigger profiles_guard_identity before insert or update on public.profiles
for each row execute function public.guard_staff_identity();

revoke all on function public.block_employee_core_lead_update() from public, anon, authenticated;
revoke all on function public.guard_staff_identity() from public, anon, authenticated;
revoke all on function public.current_user_role() from public, anon;
grant execute on function public.current_user_role() to authenticated;

commit;

-- Both rows must say true after running; SQL Editor counts bypass RLS.
select relname as table_name, relrowsecurity as rls_enabled from pg_class
where oid in ('public.leads'::regclass, 'public.lead_activities'::regclass);
