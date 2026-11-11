-- Keep a complete, admin-only archive before permanently removing old leads.
-- Existing leads receive two months from rollout before their first expiry.

create table if not exists public.crm_lead_retention_config (
  singleton boolean primary key default true check (singleton),
  enabled_at timestamptz not null default clock_timestamp()
);
revoke all on public.crm_lead_retention_config from public, anon, authenticated;
insert into public.crm_lead_retention_config (singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.crm_lead_retention_archives (
  id uuid primary key default gen_random_uuid(),
  deleted_at timestamptz not null default clock_timestamp(),
  deleted_by_name text not null default 'Automatic two-month retention',
  lead_count integer not null check (lead_count > 0),
  activity_count integer not null default 0,
  lead_rows jsonb not null,
  activity_rows jsonb not null default '[]'::jsonb,
  related_rows jsonb not null default '{}'::jsonb
);
create index if not exists crm_lead_retention_archives_deleted_at_idx
  on public.crm_lead_retention_archives (deleted_at desc);
alter table public.crm_lead_retention_archives enable row level security;
revoke all on public.crm_lead_retention_archives from public, anon;
grant select on public.crm_lead_retention_archives to authenticated;
drop policy if exists crm_lead_retention_archives_admin_read on public.crm_lead_retention_archives;
create policy crm_lead_retention_archives_admin_read
  on public.crm_lead_retention_archives for select to authenticated
  using ((select public.current_user_role())::text = 'admin');

create or replace function public.crm_admin_lead_retention_reminders(p_limit integer default 10)
returns table (
  lead_id uuid,
  lead_name text,
  lead_phone text,
  lead_status text,
  assigned_to text,
  created_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if auth.uid() is null or (select public.current_user_role())::text <> 'admin' then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 20 then
    raise exception using errcode = '22023', message = 'Reminder page size is out of range';
  end if;

  return query
  select l.id, coalesce(nullif(btrim(l.name), ''), 'Unnamed lead'),
    coalesce(l.phone, ''), coalesce(l.status, 'New'), coalesce(l.assigned_to, ''),
    l.created_at, greatest(l.created_at, c.enabled_at) + interval '2 months'
  from public.leads l
  cross join public.crm_lead_retention_config c
  where c.singleton
    and greatest(l.created_at, c.enabled_at) + interval '2 months' <= now() + interval '7 days'
  order by greatest(l.created_at, c.enabled_at) + interval '2 months', l.id
  limit p_limit;
end;
$function$;
revoke all on function public.crm_admin_lead_retention_reminders(integer) from public, anon;
grant execute on function public.crm_admin_lead_retention_reminders(integer) to authenticated;

create or replace function crm_private.expire_leads_past_retention()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  expired_ids uuid[];
  expired_count integer;
  saved_leads jsonb;
  saved_activities jsonb;
  saved_related jsonb;
  saved_activity_count integer;
begin
  if not pg_try_advisory_xact_lock(22112026) then return 0; end if;

  select coalesce(array_agg(due.id), '{}'::uuid[])
  into expired_ids
  from (
    select l.id
    from public.leads l
    cross join public.crm_lead_retention_config c
    where c.singleton
      and now() >= c.enabled_at + interval '2 months'
      and l.created_at <= now() - interval '2 months'
    order by l.created_at, l.id
    limit 100
    for update of l skip locked
  ) due;

  expired_count := coalesce(cardinality(expired_ids), 0);
  if expired_count = 0 then return 0; end if;

  select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at, l.id), '[]'::jsonb)
  into saved_leads from public.leads l where l.id = any(expired_ids);
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at, a.id), '[]'::jsonb)
  into saved_activities from public.lead_activities a where a.lead_id = any(expired_ids);
  saved_activity_count := jsonb_array_length(saved_activities);

  select jsonb_build_object(
    'crm_assignment_events', coalesce((select jsonb_agg(to_jsonb(e) order by e.assigned_at, e.id) from public.crm_assignment_events e where e.lead_id = any(expired_ids)), '[]'::jsonb),
    'crm_appointments', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at, a.id) from public.crm_appointments a where a.lead_id = any(expired_ids)), '[]'::jsonb),
    'crm_appointment_events', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at, e.id) from public.crm_appointment_events e where e.lead_id = any(expired_ids)), '[]'::jsonb),
    'crm_duplicate_review_queue', coalesce((select jsonb_agg(to_jsonb(q) order by q.last_seen_at, q.id) from public.crm_duplicate_review_queue q where q.lead_id = any(expired_ids)), '[]'::jsonb),
    'crm_lead_deletion_reviews', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at, r.id) from public.crm_lead_deletion_reviews r where r.lead_id = any(expired_ids)), '[]'::jsonb),
    'crm_notifications', coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at, n.id) from public.crm_notifications n where n.lead_id = any(expired_ids)), '[]'::jsonb)
  ) into saved_related;

  -- Archive and hard-delete run in one transaction; an archive failure aborts deletion.
  insert into public.crm_lead_retention_archives (
    lead_count, activity_count, lead_rows, activity_rows, related_rows
  ) values (
    jsonb_array_length(saved_leads), saved_activity_count,
    saved_leads, saved_activities, saved_related
  );
  delete from public.leads where id = any(expired_ids);

  return expired_count;
end;
$function$;
revoke all on function crm_private.expire_leads_past_retention() from public, anon, authenticated;

-- The job is bounded to 100 leads per run to keep daily database work small.
do $block$
declare existing_job_id bigint;
begin
  select jobid into existing_job_id from cron.job where jobname = 'aurevia-two-month-lead-retention';
  if existing_job_id is not null then perform cron.unschedule(existing_job_id); end if;
  perform cron.schedule(
    'aurevia-two-month-lead-retention',
    '0 5 * * *',
    'select crm_private.expire_leads_past_retention()'
  );
end;
$block$;
