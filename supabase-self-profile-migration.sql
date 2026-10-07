-- Allow staff to maintain their own non-privileged profile fields.
-- Run supabase-hr-migration.sql first.

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
set search_path = public, pg_temp
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

  update public.profiles
  set name = trim(p_name),
      phone = nullif(trim(coalesce(p_phone, '')), ''),
      email = nullif(trim(coalesce(p_email, '')), ''),
      gender = nullif(trim(coalesce(p_gender, '')), ''),
      blood_group = nullif(trim(coalesce(p_blood_group, '')), ''),
      emergency_contact = nullif(trim(coalesce(p_emergency_contact, '')), ''),
      photo_url = nullif(trim(coalesce(p_photo_url, '')), '')
  where id = auth.uid();

  if not found then
    raise exception 'Your profile could not be found.';
  end if;
end;
$$;

revoke all on function public.update_my_employee_profile(text, text, text, text, text, text, text)
  from public, anon;
grant execute on function public.update_my_employee_profile(text, text, text, text, text, text, text)
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
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists employee_avatars_owner_update on storage.objects;
create policy employee_avatars_owner_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'employee-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'employee-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists employee_avatars_owner_delete on storage.objects;
create policy employee_avatars_owner_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'employee-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);
