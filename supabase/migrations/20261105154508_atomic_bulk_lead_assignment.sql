-- Assign a whole selected set and write its batch record in one transaction.
create or replace function public.crm_assign_leads_bulk(
  p_assignments jsonb,
  p_batch_label text default null,
  p_as_fresh boolean default false,
  p_only_unassigned boolean default false,
  p_exclude_batch_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  actor_id uuid := (select auth.uid());
  actor_name text;
  actor_role text;
  assignment_at timestamptz := now();
  batch_id uuid;
  requested integer;
  distinct_leads integer;
  target_names text[];
  target record;
  lead_ids uuid[];
  changed integer;
  assigned integer := 0;
  per_employee jsonb := '[]'::jsonb;
  batch_label text;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Sign in before assigning leads.';
  end if;
  select p.role::text, p.name into actor_role, actor_name
  from public.profiles p
  where p.id = actor_id;
  if actor_role is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Only admins can assign leads.';
  end if;
  if jsonb_typeof(p_assignments) is distinct from 'array'
     or jsonb_array_length(p_assignments) < 1
     or jsonb_array_length(p_assignments) > 10000 then
    raise exception using errcode = '22023', message = 'Select between 1 and 10,000 leads.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_assignments) item(value)
    where jsonb_typeof(item.value) is distinct from 'object'
       or nullif(btrim(item.value->>'id'), '') is null
       or nullif(btrim(item.value->>'name'), '') is null
       or lower(btrim(coalesce(item.value->>'name', ''))) in ('-', 'unassigned')
  ) then
    raise exception using errcode = '22023', message = 'Each lead needs a valid ID and team member.';
  end if;

  select count(*)::integer, count(distinct item.value->>'id')::integer
  into requested, distinct_leads
  from jsonb_array_elements(p_assignments) item(value);
  if requested <> distinct_leads then
    raise exception using errcode = '22023', message = 'A lead can only appear once in an assignment.';
  end if;

  select array_agg(names.name order by names.name)
  into target_names
  from (
    select distinct btrim(item.value->>'name') as name
    from jsonb_array_elements(p_assignments) item(value)
  ) names;
  if exists (
    select 1 from unnest(target_names) as selected_target(name)
    where not exists (select 1 from public.profiles p where p.name = selected_target.name)
  ) then
    raise exception using errcode = '22023', message = 'One or more selected team members are no longer available.';
  end if;

  batch_label := left(
    coalesce(nullif(btrim(p_batch_label), ''),
      'Assignment - ' || to_char(assignment_at at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM') || ' - ' || array_to_string(target_names, ', ')),
    120
  );
  insert into public.crm_assignment_batches(label, created_by, created_by_name, target_names, lead_count)
  values (batch_label, actor_id, coalesce(nullif(btrim(actor_name), ''), 'Team member'), target_names, requested)
  returning id into batch_id;

  for target in
    select btrim(item.value->>'name') as name,
           array_agg((item.value->>'id')::uuid order by item.ordinality) as ids
    from jsonb_array_elements(p_assignments) with ordinality item(value, ordinality)
    group by btrim(item.value->>'name')
    order by btrim(item.value->>'name')
  loop
    if p_as_fresh is true then
      update public.leads l
      set assigned_to = target.name,
          assignment_batch_id = batch_id,
          assigned_at = assignment_at,
          status = 'New',
          follow_up_date = '-',
          assigned_fresh_since = assignment_at,
          first_agent_touch_at = null
      where l.id = any(target.ids)
        and (not coalesce(p_only_unassigned, false) or lower(btrim(coalesce(l.assigned_to, ''))) in ('', '-', 'unassigned'))
        and (p_exclude_batch_id is null or l.assignment_batch_id is distinct from p_exclude_batch_id);
    else
      update public.leads l
      set assigned_to = target.name,
          assignment_batch_id = batch_id,
          assigned_at = assignment_at
      where l.id = any(target.ids)
        and (not coalesce(p_only_unassigned, false) or lower(btrim(coalesce(l.assigned_to, ''))) in ('', '-', 'unassigned'))
        and (p_exclude_batch_id is null or l.assignment_batch_id is distinct from p_exclude_batch_id);
    end if;
    get diagnostics changed = row_count;
    if changed <> cardinality(target.ids) then
      raise exception using errcode = '40001', message = 'Some selected leads changed or no longer match the assignment filters. No leads were assigned; refresh and retry.';
    end if;
    assigned := assigned + changed;
    per_employee := per_employee || jsonb_build_array(jsonb_build_object('name', target.name, 'count', changed));
  end loop;

  return jsonb_build_object('batchId', batch_id, 'assigned', assigned, 'perEmployee', per_employee);
end;
$function$;

revoke all on function public.crm_assign_leads_bulk(jsonb, text, boolean, boolean, uuid) from public, anon;
grant execute on function public.crm_assign_leads_bulk(jsonb, text, boolean, boolean, uuid) to authenticated;
