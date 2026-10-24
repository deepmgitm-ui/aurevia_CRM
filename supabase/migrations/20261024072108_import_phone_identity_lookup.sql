-- Match import duplicates using the same normalized phone identity enforced by
-- crm_private.guard_phone, without scanning all lead phone numbers in the app.
create or replace function public.crm_existing_phone_identities(
  p_phone_identities text[]
)
returns table(phone_identity text)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'manager') then
    raise exception 'Admin or manager access required';
  end if;

  if coalesce(cardinality(p_phone_identities), 0) > 5000 then
    raise exception 'Too many phone identities to check';
  end if;

  return query
  select distinct right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 10)
  from public.leads as l
  where length(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g')) >= 10
    and right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 10)
      = any(coalesce(p_phone_identities, array[]::text[]));
end;
$$;

revoke all on function public.crm_existing_phone_identities(text[]) from public, anon;
grant execute on function public.crm_existing_phone_identities(text[]) to authenticated;
