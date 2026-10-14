-- Keep trigger/event-trigger helpers out of the PostgREST RPC surface.
-- Trigger execution does not require callers to have EXECUTE on the trigger
-- function, so profile creation and automatic RLS setup continue to work.
revoke execute on function public.handle_new_user()
  from public, anon, authenticated;
revoke execute on function public.rls_auto_enable()
  from public, anon, authenticated;

-- Pin the SECURITY DEFINER trigger to a minimal path. Its table reference is
-- already schema-qualified in the function body.
alter function public.handle_new_user() set search_path = '';

-- A Meta delivery may be retried after a timeout. Store the upstream lead ID
-- so retries remain idempotent even when phone data is absent or older than
-- the existing short-window duplicate check.
alter table public.leads
  add column if not exists meta_leadgen_id text;

create unique index if not exists leads_meta_leadgen_id_uidx
  on public.leads (meta_leadgen_id)
  where meta_leadgen_id is not null;
