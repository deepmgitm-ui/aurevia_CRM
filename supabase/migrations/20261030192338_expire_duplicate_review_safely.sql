-- A rejected duplicate is a review record, not a new lead. Never delete the
-- original lead automatically when this review expires.
alter table public.crm_duplicate_review_queue
  drop constraint if exists crm_duplicate_review_queue_resolution_check;
alter table public.crm_duplicate_review_queue
  add constraint crm_duplicate_review_queue_resolution_check
  check (resolution in ('assigned', 'kept', 'expired'));

create or replace function crm_private.cleanup_expired_duplicate_reviews()
returns void language plpgsql security definer set search_path = '' as $function$
begin
  if not pg_try_advisory_xact_lock(27102026) then return; end if;
  update public.crm_duplicate_review_queue q
  set resolved_at = now(), resolved_by = null, resolution = 'expired'
  where q.id in (
    select pending.id
    from public.crm_duplicate_review_queue pending
    join public.leads l on l.id = pending.lead_id
    where pending.resolved_at is null and pending.expires_at <= now()
      and lower(btrim(coalesce(l.assigned_to, ''))) in ('', '-', 'unassigned')
    order by pending.expires_at, pending.id
    limit 200
    for update of pending, l skip locked
  );
end;
$function$;
revoke all on function crm_private.cleanup_expired_duplicate_reviews() from public, anon, authenticated;
