-- Historical assignment dates are unknown: deliberately leave them NULL.
-- Every future assignment is stamped, including imports and automation.
alter table public.leads add column if not exists assigned_at timestamptz;

create or replace function public.stamp_lead_assignment()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  owner_name text := lower(btrim(coalesce(new.assigned_to, '')));
begin
  if tg_op = 'INSERT' then
    new.assigned_at := case when owner_name in ('', '-', 'unassigned') then null else now() end;
  elsif owner_name is distinct from lower(btrim(coalesce(old.assigned_to, ''))) then
    new.assigned_at := case when owner_name in ('', '-', 'unassigned') then null else now() end;
  else
    -- Editing status/remarks or submitting a forged timestamp cannot reset it.
    new.assigned_at := old.assigned_at;
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_lead_assignment() from public, anon, authenticated;
drop trigger if exists leads_stamp_assignment on public.leads;
create trigger leads_stamp_assignment before insert or update on public.leads
for each row execute function public.stamp_lead_assignment();

create index if not exists leads_agent_assigned_at_idx
on public.leads (assigned_to, assigned_at desc) where assigned_at is not null;
comment on column public.leads.assigned_at is
'Time this lead was most recently assigned to its current agent. NULL for unassigned leads or unknown historical assignments.';
