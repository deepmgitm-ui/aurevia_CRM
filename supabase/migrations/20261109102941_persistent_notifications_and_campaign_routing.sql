alter table public.leads
  add column if not exists meta_campaign_id text,
  add column if not exists meta_campaign_name text,
  add column if not exists meta_form_id text;

create index if not exists leads_meta_campaign_id_created_idx
  on public.leads (meta_campaign_id, created_at desc)
  where meta_campaign_id is not null;

create table if not exists public.crm_campaign_assignment_rules (
  id uuid primary key default gen_random_uuid(),
  campaign_id text,
  campaign_name text not null,
  campaign_name_key text not null,
  form_id text,
  target_profile_ids uuid[] not null,
  assignment_mode text not null default 'round_robin'
    check (assignment_mode in ('round_robin', 'manual')),
  next_target_index integer not null default 0 check (next_target_index >= 0),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(btrim(campaign_name)) between 1 and 160),
  check (campaign_id is null or length(btrim(campaign_id)) between 1 and 200),
  check (form_id is null or length(btrim(form_id)) between 1 and 200),
  check (cardinality(target_profile_ids) between 1 and 20)
);

create unique index if not exists crm_campaign_rules_campaign_id_uidx
  on public.crm_campaign_assignment_rules (campaign_id)
  where campaign_id is not null;
create unique index if not exists crm_campaign_rules_name_uidx
  on public.crm_campaign_assignment_rules (campaign_name_key)
  where campaign_id is null;

alter table public.crm_campaign_assignment_rules enable row level security;
revoke all on public.crm_campaign_assignment_rules from authenticated, public, anon;
grant select, insert, update, delete on public.crm_campaign_assignment_rules to authenticated;

drop policy if exists crm_campaign_rules_select_team on public.crm_campaign_assignment_rules;
create policy crm_campaign_rules_select_team
  on public.crm_campaign_assignment_rules for select to authenticated
  using ((select public.current_user_role())::text in ('admin', 'manager'));

drop policy if exists crm_campaign_rules_insert_admin on public.crm_campaign_assignment_rules;
create policy crm_campaign_rules_insert_admin
  on public.crm_campaign_assignment_rules for insert to authenticated
  with check (
    (select public.current_user_role())::text = 'admin'
    and created_by = (select auth.uid())
  );

drop policy if exists crm_campaign_rules_update_admin on public.crm_campaign_assignment_rules;
create policy crm_campaign_rules_update_admin
  on public.crm_campaign_assignment_rules for update to authenticated
  using ((select public.current_user_role())::text = 'admin')
  with check ((select public.current_user_role())::text = 'admin');

drop policy if exists crm_campaign_rules_delete_admin on public.crm_campaign_assignment_rules;
create policy crm_campaign_rules_delete_admin
  on public.crm_campaign_assignment_rules for delete to authenticated
  using ((select public.current_user_role())::text = 'admin');

create table if not exists public.crm_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in ('lead_created', 'lead_updated', 'lead_assignment')),
  title text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists crm_notifications_recipient_created_idx
  on public.crm_notifications (recipient_id, created_at desc, id desc);

alter table public.crm_notifications enable row level security;
revoke all on public.crm_notifications from authenticated, public, anon;
grant select, delete on public.crm_notifications to authenticated;

drop policy if exists crm_notifications_select_own on public.crm_notifications;
create policy crm_notifications_select_own
  on public.crm_notifications for select to authenticated
  using (recipient_id = (select auth.uid()));

drop policy if exists crm_notifications_delete_own on public.crm_notifications;
create policy crm_notifications_delete_own
  on public.crm_notifications for delete to authenticated
  using (recipient_id = (select auth.uid()));

create or replace function public.crm_notify_lead_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
  lead_label text := coalesce(nullif(btrim(new.name), ''), 'Lead');
  new_owner_id uuid;
  previous_owner_id uuid;
  recipient record;
  event_kind text;
  event_title text;
  event_message text;
begin
  if actor_id is not null then
    select p.name into actor_name from public.profiles p where p.id = actor_id;
  end if;
  actor_name := coalesce(nullif(btrim(actor_name), ''), case
    when new.source = 'Added from Site' then 'Website'
    when new.source = 'Meta Ads' then 'Meta lead form'
    else 'CRM'
  end);

  if tg_op = 'INSERT' then
    event_kind := 'lead_created';
    event_title := 'New lead received';
    for recipient in
      select p.id, p.role::text as role
      from public.profiles p
      where p.role::text in ('admin', 'manager')
         or (
           p.role::text = 'employee'
           and lower(btrim(p.name)) = lower(btrim(coalesce(new.assigned_to, '')))
           and lower(btrim(coalesce(new.assigned_to, ''))) not in ('', '-', 'unassigned')
         )
    loop
      if recipient.id is not distinct from actor_id then continue; end if;
      event_message := case
        when recipient.role = 'employee' then format('%s was assigned to you.', lead_label)
        when lower(btrim(coalesce(new.assigned_to, ''))) not in ('', '-', 'unassigned')
          then format('%s arrived from %s and was assigned to %s.', lead_label, actor_name, new.assigned_to)
        else format('%s arrived from %s and is ready to assign.', lead_label, actor_name)
      end;
      insert into public.crm_notifications (recipient_id, lead_id, actor_id, event_type, title, message)
      values (recipient.id, new.id, actor_id, event_kind,
        case when recipient.role = 'employee' then 'New lead assigned' else event_title end,
        event_message);
    end loop;
    return new;
  end if;

  if lower(btrim(coalesce(new.assigned_to, ''))) is distinct from lower(btrim(coalesce(old.assigned_to, ''))) then
    event_kind := 'lead_assignment';
    event_title := 'Lead assignment changed';
    select p.id into new_owner_id
      from public.profiles p
      where p.role::text = 'employee'
        and lower(btrim(p.name)) = lower(btrim(coalesce(new.assigned_to, '')))
        and lower(btrim(coalesce(new.assigned_to, ''))) not in ('', '-', 'unassigned')
      limit 1;
    select p.id into previous_owner_id
      from public.profiles p
      where p.role::text = 'employee'
        and lower(btrim(p.name)) = lower(btrim(coalesce(old.assigned_to, '')))
        and lower(btrim(coalesce(old.assigned_to, ''))) not in ('', '-', 'unassigned')
      limit 1;

    for recipient in
      select p.id, p.role::text as role
      from public.profiles p
      where p.role::text in ('admin', 'manager')
         or p.id in (new_owner_id, previous_owner_id)
    loop
      if recipient.id is not distinct from actor_id then continue; end if;
      event_message := case
        when recipient.id = new_owner_id then format('%s was assigned to you.', lead_label)
        when recipient.id = previous_owner_id then format('%s was moved to %s.', lead_label, coalesce(nullif(btrim(new.assigned_to), ''), 'Unassigned'))
        else format('%s moved from %s to %s by %s.', lead_label,
          coalesce(nullif(btrim(old.assigned_to), ''), 'Unassigned'),
          coalesce(nullif(btrim(new.assigned_to), ''), 'Unassigned'), actor_name)
      end;
      insert into public.crm_notifications (recipient_id, lead_id, actor_id, event_type, title, message)
      values (recipient.id, new.id, actor_id, event_kind,
        case
          when recipient.id = new_owner_id then 'New lead assigned'
          when recipient.id = previous_owner_id then 'Lead reassigned'
          else event_title
        end,
        event_message);
    end loop;
    return new;
  end if;

  event_kind := 'lead_updated';
  event_title := 'Lead updated';
  for recipient in
    select p.id
    from public.profiles p
    where p.role::text in ('admin', 'manager')
  loop
    if recipient.id is not distinct from actor_id then continue; end if;
    insert into public.crm_notifications (recipient_id, lead_id, actor_id, event_type, title, message)
    values (recipient.id, new.id, actor_id, event_kind, event_title,
      format('%s was updated by %s.', lead_label, actor_name));
  end loop;
  return new;
end;
$$;

revoke all on function public.crm_notify_lead_changes() from public, anon, authenticated;
drop trigger if exists crm_notify_lead_changes on public.leads;
create trigger crm_notify_lead_changes
  after insert or update on public.leads
  for each row execute function public.crm_notify_lead_changes();

create or replace function public.crm_insert_meta_lead(
  p_meta_leadgen_id text,
  p_campaign_id text,
  p_campaign_name text,
  p_form_id text,
  p_request_id uuid,
  p_lead jsonb
)
returns table (lead_id uuid, assigned_to text, duplicate boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_id uuid;
  v_existing_owner text;
  v_rule public.crm_campaign_assignment_rules%rowtype;
  v_has_rule boolean := false;
  v_name text;
  v_owner text := '-';
  v_owner_position integer;
  v_target_count integer;
  v_created_id uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Meta lead intake is service-role only.';
  end if;
  if nullif(btrim(p_meta_leadgen_id), '') is null or p_request_id is null or jsonb_typeof(p_lead) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Invalid Meta lead payload.';
  end if;
  v_name := left(btrim(coalesce(p_lead ->> 'name', '')), 160);
  if v_name = '' then raise exception using errcode = '22023', message = 'Meta lead name is required.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_meta_leadgen_id, 0));
  select l.id, l.assigned_to into v_existing_id, v_existing_owner
    from public.leads l where l.meta_leadgen_id = p_meta_leadgen_id;
  if found then
    return query select v_existing_id, coalesce(v_existing_owner, '-'), true;
    return;
  end if;

  if nullif(btrim(p_campaign_id), '') is not null then
    select r.* into v_rule
      from public.crm_campaign_assignment_rules r
      where r.is_active and r.campaign_id = btrim(p_campaign_id)
        and (r.form_id is null or r.form_id = nullif(btrim(p_form_id), ''))
      for update;
    v_has_rule := found;
  end if;
  if not v_has_rule and nullif(btrim(p_campaign_name), '') is not null then
    select r.* into v_rule
      from public.crm_campaign_assignment_rules r
      where r.is_active and r.campaign_id is null
        and r.campaign_name_key = lower(regexp_replace(btrim(p_campaign_name), '[[:space:]]+', ' ', 'g'))
        and (r.form_id is null or r.form_id = nullif(btrim(p_form_id), ''))
      for update;
    v_has_rule := found;
  end if;

  if v_has_rule and v_rule.assignment_mode = 'round_robin' then
    v_target_count := cardinality(v_rule.target_profile_ids);
    if v_target_count > 0 then
      select p.name, targets.position::integer into v_owner, v_owner_position
        from unnest(v_rule.target_profile_ids) with ordinality as targets(profile_id, position)
        join public.profiles p on p.id = targets.profile_id and p.role::text = 'employee'
        order by mod(
          targets.position::integer - 1 - (v_rule.next_target_index % v_target_count) + v_target_count,
          v_target_count
        )
        limit 1;
      if found then
        update public.crm_campaign_assignment_rules r
          set next_target_index = v_owner_position % v_target_count,
              updated_at = now()
          where r.id = v_rule.id;
      else
        v_owner := '-';
      end if;
    end if;
  end if;

  insert into public.leads (
    name, phone, email, gender, city, disease, insurance_status, remarks,
    lead_date, follow_up_date, source, source_batch_id, source_batch_label,
    source_batch_created_at, status, assigned_to, meta_leadgen_id,
    meta_campaign_id, meta_campaign_name, meta_form_id
  ) values (
    v_name,
    left(coalesce(nullif(btrim(p_lead ->> 'phone'), ''), '-'), 32),
    left(coalesce(nullif(btrim(p_lead ->> 'email'), ''), '-'), 254),
    left(coalesce(nullif(btrim(p_lead ->> 'gender'), ''), '-'), 40),
    left(coalesce(nullif(btrim(p_lead ->> 'city'), ''), '-'), 120),
    left(coalesce(nullif(btrim(p_lead ->> 'disease'), ''), '-'), 160),
    left(coalesce(nullif(btrim(p_lead ->> 'insurance_status'), ''), '-'), 80),
    left(coalesce(nullif(btrim(p_lead ->> 'remarks'), ''), '-'), 2000),
    left(coalesce(nullif(btrim(p_lead ->> 'lead_date'), ''), '-'), 32),
    '-', 'Meta Ads', p_request_id,
    left('Meta Ads' || case when nullif(btrim(p_campaign_name), '') is not null then ' — ' || btrim(p_campaign_name) else '' end
      || case when nullif(btrim(p_form_id), '') is not null then ' · Form ' || btrim(p_form_id) else '' end, 240),
    now(), 'New', v_owner, p_meta_leadgen_id,
    nullif(btrim(p_campaign_id), ''), nullif(btrim(p_campaign_name), ''), nullif(btrim(p_form_id), '')
  ) returning id into v_created_id;

  return query select v_created_id, v_owner, false;
end;
$$;

revoke all on function public.crm_insert_meta_lead(text, text, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.crm_insert_meta_lead(text, text, text, text, uuid, jsonb) to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'crm_notifications'
     ) then
    execute 'alter publication supabase_realtime add table public.crm_notifications';
  end if;
end;
$$;
