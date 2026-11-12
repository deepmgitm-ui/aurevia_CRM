alter table public.crm_duplicate_review_queue
  add column if not exists incoming_candidates jsonb not null default '[]'::jsonb;

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
  candidate_data jsonb;
  identity text;
  inserted_count integer := 0;
  candidate_name text;
  matched record;
  caller_role text := current_setting('request.jwt.claim.role', true);
begin
  if auth.uid() is null and caller_role is distinct from 'service_role' then raise exception 'Authentication required'; end if;
  if auth.uid() is not null and coalesce((select public.current_user_role())::text, '') not in ('admin', 'manager', 'employee') then raise exception 'CRM account required'; end if;
  if jsonb_typeof(p_candidates) is distinct from 'array' or jsonb_array_length(p_candidates) > 5000 then
    raise exception 'Duplicate review input must contain up to 5000 candidates';
  end if;

  for candidate in select value from jsonb_array_elements(p_candidates) as item(value)
  loop
    identity := right(regexp_replace(coalesce(candidate->>'phone_identity', ''), '\D', '', 'g'), 10);
    candidate_name := left(btrim(coalesce(candidate->>'name', '')), 160);
    candidate_data := case when jsonb_typeof(candidate->'lead_data') = 'object' then candidate->'lead_data' else null end;
    if length(identity) <> 10 then continue; end if;

    for matched in
      select l.id from public.leads l
      where length(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g')) >= 10
        and right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 10) = identity
      order by l.created_at, l.id
    loop
      insert into public.crm_duplicate_review_queue (
        lead_id, phone_identity, incoming_name, incoming_candidates, source, attempt_count,
        first_seen_at, last_seen_at, expires_at, resolved_at, resolved_by, resolution
      ) values (
        matched.id, identity, candidate_name,
        case when candidate_data is null then '[]'::jsonb else jsonb_build_array(candidate_data) end,
        left(coalesce(nullif(btrim(p_source), ''), 'Unknown'), 80),
        1, now(), now(), now() + interval '24 hours', null, null, null
      )
      on conflict (lead_id) do update set
        phone_identity = excluded.phone_identity,
        incoming_name = excluded.incoming_name,
        incoming_candidates = case
          when candidate_data is null then public.crm_duplicate_review_queue.incoming_candidates
          when public.crm_duplicate_review_queue.incoming_candidates @> jsonb_build_array(candidate_data) then public.crm_duplicate_review_queue.incoming_candidates
          else public.crm_duplicate_review_queue.incoming_candidates || jsonb_build_array(candidate_data)
        end,
        source = excluded.source,
        attempt_count = case when public.crm_duplicate_review_queue.resolved_at is null then public.crm_duplicate_review_queue.attempt_count + 1 else 1 end,
        first_seen_at = case when public.crm_duplicate_review_queue.resolved_at is null then public.crm_duplicate_review_queue.first_seen_at else now() end,
        last_seen_at = now(),
        expires_at = case when public.crm_duplicate_review_queue.resolved_at is null then public.crm_duplicate_review_queue.expires_at else now() + interval '24 hours' end,
        resolved_at = null, resolved_by = null, resolution = null;
      inserted_count := inserted_count + 1;
    end loop;
  end loop;
  return inserted_count;
end;
$function$;
revoke all on function public.crm_capture_duplicate_review_candidates(jsonb, text) from public, anon;
grant execute on function public.crm_capture_duplicate_review_candidates(jsonb, text) to authenticated, service_role;

create or replace function public.crm_choose_duplicate_review_candidate(
  p_review_id uuid,
  p_candidate_index integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  candidate jsonb;
  queue_row public.crm_duplicate_review_queue%rowtype;
begin
  if actor_id is null or coalesce((select public.current_user_role())::text, '') not in ('admin', 'manager') then
    raise exception 'Admin or manager access required';
  end if;
  select * into queue_row from public.crm_duplicate_review_queue
  where id = p_review_id and resolved_at is null for update;
  if not found then raise exception 'This duplicate group is no longer pending'; end if;

  if p_candidate_index is not null then
    if p_candidate_index < 0 or p_candidate_index >= jsonb_array_length(queue_row.incoming_candidates) then
      raise exception 'That incoming lead option is no longer available';
    end if;
    candidate := queue_row.incoming_candidates->p_candidate_index;
    if right(regexp_replace(coalesce(candidate->>'phone', ''), '\D', '', 'g'), 10) <> queue_row.phone_identity then
      raise exception 'The selected lead does not match this duplicate phone';
    end if;
    update public.leads set
      name = coalesce(nullif(candidate->>'name', ''), name),
      phone = coalesce(nullif(candidate->>'phone', ''), phone),
      email = coalesce(nullif(candidate->>'email', ''), email),
      gender = coalesce(nullif(candidate->>'gender', ''), gender),
      city = coalesce(nullif(candidate->>'city', ''), city),
      disease = coalesce(nullif(candidate->>'disease', ''), disease),
      insurance_status = coalesce(nullif(candidate->>'insurance_status', ''), insurance_status),
      remarks = coalesce(nullif(candidate->>'remarks', ''), remarks),
      source = coalesce(nullif(candidate->>'source', ''), source),
      status = coalesce(nullif(candidate->>'status', ''), status),
      imported_status = coalesce(nullif(candidate->>'imported_status', ''), imported_status)
    where id = queue_row.lead_id;
  end if;

  update public.crm_duplicate_review_queue
  set resolved_at = now(), resolved_by = actor_id, resolution = 'kept'
  where id = p_review_id;
  return jsonb_build_object('kept', case when p_candidate_index is null then 'existing' else 'incoming' end);
end;
$function$;
revoke all on function public.crm_choose_duplicate_review_candidate(uuid, integer) from public, anon;
grant execute on function public.crm_choose_duplicate_review_candidate(uuid, integer) to authenticated;

