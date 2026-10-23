-- Group every bulk or one-off assignment so admins can review, transfer,
-- extend, or safely delete one operation without guessing from lead dates.

create table if not exists public.crm_assignment_batches (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text not null default '',
  target_names text[] not null default '{}',
  lead_count integer not null default 0 check (lead_count >= 0),
  created_at timestamptz not null default now()
);

alter table public.leads
  add column if not exists assignment_batch_id uuid
    references public.crm_assignment_batches(id) on delete set null;

create index if not exists leads_assignment_batch_id_idx
  on public.leads (assignment_batch_id, assigned_to)
  where assignment_batch_id is not null;

create index if not exists crm_assignment_batches_created_by_idx
  on public.crm_assignment_batches (created_by);

alter table public.crm_assignment_batches enable row level security;
revoke all on public.crm_assignment_batches from anon;
grant select, insert on public.crm_assignment_batches to authenticated;
grant update (target_names, lead_count) on public.crm_assignment_batches to authenticated;

drop policy if exists crm_assignment_batches_select_manage on public.crm_assignment_batches;
create policy crm_assignment_batches_select_manage
  on public.crm_assignment_batches for select to authenticated
  using ((select public.current_user_role())::text in ('admin', 'manager'));

drop policy if exists crm_assignment_batches_insert_manage on public.crm_assignment_batches;
create policy crm_assignment_batches_insert_manage
  on public.crm_assignment_batches for insert to authenticated
  with check (
    (select public.current_user_role())::text in ('admin', 'manager')
    and created_by = (select auth.uid())
  );

drop policy if exists crm_assignment_batches_update_manage on public.crm_assignment_batches;
create policy crm_assignment_batches_update_manage
  on public.crm_assignment_batches for update to authenticated
  using ((select public.current_user_role())::text in ('admin', 'manager'))
  with check ((select public.current_user_role())::text in ('admin', 'manager'));

