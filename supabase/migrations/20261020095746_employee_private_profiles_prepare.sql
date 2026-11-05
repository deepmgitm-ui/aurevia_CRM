-- Phase 1: copy private staff details into an RLS-protected table while
-- keeping the legacy columns available during the application rollout.
create table if not exists public.employee_private_profiles (
  id uuid primary key references public.profiles(id) on delete cascade,
  phone text,
  email text,
  gender text,
  blood_group text,
  emergency_contact text,
  manager_name text,
  photo_url text
);

insert into public.employee_private_profiles (
  id, phone, email, gender, blood_group, emergency_contact, manager_name, photo_url
)
select id, phone, email, gender, blood_group, emergency_contact, manager_name, photo_url
from public.profiles
on conflict (id) do update set
  phone = excluded.phone,
  email = excluded.email,
  gender = excluded.gender,
  blood_group = excluded.blood_group,
  emergency_contact = excluded.emergency_contact,
  manager_name = excluded.manager_name,
  photo_url = excluded.photo_url;

alter table public.employee_private_profiles enable row level security;
revoke all on public.employee_private_profiles from public, anon, authenticated;
grant select on public.employee_private_profiles to authenticated;

drop policy if exists employee_private_profiles_read on public.employee_private_profiles;
create policy employee_private_profiles_read
on public.employee_private_profiles for select
to authenticated
using (
  id = (select auth.uid())
  or (select public.current_user_role())::text in ('admin', 'manager')
);

-- These authenticated RPCs are intentional API entry points: each verifies
-- auth.uid() and the required caller role before writing private profile data.
create or replace function public.update_my_employee_profile(
  p_name text, p_phone text, p_email text, p_gender text, p_blood_group text,
  p_emergency_contact text, p_photo_url text
) returns void
language plpgsql security definer set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'Sign in before updating your profile.';
  end if;
  if length(trim(coalesce(p_name, ''))) = 0 or length(trim(p_name)) > 100 then
    raise exception 'Full name is required and must be 100 characters or fewer.';
  end if;
  if p_phone is not null and length(p_phone) > 40 then raise exception 'Contact number must be 40 characters or fewer.'; end if;
  if p_email is not null and length(p_email) > 254 then raise exception 'Email address must be 254 characters or fewer.'; end if;
  if p_gender is not null and length(p_gender) > 40 then raise exception 'Gender must be 40 characters or fewer.'; end if;
  if p_blood_group is not null and length(p_blood_group) > 10 then raise exception 'Blood group must be 10 characters or fewer.'; end if;
  if p_emergency_contact is not null and length(p_emergency_contact) > 40 then raise exception 'Emergency contact must be 40 characters or fewer.'; end if;
  if p_photo_url is not null and (length(p_photo_url) > 2048 or p_photo_url !~ '^https://') then
    raise exception 'Profile photo URL must be HTTPS and 2,048 characters or fewer.';
  end if;

  update public.profiles
  set name = trim(p_name),
      phone = nullif(trim(coalesce(p_phone, '')), ''),
      email = nullif(trim(coalesce(p_email, '')), ''),
      gender = nullif(trim(coalesce(p_gender, '')), ''),
      blood_group = nullif(trim(coalesce(p_blood_group, '')), ''),
      emergency_contact = nullif(trim(coalesce(p_emergency_contact, '')), ''),
      photo_url = nullif(trim(coalesce(p_photo_url, '')), '')
  where id = auth.uid();
  if not found then raise exception 'Your profile could not be found.'; end if;

  insert into public.employee_private_profiles (
    id, phone, email, gender, blood_group, emergency_contact, photo_url
  ) values (
    auth.uid(), nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_email, '')), ''),
    nullif(trim(coalesce(p_gender, '')), ''), nullif(trim(coalesce(p_blood_group, '')), ''),
    nullif(trim(coalesce(p_emergency_contact, '')), ''), nullif(trim(coalesce(p_photo_url, '')), '')
  ) on conflict (id) do update set
    phone = excluded.phone, email = excluded.email, gender = excluded.gender,
    blood_group = excluded.blood_group, emergency_contact = excluded.emergency_contact,
    photo_url = excluded.photo_url;
end;
$function$;

create or replace function public.admin_update_employee_profile(
  p_profile_id uuid, p_name text, p_phone text, p_email text, p_gender text,
  p_blood_group text, p_emergency_contact text, p_manager_name text, p_photo_url text
) returns void
language plpgsql security definer set search_path = ''
as $function$
begin
  if auth.uid() is null or public.current_user_role() not in ('admin', 'manager') then
    raise exception 'Admin or manager access is required to update another profile.';
  end if;
  if p_profile_id is null then raise exception 'Choose an employee profile to update.'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 or length(trim(p_name)) > 100 then
    raise exception 'Full name is required and must be 100 characters or fewer.';
  end if;
  if p_phone is not null and length(p_phone) > 40 then raise exception 'Contact number must be 40 characters or fewer.'; end if;
  if p_email is not null and length(p_email) > 254 then raise exception 'Email address must be 254 characters or fewer.'; end if;
  if p_gender is not null and length(p_gender) > 40 then raise exception 'Gender must be 40 characters or fewer.'; end if;
  if p_blood_group is not null and length(p_blood_group) > 10 then raise exception 'Blood group must be 10 characters or fewer.'; end if;
  if p_emergency_contact is not null and length(p_emergency_contact) > 40 then raise exception 'Emergency contact must be 40 characters or fewer.'; end if;
  if p_manager_name is not null and length(p_manager_name) > 100 then raise exception 'Assigned manager must be 100 characters or fewer.'; end if;
  if p_photo_url is not null and (length(p_photo_url) > 2048 or p_photo_url !~ '^https://') then
    raise exception 'Profile photo URL must be HTTPS and 2,048 characters or fewer.';
  end if;

  update public.profiles
  set name = trim(p_name),
      phone = nullif(trim(coalesce(p_phone, '')), ''),
      email = nullif(trim(coalesce(p_email, '')), ''),
      gender = nullif(trim(coalesce(p_gender, '')), ''),
      blood_group = nullif(trim(coalesce(p_blood_group, '')), ''),
      emergency_contact = nullif(trim(coalesce(p_emergency_contact, '')), ''),
      manager_name = nullif(trim(coalesce(p_manager_name, '')), ''),
      photo_url = nullif(trim(coalesce(p_photo_url, '')), '')
  where id = p_profile_id;
  if not found then raise exception 'The selected employee profile could not be found.'; end if;

  insert into public.employee_private_profiles (
    id, phone, email, gender, blood_group, emergency_contact, manager_name, photo_url
  ) values (
    p_profile_id, nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_email, '')), ''),
    nullif(trim(coalesce(p_gender, '')), ''), nullif(trim(coalesce(p_blood_group, '')), ''),
    nullif(trim(coalesce(p_emergency_contact, '')), ''), nullif(trim(coalesce(p_manager_name, '')), ''),
    nullif(trim(coalesce(p_photo_url, '')), '')
  ) on conflict (id) do update set
    phone = excluded.phone, email = excluded.email, gender = excluded.gender,
    blood_group = excluded.blood_group, emergency_contact = excluded.emergency_contact,
    manager_name = excluded.manager_name, photo_url = excluded.photo_url;
end;
$function$;

revoke all on function public.update_my_employee_profile(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.update_my_employee_profile(text, text, text, text, text, text, text) to authenticated;
revoke all on function public.admin_update_employee_profile(uuid, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.admin_update_employee_profile(uuid, text, text, text, text, text, text, text, text) to authenticated;
