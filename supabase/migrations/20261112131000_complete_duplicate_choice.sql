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
      lead_date = coalesce(nullif(candidate->>'lead_date', ''), lead_date),
      follow_up_date = coalesce(nullif(candidate->>'follow_up_date', ''), follow_up_date),
      source = coalesce(nullif(candidate->>'source', ''), source),
      status = coalesce(nullif(candidate->>'status', ''), status),
      imported_status = coalesce(nullif(candidate->>'imported_status', ''), imported_status)
    where id = queue_row.lead_id;
  end if;

  update public.crm_duplicate_review_queue
  set resolved_at = now(), resolved_by = actor_id, resolution = 'kept', incoming_candidates = '[]'::jsonb
  where id = p_review_id;
  return jsonb_build_object('kept', case when p_candidate_index is null then 'existing' else 'incoming' end);
end;
$function$;
revoke all on function public.crm_choose_duplicate_review_candidate(uuid, integer) from public, anon;
grant execute on function public.crm_choose_duplicate_review_candidate(uuid, integer) to authenticated;

