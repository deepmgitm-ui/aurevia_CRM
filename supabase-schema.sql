-- Aurevia CRM schema for Supabase

create extension if not exists "pgcrypto";

-- Enum types are created conditionally so this script can be re-run safely.
do $$
begin
  create type public.user_role as enum ('admin', 'manager', 'employee');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.lead_status as enum ('New', 'Contacted', 'Proposal', 'Negotiation', 'Won', 'Lost');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.lead_temp as enum ('Hot', 'Warm', 'Cold');
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  role public.user_role not null default 'employee',
  created_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  gender text not null default '-',
  city text not null default '-',
  disease text not null default '-',
  insurance_status text not null default '-',
  remarks text not null default '-',
  lead_date text not null default '-',
  follow_up_date text not null default '-',
  source text not null default 'Meta Ads',
  status text not null default 'New',
  temperature text not null default 'Warm',
  assigned_to text not null default '-',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Existing databases can run this migration to support client-defined statuses
-- and the additional Excel fields.
alter table public.leads
  add column if not exists gender text not null default '-',
  add column if not exists city text not null default '-',
  add column if not exists disease text not null default '-',
  add column if not exists insurance_status text not null default '-',
  add column if not exists remarks text not null default '-',
  add column if not exists lead_date text not null default '-',
  add column if not exists follow_up_date text not null default '-';

alter table public.leads
  alter column temperature drop default,
  alter column temperature type text using temperature::text,
  alter column temperature set default 'Warm';

alter table public.leads
  drop constraint if exists leads_assigned_to_fkey;

alter table public.leads
  alter column assigned_to drop default,
  alter column assigned_to type text using assigned_to::text,
  alter column assigned_to set default '-';

update public.leads
set assigned_to = profiles.name
from public.profiles
where public.leads.assigned_to = profiles.id::text;

alter table public.leads
  alter column status drop default;

alter table public.leads
  alter column status type text using status::text;

alter table public.leads
  alter column status set default 'New';

create table if not exists public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  action_type varchar(100) not null,
  description text,
  created_at timestamptz not null default now()
);

-- This helper avoids recursive RLS checks when policies inspect a user's role.
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

revoke all on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
before update on public.leads
for each row
execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      split_part(coalesce(new.email, ''), '@', 1),
      ''
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.leads enable row level security;
alter table public.lead_activities enable row level security;

-- Profiles are readable by authenticated users; only admins/managers can mutate them.
drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated
on public.profiles for select
to authenticated
using (auth.uid() is not null);

drop policy if exists profiles_admin_manager_all on public.profiles;
create policy profiles_admin_manager_all
on public.profiles for all
to authenticated
using (public.current_user_role() in ('admin', 'manager'))
with check (public.current_user_role() in ('admin', 'manager'));

-- Admins/managers have unrestricted lead access.
drop policy if exists leads_admin_manager_all on public.leads;
create policy leads_admin_manager_all
on public.leads for all
to authenticated
using (public.current_user_role() in ('admin', 'manager'))
with check (public.current_user_role() in ('admin', 'manager'));

-- Employees can work only on leads assigned to their own profile.
drop policy if exists leads_employee_select on public.leads;
create policy leads_employee_select
on public.leads for select
to authenticated
using (
  public.current_user_role() = 'employee'
  and assigned_to = (select name from public.profiles where id = auth.uid())
);

drop policy if exists leads_employee_update on public.leads;
create policy leads_employee_update
on public.leads for update
to authenticated
using (
  public.current_user_role() = 'employee'
  and assigned_to = (select name from public.profiles where id = auth.uid())
-- Realtime: stream INSERT/UPDATE events on the leads table to dashboards
-- via Supabase Realtime. Supabase projects ship with an empty
-- `supabase_realtime` publication; this adds leads to it (no-op if already
-- added, or if the publication does not exist yet).
do $$
begin
  alter publication supabase_realtime add table public.leads;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- Realtime UPDATE payloads only include the full OLD row (needed to compare
-- assigned_to before/after and detect assignment changes) when the table uses
-- REPLICA IDENTITY FULL. Safe to run repeatedly.
alter table public.leads replica identity full;

-- Backend security (defense in depth): employees may only change Status,
-- Temperature and Remarks on their own leads. Core fields (patient name,
-- contact, email, city, treatment, insurance, source, lead date, assignment)
-- are rejected at the DATABASE level even if an API request is tampered with.
-- errcode 42501 (insufficient_privilege) makes PostgREST return HTTP 403.
create or replace function public.block_employee_core_lead_update()
returns trigger
language plpgsql
as $$
begin
  if public.current_user_role() = 'employee' then
    if new.name is distinct from old.name
      or new.phone is distinct from old.phone
      or new.email is distinct from old.email
      or new.gender is distinct from old.gender
      or new.city is distinct from old.city
      or new.disease is distinct from old.disease
      or new.insurance_status is distinct from old.insurance_status
      or new.source is distinct from old.source
      or new.lead_date is distinct from old.lead_date
      or new.assigned_to is distinct from old.assigned_to then
      raise exception 'Employees can only update status, temperature and remarks.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists block_employee_core_lead_update on public.leads;
create trigger block_employee_core_lead_update
  before update on public.leads
  for each row
  execute function public.block_employee_core_lead_update();

)
with check (
  public.current_user_role() = 'employee'
  and assigned_to = (select name from public.profiles where id = auth.uid())
);

-- Admins/managers can fully manage activity history. Employees can add activity
-- only to leads assigned to them and only as themselves.
drop policy if exists lead_activities_admin_manager_all on public.lead_activities;
create policy lead_activities_admin_manager_all
on public.lead_activities for all
to authenticated
using (public.current_user_role() in ('admin', 'manager'))
with check (public.current_user_role() in ('admin', 'manager'));

drop policy if exists lead_activities_employee_insert on public.lead_activities;
create policy lead_activities_employee_insert
on public.lead_activities for insert
to authenticated
with check (
  public.current_user_role() = 'employee'
  and user_id = auth.uid()
  and exists (
    select 1
    from public.leads
    where public.leads.id = lead_activities.lead_id
      and public.leads.assigned_to = (select name from public.profiles where id = auth.uid())
  )
);
