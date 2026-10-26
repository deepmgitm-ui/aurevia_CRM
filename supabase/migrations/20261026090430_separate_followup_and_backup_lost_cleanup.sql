-- Keep Follow-up Work exclusive and preserve a restorable backup before the
-- seven-day closed-lead cleanup. Applying this migration does not delete rows.

create or replace function public.crm_is_followup_work_status(p_status text)
returns boolean language sql immutable set search_path = '' as $function$
  select lower(btrim(coalesce(p_status, ''))) in
    ('', '-', '--', 'new', 'new lead', 'follow-up', 'follow up', 'contacted');
$function$;
revoke all on function public.crm_is_followup_work_status(text) from public, anon;
grant execute on function public.crm_is_followup_work_status(text) to authenticated;

create or replace function public.crm_lead_bucket_summary(p_assigned_to text default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $function$
declare
  viewer_role text := coalesce((select public.current_user_role())::text, '');
  viewer_id uuid := auth.uid();
  viewer_name text;
  today_start timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  result jsonb;
begin
  if viewer_id is null or viewer_role not in ('admin', 'manager', 'employee') then raise exception 'Sign in to view lead buckets'; end if;
  select p.name into viewer_name from public.profiles p where p.id = viewer_id;
  if viewer_role = 'employee' then p_assigned_to := viewer_name; end if;
  with scoped as materialized (
    select l.workflow_bucket, l.assigned_fresh_since, l.status from public.leads l
    where p_assigned_to is null or lower(btrim(l.assigned_to)) = lower(btrim(p_assigned_to))
  ),
  status_counts as (
    select case
      when status is null or lower(btrim(status)) in ('', '-', '--', 'new', 'new lead') then 'New'
      when lower(btrim(status)) in ('follow-up', 'follow up', 'contacted') then 'Follow-Up'
      when lower(btrim(status)) = 'dnp' then 'DNP'
      when lower(btrim(status)) in ('dnp2', 'dnp 2') then 'DNP2'
      when lower(btrim(status)) in ('dnp3', 'dnp 3') then 'DNP3'
      when lower(btrim(status)) in ('rnr', 'not reachable') then 'RNR'
      when lower(btrim(status)) = 'not interested' then 'Not Interested'
      when lower(btrim(status)) in ('didn’t enquired', 'didn''t enquired') then 'Didn’t Enquired'
      when lower(btrim(status)) = 'budget issue' then 'Budget Issue'
      when lower(btrim(status)) = 'location issue' then 'Location Issue'
      when lower(btrim(status)) = 'non surgical' then 'Non Surgical'
      when lower(btrim(status)) in ('opd booked', 'consultation booked') then 'OPD Booked'
      when lower(btrim(status)) in ('opd done', 'consultation attended') then 'OPD Done'
      when lower(btrim(status)) in ('ipd done', 'won', 'surgery completed') then 'IPD Done'
      when lower(btrim(status)) = 'ipd booked' then 'IPD Booked'
      when lower(btrim(status)) in ('dropped', 'lost') then 'Dropped'
      when lower(btrim(status)) = 'invalid number' then 'Invalid Number'
      when lower(btrim(status)) in ('callback', 'call back', 'call back later') then 'CallBack'
      when lower(btrim(status)) = 'wrong number' then 'Wrong Number'
      else btrim(status)
    end label, count(*) amount from scoped group by 1
  ),
  pipeline as (
    select count(*) total,
      count(*) filter (where workflow_bucket='fresh' and assigned_fresh_since < today_start) fresh,
      count(*) filter (where workflow_bucket='followup' and public.crm_is_followup_work_status(status)) follow_up,
      count(*) filter (where workflow_bucket='opdBooked') opd_booked,
      count(*) filter (where workflow_bucket='opdDone') opd_done,
      count(*) filter (where workflow_bucket='ipdBooked') ipd_booked,
      count(*) filter (where workflow_bucket='ipdDone') ipd_done,
      count(*) filter (where workflow_bucket='closed') lost from scoped
  )
  select jsonb_build_object(
    'total',pipeline.total,'fresh',pipeline.fresh,'followUp',pipeline.follow_up,
    'opdBooked',pipeline.opd_booked,'opdDone',pipeline.opd_done,
    'ipdBooked',pipeline.ipd_booked,'ipdDone',pipeline.ipd_done,'lost',pipeline.lost,
    'statuses',coalesce((select jsonb_object_agg(label,amount) from status_counts),'{}'::jsonb)
  ) into result from pipeline;
  return result;
end;
$function$;
revoke all on function public.crm_lead_bucket_summary(text) from public, anon;
grant execute on function public.crm_lead_bucket_summary(text) to authenticated;

create or replace function public.crm_team_bucket_groups()
returns table(assigned_to text, bucket text, lead_count bigint)
language sql stable security invoker set search_path = '' as $function$
  with categorized as (
    select l.assigned_to, case
      when l.workflow_bucket='fresh' and l.assigned_fresh_since >= today.starts_at then 'new'
      when l.workflow_bucket='closed' then 'lost'
      when l.workflow_bucket='followup' and public.crm_is_followup_work_status(l.status) then 'followup'
      when l.workflow_bucket='followup' then null
      else l.workflow_bucket end bucket
    from public.leads l
    cross join lateral (select date_trunc('day',now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' starts_at) today
  )
  select assigned_to,bucket,count(*) from categorized where bucket is not null
  group by assigned_to,bucket order by assigned_to,bucket;
$function$;
revoke all on function public.crm_team_bucket_groups() from public, anon;
grant execute on function public.crm_team_bucket_groups() to authenticated;

create or replace function crm_private.snapshot_leads_for_permanent_delete(
  p_ids uuid[], p_scope text, p_deleted_by uuid default null,
  p_deleted_by_name text default 'Automatic cleanup'
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare saved_leads jsonb; saved_activities jsonb; saved_count integer; saved_activity_count integer; backup_id uuid;
begin
  if coalesce(cardinality(p_ids),0)=0 then return null; end if;
  if to_regclass('public.lead_deletion_backups') is null then raise exception 'Deletion backup storage is unavailable; nothing was deleted'; end if;
  select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at desc),'[]'::jsonb) into saved_leads
    from public.leads l where l.id=any(p_ids);
  saved_count := jsonb_array_length(saved_leads);
  if saved_count=0 then return null; end if;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at),'[]'::jsonb) into saved_activities
    from public.lead_activities a where a.lead_id=any(p_ids);
  saved_activity_count := jsonb_array_length(saved_activities);
  insert into public.lead_deletion_backups(deleted_by,deleted_by_name,scope,search,row_count,activity_count,lead_rows,activity_rows,created_at)
  values(p_deleted_by,coalesce(nullif(btrim(p_deleted_by_name),''),'Automatic cleanup'),
    left(coalesce(nullif(btrim(p_scope),''),'Permanent lead deletion'),120),'',saved_count,saved_activity_count,
    saved_leads,saved_activities,clock_timestamp()) returning id into backup_id;
  return backup_id;
end;
$function$;
revoke all on function crm_private.snapshot_leads_for_permanent_delete(uuid[],text,uuid,text) from public,anon,authenticated;

-- Preserve the newest backup containing a deleted lead; scrub only older copies.
create or replace function crm_private.purge_deleted_lead_copies()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare older_backup_ids uuid[];
begin
  delete from public.crm_assignment_events where lead_id=old.id;
  if to_regclass('public.lead_deletion_backups') is not null then
    execute $sql$
      with matching as (
        select b.id,row_number() over(order by b.created_at desc,b.id desc) position
        from public.lead_deletion_backups b
        where b.lead_rows @> jsonb_build_array(jsonb_build_object('id',$1))
          or b.activity_rows @> jsonb_build_array(jsonb_build_object('lead_id',$1))
      ) select array_agg(id) filter(where position>1) from matching
    $sql$ into older_backup_ids using old.id::text;
    if coalesce(cardinality(older_backup_ids),0)>0 then
      execute $sql$
        update public.lead_deletion_backups b set
          lead_rows=coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(b.lead_rows,'[]'::jsonb)) item where item->>'id' is distinct from $2),'[]'::jsonb),
          activity_rows=coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(b.activity_rows,'[]'::jsonb)) item where item->>'lead_id' is distinct from $2),'[]'::jsonb),
          row_count=(select count(*)::integer from jsonb_array_elements(coalesce(b.lead_rows,'[]'::jsonb)) item where item->>'id' is distinct from $2),
          activity_count=(select count(*)::integer from jsonb_array_elements(coalesce(b.activity_rows,'[]'::jsonb)) item where item->>'lead_id' is distinct from $2)
        where b.id=any($1)
      $sql$ using older_backup_ids,old.id::text;
      execute $sql$ delete from public.lead_deletion_backups b where b.id=any($1) and jsonb_array_length(coalesce(b.lead_rows,'[]'::jsonb))=0 $sql$ using older_backup_ids;
    end if;
  end if;
  return old;
end;
$function$;
revoke all on function crm_private.purge_deleted_lead_copies() from public,anon,authenticated;

-- The manual review Delete action also leaves a Recent Deletions snapshot.
create or replace function public.crm_admin_resolve_deletion_review(p_review_id uuid,p_action text,p_snooze_days integer default null)
returns void language plpgsql security definer set search_path = '' as $function$
declare review_row public.crm_lead_deletion_reviews;
begin
  if auth.uid() is null or (select public.current_user_role())::text <> 'admin' then raise exception 'Admin access required'; end if;
  select * into review_row from public.crm_lead_deletion_reviews r where r.id=p_review_id and r.decision='pending' for update;
  if not found then raise exception 'This review is no longer pending'; end if;
  if p_action='keep' then
    update public.crm_lead_deletion_reviews set decision='kept',decided_by=auth.uid(),decided_at=now(),snoozed_until=null where id=p_review_id;
  elsif p_action='snooze' then
    if p_snooze_days not between 1 and 2 then raise exception 'Snooze must be one or two days'; end if;
    update public.crm_lead_deletion_reviews set snoozed_until=now()+make_interval(days=>p_snooze_days) where id=p_review_id;
  elsif p_action='delete' then
    perform crm_private.snapshot_leads_for_permanent_delete(array[review_row.lead_id],'Admin deletion review',auth.uid(),'Admin deletion review');
    delete from public.leads where id=review_row.lead_id;
    if not found then raise exception 'Lead was already removed'; end if;
  else raise exception 'Choose Delete, Keep, or Snooze'; end if;
end;
$function$;
revoke all on function public.crm_admin_resolve_deletion_review(uuid,text,integer) from public,anon;
grant execute on function public.crm_admin_resolve_deletion_review(uuid,text,integer) to authenticated;

-- Close date + 7 days is the deadline. Migration itself never invokes this job.
create or replace function crm_private.daily_lost_lead_reviews()
returns void language plpgsql security definer set search_path = '' as $function$
declare due_lead_ids uuid[];
begin
  if not pg_try_advisory_xact_lock(22102026) then return; end if;
  insert into public.crm_lead_deletion_reviews(lead_id,assigned_profile_id,assigned_to,closed_status,closed_since,delete_after)
  select l.id,p.id,coalesce(l.assigned_to,''),l.status,l.closed_status_since,l.closed_status_since+interval '7 days'
  from public.leads l left join public.profiles p on lower(btrim(p.name))=lower(btrim(l.assigned_to))
  where l.closed_status_since is not null
    and public.crm_is_closed_lead_status(l.status)
  on conflict(lead_id) do update set
    assigned_profile_id=excluded.assigned_profile_id,assigned_to=excluded.assigned_to,
    closed_status=excluded.closed_status,closed_since=excluded.closed_since,
    delete_after=greatest(excluded.delete_after,coalesce(public.crm_lead_deletion_reviews.snoozed_until,excluded.delete_after))
  where public.crm_lead_deletion_reviews.decision='pending';

  select coalesce(array_agg(due.lead_id),'{}'::uuid[]) into due_lead_ids from (
    select r.lead_id from public.crm_lead_deletion_reviews r join public.leads l on l.id=r.lead_id
    where r.decision='pending' and r.delete_after<=now()
      and (r.snoozed_until is null or r.snoozed_until<=now())
      and l.closed_status_since=r.closed_since and public.crm_is_closed_lead_status(l.status)
    order by r.delete_after,r.lead_id limit 100 for update of r,l skip locked
  ) due;
  if cardinality(due_lead_ids)>0 then
    perform crm_private.snapshot_leads_for_permanent_delete(due_lead_ids,'Lost leads — 7-day auto-cleanup',null,'Automatic cleanup');
    delete from public.leads where id=any(due_lead_ids);
  end if;
end;
$function$;
revoke all on function crm_private.daily_lost_lead_reviews() from public,anon,authenticated;
