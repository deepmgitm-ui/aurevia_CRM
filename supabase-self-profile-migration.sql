-- Allow staff to maintain their own non-privileged profile fields.
-- Run supabase-hr-migration.sql first. HR values are stored in
-- employee_private_profiles; dynamic legacy writes keep older app releases
-- compatible until the privacy finalize migration removes the old columns.

create or replace function public.update_my_employee_profile(
  p_name text,
  p_phone text,
  p_email text,
  p_gender text,
  p_blood_group text,
  p_emergency_contact text,
  p_photo_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in before updating your profile.';
  end if;

  if length(trim(coalesce(p_name, ''))) = 0 or length(trim(p_name)) > 100 then
    raise exception 'Full name is required and must be 100 characters or fewer.';
  end if;

  if p_phone is not null and length(p_phone) > 40 then
    raise exception 'Contact number must be 40 characters or fewer.';
  end if;
  if p_email is not null and length(p_email) > 254 then
    raise exception 'Email address must be 254 characters or fewer.';
  end if;
  if p_gender is not null and length(p_gender) > 40 then
    raise exception 'Gender must be 40 characters or fewer.';
  end if;
  if p_blood_group is not null and length(p_blood_group) > 10 then
    raise exception 'Blood group must be 10 characters or fewer.';
  end if;
  if p_emergency_contact is not null and length(p_emergency_contact) > 40 then
    raise exception 'Emergency contact must be 40 characters or fewer.';
  end if;
  if p_photo_url is not null and (
    length(p_photo_url) > 2048 or p_photo_url !~ '^https://'
  ) then
    raise exception 'Profile photo URL must be HTTPS and 2,048 characters or fewer.';
  end if;

  update public.profiles set name = trim(p_name) where id = auth.uid();

  if not found then
    raise exception 'Your profile could not be found.';
  end if;

  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'phone') then
    execute 'update public.profiles set phone=$1,email=$2,gender=$3,blood_group=$4,emergency_contact=$5,photo_url=$6 where id=$7'
      using nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_email, '')), ''),
        nullif(trim(coalesce(p_gender, '')), ''), nullif(trim(coalesce(p_blood_group, '')), ''),
        nullif(trim(coalesce(p_emergency_contact, '')), ''), nullif(trim(coalesce(p_photo_url, '')), ''), auth.uid();
  end if;

  insert into public.employee_private_profiles (id, phone, email, gender, blood_group, emergency_contact, photo_url)
  values (
    auth.uid(), nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_email, '')), ''),
    nullif(trim(coalesce(p_gender, '')), ''), nullif(trim(coalesce(p_blood_group, '')), ''),
    nullif(trim(coalesce(p_emergency_contact, '')), ''), nullif(trim(coalesce(p_photo_url, '')), '')
  ) on conflict (id) do update set
    phone=excluded.phone, email=excluded.email, gender=excluded.gender,
    blood_group=excluded.blood_group, emergency_contact=excluded.emergency_contact,
    photo_url=excluded.photo_url;
end;
$$;

revoke all on function public.update_my_employee_profile(text, text, text, text, text, text, text)
  from public, anon;
grant execute on function public.update_my_employee_profile(text, text, text, text, text, text, text)
  to authenticated;

-- Admins and managers can maintain any staff member's HR/profile fields without
-- changing their access role or other authorization-related columns.
create or replace function public.admin_update_employee_profile(
  p_profile_id uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_gender text,
  p_blood_group text,
  p_emergency_contact text,
  p_manager_name text,
  p_photo_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.current_user_role() not in ('admin', 'manager') then
    raise exception 'Admin or manager access is required to update another profile.';
  end if;

  if p_profile_id is null then
    raise exception 'Choose an employee profile to update.';
  end if;
  if length(trim(coalesce(p_name, ''))) = 0 or length(trim(p_name)) > 100 then
    raise exception 'Full name is required and must be 100 characters or fewer.';
  end if;
  if p_phone is not null and length(p_phone) > 40 then
    raise exception 'Contact number must be 40 characters or fewer.';
  end if;
  if p_email is not null and length(p_email) > 254 then
    raise exception 'Email address must be 254 characters or fewer.';
  end if;
  if p_gender is not null and length(p_gender) > 40 then
    raise exception 'Gender must be 40 characters or fewer.';
  end if;
  if p_blood_group is not null and length(p_blood_group) > 10 then
    raise exception 'Blood group must be 10 characters or fewer.';
  end if;
  if p_emergency_contact is not null and length(p_emergency_contact) > 40 then
    raise exception 'Emergency contact must be 40 characters or fewer.';
  end if;
  if p_manager_name is not null and length(p_manager_name) > 100 then
    raise exception 'Assigned manager must be 100 characters or fewer.';
  end if;
  if p_photo_url is not null and (
    length(p_photo_url) > 2048 or p_photo_url !~ '^https://'
  ) then
    raise exception 'Profile photo URL must be HTTPS and 2,048 characters or fewer.';
  end if;

  update public.profiles set name = trim(p_name) where id = p_profile_id;

  if not found then
    raise exception 'The selected employee profile could not be found.';
  end if;

  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'phone') then
    execute 'update public.profiles set phone=$1,email=$2,gender=$3,blood_group=$4,emergency_contact=$5,manager_name=$6,photo_url=$7 where id=$8'
      using nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_email, '')), ''),
        nullif(trim(coalesce(p_gender, '')), ''), nullif(trim(coalesce(p_blood_group, '')), ''),
        nullif(trim(coalesce(p_emergency_contact, '')), ''), nullif(trim(coalesce(p_manager_name, '')), ''),
        nullif(trim(coalesce(p_photo_url, '')), ''), p_profile_id;
  end if;

  insert into public.employee_private_profiles (id, phone, email, gender, blood_group, emergency_contact, manager_name, photo_url)
  values (
    p_profile_id, nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_email, '')), ''),
    nullif(trim(coalesce(p_gender, '')), ''), nullif(trim(coalesce(p_blood_group, '')), ''),
    nullif(trim(coalesce(p_emergency_contact, '')), ''), nullif(trim(coalesce(p_manager_name, '')), ''),
    nullif(trim(coalesce(p_photo_url, '')), '')
  ) on conflict (id) do update set
    phone=excluded.phone, email=excluded.email, gender=excluded.gender,
    blood_group=excluded.blood_group, emergency_contact=excluded.emergency_contact,
    manager_name=excluded.manager_name, photo_url=excluded.photo_url;
end;
$$;

revoke all on function public.admin_update_employee_profile(uuid, text, text, text, text, text, text, text, text)
  from public, anon;
grant execute on function public.admin_update_employee_profile(uuid, text, text, text, text, text, text, text, text)
  to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'employee-avatars',
  'employee-avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists employee_avatars_public_read on storage.objects;
create policy employee_avatars_public_read
on storage.objects for select
to public
using (bucket_id = 'employee-avatars');

drop policy if exists employee_avatars_owner_insert on storage.objects;
create policy employee_avatars_owner_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'employee-avatars'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.current_user_role() in ('admin', 'manager')
  )
);

drop policy if exists employee_avatars_owner_update on storage.objects;
create policy employee_avatars_owner_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'employee-avatars'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.current_user_role() in ('admin', 'manager')
  )
)
with check (
  bucket_id = 'employee-avatars'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.current_user_role() in ('admin', 'manager')
  )
);

drop policy if exists employee_avatars_owner_delete on storage.objects;
create policy employee_avatars_owner_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'employee-avatars'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.current_user_role() in ('admin', 'manager')
  )
);
