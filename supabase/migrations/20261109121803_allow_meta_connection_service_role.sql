drop policy if exists crm_meta_connections_service_role on public.crm_meta_connections;
create policy crm_meta_connections_service_role
  on public.crm_meta_connections for all to service_role
  using (true)
  with check (true);
