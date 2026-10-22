-- Agent workflow buckets and an approval-first cleanup path for closed leads.

create or replace function public.crm_is_closed_lead_status(p_status text)
returns boolean language sql immutable set search_path = '' as $$
  select lower(btrim(coalesce(p_status, ''))) in (
    'dropped', 'lost', 'not interested', 'didn''t enquired', 'didn’t enquired',
    'budget issue', 'location issue', 'non surgical', 'invalid number', 'wrong number'
  );
$$;
revoke all on function public.crm_is_closed_lead_status(text) from public, anon;
grant execute on function public.crm_is_closed_lead_status(text) to authenticated;

alter table public.leads
  add column if not exists assigned_fresh_since timestamptz,
  add column if not exists first_agent_touch_at timestamptz,
  add column if not exists closed_status_since timestamptz;

-- Existing New leads begin as Fresh. Existing non-New leads remain in Follow-up.
update public.leads
set assigned_fresh_since = coalesce(assigned_at, created_at, now())
where assigned_fresh_since is null
  and lower(btrim(coalesce(status, ''))) in ('new', 'new lead', '', '-', '--')
  and btrim(coalesce(assigned_to, '')) not in ('', '-', 'Unassigned');

update public.leads
set closed_status_since = coalesce(updated_at, created_at, now())
where closed_status_since is null
  and public.crm_is_closed_lead_status(status);

create or replace function public.crm_lead_workflow_bucket(
  p_status text,
  p_assigned_fresh_since timestamptz,
  p_first_agent_touch_at timestamptz
)
returns text language sql immutable set search_path = '' as $$
  select case
    when public.crm_is_closed_lead_status(p_status) then 'closed'
    when lower(btrim(coalesce(p_status, ''))) in ('opd booked', 'consultation booked') then 'opdBooked'
    when lower(btrim(coalesce(p_status, ''))) in ('opd done', 'consultation attended') then 'opdDone'
    when lower(btrim(coalesce(p_status, ''))) in ('ipd booked', 'surgery scheduled') then 'ipdBooked'
    when lower(btrim(coalesce(p_status, ''))) in ('ipd done', 'won', 'surgery completed') then 'ipdDone'
    when p_assigned_fresh_since is not null and p_first_agent_touch_at is null then 'fresh'
    else 'followup'
  end;
$$;
revoke all on function public.crm_lead_workflow_bucket(text, timestamptz, timestamptz) from public, anon;
grant execute on function public.crm_lead_workflow_bucket(text, timestamptz, timestamptz) to authenticated;

alter table public.leads add column if not exists workflow_bucket text generated always as (
  public.crm_lead_workflow_bucket(status, assigned_fresh_since, first_agent_touch_at)
) stored;
create index if not exists leads_assigned_workflow_bucket_idx
  on public.leads (assigned_to, workflow_bucket);
create index if not exists leads_closed_status_since_idx
  on public.leads (closed_status_since)
  where closed_status_since is not null;

create or replace function crm_private.track_agent_lead_workflow()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actor_role text;
  actor_name text;
  assigned_name text;
  changed_payload boolean;
begin
  assigned_name := nullif(btrim(coalesce(new.assigned_to, '')), '');
  if assigned_name in ('-', 'Unassigned') then assigned_name := null; end if;

  if tg_op = 'INSERT' then
    if assigned_name is not null then
      new.assigned_at := coalesce(new.assigned_at, now());
      new.assigned_fresh_since := coalesce(new.assigned_fresh_since, new.assigned_at, now());
    else
      new.assigned_fresh_since := null;
    end if;
    if public.crm_is_closed_lead_status(new.status) then
      new.closed_status_since := coalesce(new.closed_status_since, now());
    end if;
    return new;
  end if;

  if lower(btrim(coalesce(new.assigned_to, ''))) is distinct from lower(btrim(coalesce(old.assigned_to, ''))) then
    if assigned_name is null then
      new.assigned_fresh_since := null;
      new.assigned_at := null;
    else
      new.assigned_at := now();
      new.assigned_fresh_since := now();
    end if;
    new.first_agent_touch_at := null;
  end if;

  if public.crm_is_closed_lead_status(new.status) then
    if not public.crm_is_closed_lead_status(old.status) then
      new.closed_status_since := now();
    else
      new.closed_status_since := coalesce(old.closed_status_since, new.closed_status_since, now());
    end if;
  else
    new.closed_status_since := null;
  end if;

  if auth.uid() is not null then
    select p.role::text, p.name into actor_role, actor_name
    from public.profiles p where p.id = auth.uid();
    changed_payload := (to_jsonb(new) - array[
      'updated_at', 'assigned_at', 'assigned_fresh_since', 'first_agent_touch_at',
      'closed_status_since', 'workflow_bucket'
    ]) is distinct from (to_jsonb(old) - array[
      'updated_at', 'assigned_at', 'assigned_fresh_since', 'first_agent_touch_at',
      'closed_status_since', 'workflow_bucket'
    ]);
    if actor_role = 'employee'
       and lower(btrim(coalesce(actor_name, ''))) = lower(btrim(coalesce(new.assigned_to, '')))
       and lower(btrim(coalesce(new.assigned_to, ''))) not in ('', '-', 'unassigned')
       and changed_payload then
      new.first_agent_touch_at := coalesce(new.first_agent_touch_at, now());
    end if;
  end if;
  return new;
end;
$$;
revoke all on function crm_private.track_agent_lead_workflow() from public, anon, authenticated;
drop trigger if exists crm_track_agent_lead_workflow on public.leads;
create trigger crm_track_agent_lead_workflow
before insert or update on public.leads
for each row execute function crm_private.track_agent_lead_workflow();

create or replace function crm_private.mark_agent_touch_from_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor_role text; actor_name text; assigned_name text;
begin
  if lower(btrim(coalesce(new.action_type, ''))) in ('automation', 'assignment', 'import', 'created') then
    return new;
  end if;
  select p.role::text, p.name into actor_role, actor_name
  from public.profiles p where p.id = new.user_id;
  if actor_role <> 'employee' then return new; end if;
  select l.assigned_to into assigned_name from public.leads l where l.id = new.lead_id;
  if lower(btrim(coalesce(assigned_name, ''))) = lower(btrim(coalesce(actor_name, ''))) then
    update public.leads set first_agent_touch_at = coalesce(first_agent_touch_at, new.created_at, now())
    where id = new.lead_id;
  end if;
  return new;
end;
$$;
revoke all on function crm_private.mark_agent_touch_from_activity() from public, anon, authenticated;
drop trigger if exists crm_mark_agent_touch_from_activity on public.lead_activities;
create trigger crm_mark_agent_touch_from_activity
after insert on public.lead_activities
for each row execute function crm_private.mark_agent_touch_from_activity();

create table public.crm_lead_deletion_reviews (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique references public.leads(id) on delete cascade,
  assigned_profile_id uuid references public.profiles(id) on delete set null,
  assigned_to text not null default '',
  closed_status text not null,
  closed_since timestamptz not null,
  created_at timestamptz not null default now(),
  delete_after timestamptz not null,
  snoozed_until timestamptz,
  agent_note text,
  agent_note_by uuid references public.profiles(id) on delete set null,
  agent_note_at timestamptz,
  decision text not null default 'pending' check (decision in ('pending', 'kept')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz
);
create index crm_lead_deletion_reviews_owner_idx
  on public.crm_lead_deletion_reviews (assigned_profile_id, created_at desc)
  where decision = 'pending';
create index crm_lead_deletion_reviews_due_idx
  on public.crm_lead_deletion_reviews (delete_after)
  where decision = 'pending';
alter table public.crm_lead_deletion_reviews enable row level security;
create policy crm_lead_deletion_reviews_select on public.crm_lead_deletion_reviews
  for select to authenticated
  using (
    (select public.current_user_role())::text = 'admin'
    or assigned_profile_id = (select auth.uid())
  );
create policy crm_lead_deletion_reviews_agent_note on public.crm_lead_deletion_reviews
  for update to authenticated
  using (
    (select public.current_user_role())::text = 'employee'
    and assigned_profile_id = (select auth.uid())
    and decision = 'pending'
  )
  with check (
    (select public.current_user_role())::text = 'employee'
    and assigned_profile_id = (select auth.uid())
    and decision = 'pending'
  );
grant select on public.crm_lead_deletion_reviews to authenticated;
grant update (agent_note, agent_note_by, agent_note_at) on public.crm_lead_deletion_reviews to authenticated;
revoke all on public.crm_lead_deletion_reviews from anon;

create or replace function public.crm_submit_deletion_review_note(p_review_id uuid, p_note text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or (select public.current_user_role())::text <> 'employee' then
    raise exception 'Only the assigned employee can add a review note';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 2 or length(p_note) > 1200 then
    raise exception 'Add a note between 2 and 1200 characters';
  end if;
  update public.crm_lead_deletion_reviews
  set agent_note = btrim(p_note), agent_note_by = auth.uid(), agent_note_at = now()
  where id = p_review_id and assigned_profile_id = auth.uid() and decision = 'pending';
  if not found then raise exception 'This review is no longer available'; end if;
end;
$$;
revoke all on function public.crm_submit_deletion_review_note(uuid, text) from public, anon;
grant execute on function public.crm_submit_deletion_review_note(uuid, text) to authenticated;

create or replace function public.crm_admin_resolve_deletion_review(
  p_review_id uuid,
  p_action text,
  p_snooze_days integer default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare review_row public.crm_lead_deletion_reviews;
begin
  if auth.uid() is null or (select public.current_user_role())::text <> 'admin' then
    raise exception 'Admin access required';
  end if;
  select * into review_row
  from public.crm_lead_deletion_reviews r
  where r.id = p_review_id and r.decision = 'pending'
  for update;
  if not found then raise exception 'This review is no longer pending'; end if;

  if p_action = 'keep' then
    update public.crm_lead_deletion_reviews
    set decision = 'kept', decided_by = auth.uid(), decided_at = now(), snoozed_until = null
    where id = p_review_id;
  elsif p_action = 'snooze' then
    if p_snooze_days not between 1 and 2 then raise exception 'Snooze must be one or two days'; end if;
    update public.crm_lead_deletion_reviews
    set snoozed_until = now() + make_interval(days => p_snooze_days)
    where id = p_review_id;
  elsif p_action = 'delete' then
    delete from public.leads where id = review_row.lead_id;
    if not found then raise exception 'Lead was already removed'; end if;
  else
    raise exception 'Choose Delete, Keep, or Snooze';
  end if;
end;
$$;
revoke all on function public.crm_admin_resolve_deletion_review(uuid, text, integer) from public, anon;
grant execute on function public.crm_admin_resolve_deletion_review(uuid, text, integer) to authenticated;

create or replace function crm_private.purge_deleted_lead_copies()
returns trigger language plpgsql security definer set search_path = '' as $$
declare affected_backup_ids uuid[];
begin
  delete from public.crm_assignment_events where lead_id = old.id;
  if to_regclass('public.lead_deletion_backups') is not null then
    execute 'select array_agg(b.id) from public.lead_deletion_backups b
      where b.lead_rows @> jsonb_build_array(jsonb_build_object(''id'', $1))
         or b.activity_rows @> jsonb_build_array(jsonb_build_object(''lead_id'', $1))'
      into affected_backup_ids using old.id::text;
    if coalesce(cardinality(affected_backup_ids), 0) > 0 then
      execute 'update public.lead_deletion_backups b
        set lead_rows = coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(b.lead_rows, ''[]''::jsonb)) item where item ->> ''id'' is distinct from $2), ''[]''::jsonb),
            activity_rows = coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(b.activity_rows, ''[]''::jsonb)) item where item ->> ''lead_id'' is distinct from $2), ''[]''::jsonb),
            row_count = (select count(*)::integer from jsonb_array_elements(coalesce(b.lead_rows, ''[]''::jsonb)) item where item ->> ''id'' is distinct from $2),
            activity_count = (select count(*)::integer from jsonb_array_elements(coalesce(b.activity_rows, ''[]''::jsonb)) item where item ->> ''lead_id'' is distinct from $2)
        where b.id = any($1)'
        using affected_backup_ids, old.id::text;
      execute 'delete from public.lead_deletion_backups b
        where b.id = any($1) and jsonb_array_length(coalesce(b.lead_rows, ''[]''::jsonb)) = 0'
        using affected_backup_ids;
    end if;
  end if;
  return old;
end;
$$;
revoke all on function crm_private.purge_deleted_lead_copies() from public, anon, authenticated;
drop trigger if exists crm_purge_deleted_lead_copies on public.leads;
create trigger crm_purge_deleted_lead_copies
before delete on public.leads
for each row execute function crm_private.purge_deleted_lead_copies();

create or replace function crm_private.cancel_or_refresh_deletion_review()
returns trigger language plpgsql security definer set search_path = '' as $$
declare profile_id uuid;
begin
  if new.closed_status_since is null then
    delete from public.crm_lead_deletion_reviews where lead_id = new.id;
  elsif tg_op = 'UPDATE' and lower(btrim(coalesce(new.assigned_to, ''))) is distinct from lower(btrim(coalesce(old.assigned_to, ''))) then
    select p.id into profile_id from public.profiles p
    where lower(btrim(p.name)) = lower(btrim(new.assigned_to)) limit 1;
    update public.crm_lead_deletion_reviews
    set assigned_profile_id = profile_id, assigned_to = coalesce(new.assigned_to, '')
    where lead_id = new.id and decision = 'pending';
  end if;
  if tg_op = 'UPDATE' and public.crm_is_closed_lead_status(new.status) then
    update public.crm_lead_deletion_reviews set closed_status = new.status
    where lead_id = new.id and decision = 'pending';
  end if;
  return new;
end;
$$;
revoke all on function crm_private.cancel_or_refresh_deletion_review() from public, anon, authenticated;
drop trigger if exists crm_cancel_or_refresh_deletion_review on public.leads;
create trigger crm_cancel_or_refresh_deletion_review
after insert or update of status, assigned_to on public.leads
for each row execute function crm_private.cancel_or_refresh_deletion_review();

create or replace function public.crm_lead_bucket_summary(p_assigned_to text default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare viewer_role text := coalesce((select public.current_user_role())::text, '');
  viewer_id uuid := auth.uid();
  viewer_name text;
  result jsonb;
begin
  if viewer_id is null or viewer_role not in ('admin', 'manager', 'employee') then
    raise exception 'Sign in to view lead buckets';
  end if;
  select p.name into viewer_name from public.profiles p where p.id = viewer_id;
  if viewer_role = 'employee' then
    p_assigned_to := viewer_name;
  end if;
  select jsonb_build_object(
    'total', count(*),
    'fresh', count(*) filter (where l.workflow_bucket = 'fresh'),
    'followUp', count(*) filter (where l.workflow_bucket = 'followup'),
    'opdBooked', count(*) filter (where l.workflow_bucket = 'opdBooked'),
    'opdDone', count(*) filter (where l.workflow_bucket = 'opdDone'),
    'ipdBooked', count(*) filter (where l.workflow_bucket = 'ipdBooked'),
    'ipdDone', count(*) filter (where l.workflow_bucket = 'ipdDone')
  ) into result
  from public.leads l
  where (p_assigned_to is null or lower(btrim(l.assigned_to)) = lower(btrim(p_assigned_to)));
  return result;
end;
$$;
revoke all on function public.crm_lead_bucket_summary(text) from public, anon;
grant execute on function public.crm_lead_bucket_summary(text) to authenticated;

create or replace function public.crm_team_bucket_groups()
returns table(assigned_to text, bucket text, lead_count bigint)
language sql stable security invoker set search_path = '' as $$
  select l.assigned_to, l.workflow_bucket, count(*)
  from public.leads l
  group by l.assigned_to, l.workflow_bucket
  order by l.assigned_to, l.workflow_bucket;
$$;
revoke all on function public.crm_team_bucket_groups() from public, anon;
grant execute on function public.crm_team_bucket_groups() to authenticated;

create or replace function crm_private.daily_lost_lead_reviews()
returns void language plpgsql security definer set search_path = '' as $$
declare review_row record;
begin
  if not pg_try_advisory_xact_lock(22102026) then return; end if;

  insert into public.crm_lead_deletion_reviews (
    lead_id, assigned_profile_id, assigned_to, closed_status, closed_since, delete_after
  )
  select l.id, p.id, coalesce(l.assigned_to, ''), l.status, l.closed_status_since,
         now() + interval '7 days'
  from public.leads l
  left join public.profiles p on lower(btrim(p.name)) = lower(btrim(l.assigned_to))
  where l.closed_status_since <= now() - interval '7 days'
    and public.crm_is_closed_lead_status(l.status)
  on conflict (lead_id) do nothing;

  for review_row in
    select r.id, r.lead_id
    from public.crm_lead_deletion_reviews r
    join public.leads l on l.id = r.lead_id
    where r.decision = 'pending'
      and r.delete_after <= now()
      and l.closed_status_since = r.closed_since
      and public.crm_is_closed_lead_status(l.status)
    order by r.delete_after
    limit 500
    for update of r skip locked
  loop
    delete from public.leads where id = review_row.lead_id;
  end loop;
end;
$$;
revoke all on function crm_private.daily_lost_lead_reviews() from public, anon, authenticated;

-- Run beside the existing daily automation job; cleanup remains active even
-- when the CRM's optional lead automations are switched off.
-- CRON_SETUP_BEGIN
select cron.schedule(
  'aurevia-lost-lead-reviews',
  '0 4 * * *',
  'select crm_private.daily_lost_lead_reviews()'
);
-- CRON_SETUP_END
