-- The config table intentionally denies direct API access. This admin-only
-- reminder function must read it with its owner's privileges instead.
create or replace function public.crm_admin_lead_retention_reminders(p_limit integer default 10)
returns table (
  lead_id uuid,
  lead_name text,
  lead_phone text,
  lead_status text,
  assigned_to text,
  created_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or (select public.current_user_role())::text <> 'admin' then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 20 then
    raise exception using errcode = '22023', message = 'Reminder page size is out of range';
  end if;

  return query
  select l.id, coalesce(nullif(btrim(l.name), ''), 'Unnamed lead'),
    coalesce(l.phone, ''), coalesce(l.status, 'New'), coalesce(l.assigned_to, ''),
    l.created_at, greatest(l.created_at, c.enabled_at) + interval '2 months'
  from public.leads l
  cross join public.crm_lead_retention_config c
  where c.singleton
    and greatest(l.created_at, c.enabled_at) + interval '2 months' <= now() + interval '7 days'
  order by greatest(l.created_at, c.enabled_at) + interval '2 months', l.id
  limit p_limit;
end;
$function$;
revoke all on function public.crm_admin_lead_retention_reminders(integer) from public, anon;
grant execute on function public.crm_admin_lead_retention_reminders(integer) to authenticated;

