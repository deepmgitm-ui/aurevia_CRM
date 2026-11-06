-- Save the disposition and its audit entry together. A failed timeline insert
-- must not leave a status change that the caller was told had failed.
create or replace function public.crm_change_lead_status(
  p_lead uuid,
  p_status text,
  p_expected_status text
)
returns public.leads
language plpgsql
security invoker
set search_path = ''
as $$
declare
  lead_row public.leads;
  previous_status text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if p_lead is null then raise exception 'Lead ID is required'; end if;
  if p_status is null or p_status not in (
    'New', 'Follow-Up', 'DNP', 'DNP2', 'DNP3', 'RNR',
    'Not Interested', 'Didn’t Enquired', 'Budget Issue', 'Location Issue',
    'Language Issue', 'Non Surgical', 'OPD Booked', 'OPD Done',
    'IPD Done', 'IPD Booked', 'Dropped', 'Invalid Number', 'CallBack',
    'Wrong Number'
  ) then raise exception 'Choose one of the available lead statuses'; end if;

  select l.* into lead_row
  from public.leads as l
  where l.id = p_lead
  for update;
  if not found then raise exception 'Lead unavailable or access denied'; end if;
  if lead_row.status is distinct from p_expected_status then
    raise exception 'This lead status changed. Refresh and try again';
  end if;

  if lead_row.status is distinct from p_status then
    previous_status := coalesce(nullif(btrim(lead_row.status), ''), '—');
    update public.leads as l
    set status = p_status
    where l.id = p_lead
    returning l.* into lead_row;

    insert into public.lead_activities(lead_id, user_id, action_type, description)
    values (p_lead, auth.uid(), 'Status changed', previous_status || ' → ' || p_status);
  end if;

  return lead_row;
end;
$$;

revoke all on function public.crm_change_lead_status(uuid, text, text) from public, anon;
grant execute on function public.crm_change_lead_status(uuid, text, text) to authenticated;
