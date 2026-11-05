-- Keep duplicate review matching identical to the existing database phone guard.
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
