-- Keep the retention activation timestamp private to database-owned functions.
alter table public.crm_lead_retention_config enable row level security;
drop policy if exists crm_lead_retention_config_deny_api on public.crm_lead_retention_config;
create policy crm_lead_retention_config_deny_api
  on public.crm_lead_retention_config for all to anon, authenticated
  using (false)
  with check (false);
