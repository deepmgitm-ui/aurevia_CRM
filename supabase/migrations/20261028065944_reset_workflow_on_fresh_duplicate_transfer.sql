create or replace function public.crm_resolve_duplicate_review_items(
  p_review_ids uuid[], p_action text, p_target_name text, p_as_fresh boolean default false
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  actor_id uuid := auth.uid();
  actor_role text := coalesce((select public.current_user_role())::text, '');
  actor_name text;
  target_name text;
  target_role text;
  target_names text[];
  lead_ids uuid[];
  batch_id uuid;
  backup_id uuid;
  affected integer := 0;
begin
  if actor_id is null or actor_role not in ('admin', 'manager') then raise exception 'Admin or manager access required'; end if;
  if coalesce(cardinality(p_review_ids), 0) = 0 or cardinality(p_review_ids) > 500 then raise exception 'Select between 1 and 500 duplicate leads'; end if;
  if p_action not in ('assign', 'keep', 'delete') then raise exception 'Choose Assign, Keep, or Delete'; end if;
  select p.name into actor_name from public.profiles p where p.id = actor_id;
  select coalesce(array_agg(selected.lead_id), '{}'::uuid[]) into lead_ids
  from (
    select q.lead_id from public.crm_duplicate_review_queue q
    where q.id = any(p_review_ids) and q.resolved_at is null for update
  ) selected;
  if coalesce(cardinality(lead_ids), 0) = 0 then raise exception 'These duplicate reviews are no longer pending'; end if;
  if p_action = 'assign' then
    select p.name, p.role::text into target_name, target_role
    from public.profiles p
    where lower(btrim(p.name)) = lower(btrim(coalesce(p_target_name, '')))
      and (actor_role = 'admin' or p.role::text = 'employee')
    order by case when p.role::text = 'employee' then 0 else 1 end, p.name limit 1;
    if target_name is null or target_role not in ('employee', 'manager', 'admin') then raise exception 'Choose an active team member'; end if;
    target_names := array[target_name];
    insert into public.crm_assignment_batches(label, created_by, created_by_name, target_names, lead_count)
    values (left('Duplicate review transfer — ' || target_name, 240), actor_id, coalesce(nullif(btrim(actor_name), ''), '-'), target_names, cardinality(lead_ids))
    returning id into batch_id;
    update public.leads
    set assigned_to = target_name, assigned_at = now(), assignment_batch_id = batch_id,
        status = case when p_as_fresh then 'New' else status end,
        follow_up_date = case when p_as_fresh then '-' else follow_up_date end,
        assigned_fresh_since = case when p_as_fresh then now() else assigned_fresh_since end,
        first_agent_touch_at = case when p_as_fresh then null else first_agent_touch_at end
    where id = any(lead_ids);
    get diagnostics affected = row_count;
    update public.crm_duplicate_review_queue set resolved_at = now(), resolved_by = actor_id, resolution = 'assigned'
    where id = any(p_review_ids) and resolved_at is null;
  elsif p_action = 'keep' then
    if exists (select 1 from public.leads l where l.id = any(lead_ids) and lower(btrim(coalesce(l.assigned_to, ''))) in ('', '-', 'unassigned')) then
      raise exception 'Unassigned duplicate leads must be assigned or deleted';
    end if;
    update public.crm_duplicate_review_queue set resolved_at = now(), resolved_by = actor_id, resolution = 'kept'
    where id = any(p_review_ids) and resolved_at is null;
    get diagnostics affected = row_count;
  else
    backup_id := crm_private.snapshot_leads_for_permanent_delete(lead_ids, 'Duplicate review deletion', actor_id, coalesce(nullif(btrim(actor_name), ''), 'CRM admin'));
    if backup_id is null then raise exception 'Recovery backup could not be created; nothing was deleted'; end if;
    delete from public.leads where id = any(lead_ids);
    get diagnostics affected = row_count;
  end if;
  return jsonb_build_object('action', p_action, 'affected', affected, 'backup_id', backup_id);
end;
$function$;
revoke all on function public.crm_resolve_duplicate_review_items(uuid[], text, text, boolean) from public, anon;
grant execute on function public.crm_resolve_duplicate_review_items(uuid[], text, text, boolean) to authenticated;
