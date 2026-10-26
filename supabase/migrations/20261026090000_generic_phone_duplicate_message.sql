-- Keep the shared database phone guard in force for every insert path and
-- role, but return a neutral message that does not direct users to an admin.
create or replace function crm_private.guard_phone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ph text;
begin
  ph := right(regexp_replace(coalesce(new.phone, ''), '\\D', '', 'g'), 10);
  if length(ph) = 10 and (
    tg_op = 'INSERT'
    or ph is distinct from right(regexp_replace(coalesce(old.phone, ''), '\\D', '', 'g'), 10)
  ) then
    perform pg_advisory_xact_lock(hashtextextended(ph, 0));
    if exists (
      select 1
      from public.leads as lead
      where right(regexp_replace(coalesce(lead.phone, ''), '\\D', '', 'g'), 10) = ph
        and lead.id <> new.id
    ) then
      raise exception using errcode = '23505', message = 'Phone already exists.';
    end if;
  end if;
  return new;
end;
$$;
