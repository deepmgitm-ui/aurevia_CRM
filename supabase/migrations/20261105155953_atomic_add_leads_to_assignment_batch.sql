-- Appending leads to an existing assignment batch must update lead ownership
-- and the batch count together, even when one target group fails.
create or replace function public.crm_add_leads_to_assignment_batch(
  p_batch_id uuid,
  p_assignments jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  actor_id uuid := (select auth.uid());
  actor_role text;
  batch_target_names text[];
  assignment_count integer;
  unique_count integer;
  target record;
  changed integer;
  added integer := 0;
  per_employee jsonb := '[]'::jsonb;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Sign in before adding leads to a batch.';
  end if;
  select p.role::text into actor_role
  from public.profiles p
  where p.id = actor_id;
  if actor_role is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Only admins can add leads to assignment batches.';
  end if;
  if p_batch_id is null then
    raise exception using errcode = '22023', message = 'Select a valid assignment batch.';
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
    raise exception using errcode = '22023', message = 'Each lead needs a valid ID and batch team member.';
  end if;
  select count(*)::integer, count(distinct item.value->>'id')::integer
  into assignment_count, unique_count
  from jsonb_array_elements(p_assignments) item(value);
  if assignment_count <> unique_count then
    raise exception using errcode = '22023', message = 'A lead can only appear once in a batch addition.';
  end if;

  select b.target_names into batch_target_names
  from public.crm_assignment_batches b
  where b.id = p_batch_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Assignment batch not found.';
  end if;
  if coalesce(cardinality(batch_target_names), 0) = 0 then
    raise exception using errcode = '22023', message = 'This batch has no active team members. Transfer the batch first.';
  end if;
  if exists (
    select 1
    from (
      select distinct btrim(item.value->>'name') as name
      from jsonb_array_elements(p_assignments) item(value)
    ) selected
    where not coalesce(selected.name = any(batch_target_names), false)
       or not exists (select 1 from public.profiles p where p.name = selected.name)
  ) then
    raise exception using errcode = '40001', message = 'The batch team changed. Refresh and retry.';
  end if;

  for target in
    select btrim(item.value->>'name') as name,
           array_agg((item.value->>'id')::uuid order by item.ordinality) as ids
    from jsonb_array_elements(p_assignments) with ordinality item(value, ordinality)
    group by btrim(item.value->>'name')
    order by btrim(item.value->>'name')
  loop
    update public.leads l
    set assigned_to = target.name,
        assignment_batch_id = p_batch_id,
        assigned_at = now()
    where l.id = any(target.ids)
      and l.assignment_batch_id is distinct from p_batch_id;
    get diagnostics changed = row_count;
    if changed <> cardinality(target.ids) then
      raise exception using errcode = '40001', message = 'Some selected leads already belong to this batch or changed. No leads were added; refresh and retry.';
    end if;
    added := added + changed;
    per_employee := per_employee || jsonb_build_array(jsonb_build_object('name', target.name, 'count', changed));
  end loop;

  update public.crm_assignment_batches b
  set lead_count = b.lead_count + added
  where b.id = p_batch_id;

  return jsonb_build_object('added', added, 'perEmployee', per_employee);
end;
$function$;

revoke all on function public.crm_add_leads_to_assignment_batch(uuid, jsonb) from public, anon;
grant execute on function public.crm_add_leads_to_assignment_batch(uuid, jsonb) to authenticated;
