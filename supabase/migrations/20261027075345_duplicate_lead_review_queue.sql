-- Persist phone-duplicate reviews so admins can close and reopen the review
-- dialog. Unassigned, unresolved existing leads are backed up and removed
-- after 24 hours; assigning or explicitly keeping a lead resolves the item.

create table public.crm_duplicate_review_queue (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique references public.leads(id) on delete cascade,
  phone_identity text not null,
  incoming_name text not null default '',
  source text not null default 'Unknown',
  attempt_count integer not null default 1 check (attempt_count > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolution text check (resolution in ('assigned', 'kept'))
);

create index crm_duplicate_review_queue_due_idx
  on public.crm_duplicate_review_queue (expires_at, lead_id)
  where resolved_at is null;
create index crm_duplicate_review_queue_resolved_by_idx
  on public.crm_duplicate_review_queue (resolved_by);

alter table public.crm_duplicate_review_queue enable row level security;
revoke all on public.crm_duplicate_review_queue from anon, authenticated;
grant select on public.crm_duplicate_review_queue to authenticated;
create policy crm_duplicate_review_queue_admin_select
  on public.crm_duplicate_review_queue for select to authenticated
  using ((select public.current_user_role())::text in ('admin', 'manager'));

create or replace function public.crm_capture_duplicate_review_candidates(
  p_candidates jsonb,
  p_source text default 'Unknown'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  candidate jsonb;
  identity text;
  inserted_count integer := 0;
  candidate_name text;
  matched record;
  caller_role text := current_setting('request.jwt.claim.role', true);
begin
  if auth.uid() is null and caller_role is distinct from 'service_role' then
    raise exception 'Authentication required';
  end if;
  if auth.uid() is not null and coalesce((select public.current_user_role())::text, '') not in ('admin', 'manager', 'employee') then
    raise exception 'CRM account required';
  end if;
  if jsonb_typeof(p_candidates) is distinct from 'array'
     or jsonb_array_length(p_candidates) > 5000 then
    raise exception 'Duplicate review input must contain up to 5000 candidates';
  end if;

  for candidate in select value from jsonb_array_elements(p_candidates) as item(value)
  loop
    identity := right(regexp_replace(coalesce(candidate->>'phone_identity', ''), '\D', '', 'g'), 10);
    candidate_name := left(btrim(coalesce(candidate->>'name', '')), 160);
    if length(identity) <> 10 then continue; end if;

    for matched in
      select l.id
      from public.leads l
      where length(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g')) >= 10
        and right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 10) = identity
      order by l.created_at, l.id
    loop
      insert into public.crm_duplicate_review_queue (
        lead_id, phone_identity, incoming_name, source, attempt_count,
        first_seen_at, last_seen_at, expires_at, resolved_at, resolved_by, resolution
      ) values (
        matched.id, identity, candidate_name,
        left(coalesce(nullif(btrim(p_source), ''), 'Unknown'), 80),
        1, now(), now(), now() + interval '24 hours', null, null, null
      )
      on conflict (lead_id) do update set
        phone_identity = excluded.phone_identity,
        incoming_name = excluded.incoming_name,
        source = excluded.source,
        attempt_count = case
          when public.crm_duplicate_review_queue.resolved_at is null
            then public.crm_duplicate_review_queue.attempt_count + 1
          else 1
        end,
        first_seen_at = case
          when public.crm_duplicate_review_queue.resolved_at is null
            then public.crm_duplicate_review_queue.first_seen_at
          else now()
        end,
        last_seen_at = now(),
        expires_at = case
          when public.crm_duplicate_review_queue.resolved_at is null
            then public.crm_duplicate_review_queue.expires_at
          else now() + interval '24 hours'
        end,
        resolved_at = null,
        resolved_by = null,
        resolution = null;
      inserted_count := inserted_count + 1;
    end loop;
  end loop;
  return inserted_count;
end;
$function$;
revoke all on function public.crm_capture_duplicate_review_candidates(jsonb, text) from public, anon;
grant execute on function public.crm_capture_duplicate_review_candidates(jsonb, text) to authenticated, service_role;

create or replace function public.crm_resolve_duplicate_review_items(
  p_review_ids uuid[],
  p_action text,
  p_target_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
  if actor_id is null or actor_role not in ('admin', 'manager') then
    raise exception 'Admin or manager access required';
  end if;
  if coalesce(cardinality(p_review_ids), 0) = 0 or cardinality(p_review_ids) > 500 then
    raise exception 'Select between 1 and 500 duplicate leads';
  end if;
  if p_action not in ('assign', 'keep', 'delete') then
    raise exception 'Choose Assign, Keep, or Delete';
  end if;

  select p.name into actor_name from public.profiles p where p.id = actor_id;
  select coalesce(array_agg(selected.lead_id), '{}'::uuid[]) into lead_ids
  from (
    select q.lead_id
    from public.crm_duplicate_review_queue q
    where q.id = any(p_review_ids) and q.resolved_at is null
    for update
  ) selected;
  if coalesce(cardinality(lead_ids), 0) = 0 then
    raise exception 'These duplicate reviews are no longer pending';
  end if;

  if p_action = 'assign' then
    select p.name, p.role::text into target_name, target_role
    from public.profiles p
    where lower(btrim(p.name)) = lower(btrim(coalesce(p_target_name, '')))
      and (actor_role = 'admin' or p.role::text = 'employee')
    order by case when p.role::text = 'employee' then 0 else 1 end, p.name
    limit 1;
    if target_name is null or target_role not in ('employee', 'manager', 'admin') then
      raise exception 'Choose an active team member';
    end if;
    target_names := array[target_name];
    insert into public.crm_assignment_batches(label, created_by, created_by_name, target_names, lead_count)
    values (
      left('Duplicate review transfer — ' || target_name, 240),
      actor_id, coalesce(nullif(btrim(actor_name), ''), '-'), target_names, cardinality(lead_ids)
    ) returning id into batch_id;
    update public.leads
    set assigned_to = target_name, assigned_at = now(), assignment_batch_id = batch_id
    where id = any(lead_ids);
    get diagnostics affected = row_count;
    update public.crm_duplicate_review_queue
    set resolved_at = now(), resolved_by = actor_id, resolution = 'assigned'
    where id = any(p_review_ids) and resolved_at is null;
  elsif p_action = 'keep' then
    if exists (
      select 1 from public.leads l where l.id = any(lead_ids)
        and lower(btrim(coalesce(l.assigned_to, ''))) in ('', '-', 'unassigned')
    ) then
      raise exception 'Unassigned duplicate leads must be assigned or deleted';
    end if;
    update public.crm_duplicate_review_queue
    set resolved_at = now(), resolved_by = actor_id, resolution = 'kept'
    where id = any(p_review_ids) and resolved_at is null;
    get diagnostics affected = row_count;
  else
    backup_id := crm_private.snapshot_leads_for_permanent_delete(
      lead_ids, 'Duplicate review deletion', actor_id, coalesce(nullif(btrim(actor_name), ''), 'CRM admin')
    );
    if backup_id is null then raise exception 'Recovery backup could not be created; nothing was deleted'; end if;
    delete from public.leads where id = any(lead_ids);
    get diagnostics affected = row_count;
  end if;

  return jsonb_build_object('action', p_action, 'affected', affected, 'backup_id', backup_id);
end;
$function$;
revoke all on function public.crm_resolve_duplicate_review_items(uuid[], text, text) from public, anon;
grant execute on function public.crm_resolve_duplicate_review_items(uuid[], text, text) to authenticated;

create or replace function crm_private.resolve_duplicate_review_after_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if lower(btrim(coalesce(new.assigned_to, ''))) not in ('', '-', 'unassigned')
     and lower(btrim(coalesce(new.assigned_to, ''))) is distinct from lower(btrim(coalesce(old.assigned_to, ''))) then
    update public.crm_duplicate_review_queue
    set resolved_at = now(), resolved_by = auth.uid(), resolution = 'assigned'
    where lead_id = new.id and resolved_at is null;
  elsif lower(btrim(coalesce(new.assigned_to, ''))) in ('', '-', 'unassigned')
     and lower(btrim(coalesce(old.assigned_to, ''))) not in ('', '-', 'unassigned') then
    update public.crm_duplicate_review_queue
    set resolved_at = null, resolved_by = null, resolution = null,
        first_seen_at = now(), last_seen_at = now(), expires_at = now() + interval '24 hours'
    where lead_id = new.id;
  end if;
  return new;
end;
$function$;
revoke all on function crm_private.resolve_duplicate_review_after_assignment() from public, anon, authenticated;
drop trigger if exists crm_resolve_duplicate_review_after_assignment on public.leads;
create trigger crm_resolve_duplicate_review_after_assignment
after update of assigned_to on public.leads
for each row execute function crm_private.resolve_duplicate_review_after_assignment();

create or replace function crm_private.cleanup_expired_duplicate_reviews()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  due_lead_ids uuid[];
begin
  if not pg_try_advisory_xact_lock(27102026) then return; end if;
  select coalesce(array_agg(due.lead_id), '{}'::uuid[]) into due_lead_ids
  from (
    select q.lead_id
    from public.crm_duplicate_review_queue q
    join public.leads l on l.id = q.lead_id
    where q.resolved_at is null
      and q.expires_at <= now()
      and lower(btrim(coalesce(l.assigned_to, ''))) in ('', '-', 'unassigned')
    order by q.expires_at, q.lead_id
    limit 200
    for update of q, l skip locked
  ) due;
  if cardinality(due_lead_ids) = 0 then return; end if;

  perform crm_private.snapshot_leads_for_permanent_delete(
    due_lead_ids, 'Unassigned duplicates — 24-hour cleanup', null, 'Automatic duplicate cleanup'
  );
  delete from public.leads where id = any(due_lead_ids);
end;
$function$;
revoke all on function crm_private.cleanup_expired_duplicate_reviews() from public, anon, authenticated;

do $schedule$
declare existing_job record;
begin
  for existing_job in select jobid from cron.job where jobname = 'aurevia-duplicate-review-cleanup'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
  perform cron.schedule(
    'aurevia-duplicate-review-cleanup',
    '0 * * * *',
    'select crm_private.cleanup_expired_duplicate_reviews()'
  );
end;
$schedule$;
