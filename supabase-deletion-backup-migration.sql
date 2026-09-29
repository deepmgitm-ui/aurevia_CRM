-- Aurevia CRM — deletion safety net.
-- Idempotent: every statement can be re-run safely.
--
-- WHY: "Select All" + Delete on the Leads page wipes the whole `leads` table
-- (and `lead_activities` through ON DELETE CASCADE). Free-tier Supabase
-- projects have NO automatic backups, so a mis-click used to be permanent.
-- The app now snapshots the affected rows here BEFORE deleting, and admins can
-- restore them from Leads page → "Recent Deletions".

-- ---------------------------------------------------------------------------
-- lead_deletion_backups: one row per bulk delete, holding the deleted rows as
-- JSON. `lead_rows` mirrors the `leads` columns; `activity_rows` mirrors the
-- cascaded `lead_activities` rows.
-- ---------------------------------------------------------------------------
create table if not exists public.lead_deletion_backups (
  id uuid primary key default gen_random_uuid(),
  deleted_by uuid references public.profiles(id) on delete set null,
  deleted_by_name text not null default '-',
  -- 'all' = whole table, 'search' = matched a search box query,
  -- 'employee' = one employee's leads, 'selection' = ticked ids only.
  scope text not null default 'all',
  search text not null default '',
  row_count integer not null default 0,
  activity_count integer not null default 0,
  lead_rows jsonb not null default '[]'::jsonb,
  activity_rows jsonb not null default '[]'::jsonb,
  restored_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.lead_deletion_backups enable row level security;

drop policy if exists lead_deletion_backups_admin_manager_all on public.lead_deletion_backups;
create policy lead_deletion_backups_admin_manager_all
on public.lead_deletion_backups for all
to authenticated
using (public.current_user_role() in ('admin', 'manager'))
with check (public.current_user_role() in ('admin', 'manager'));

create index if not exists lead_deletion_backups_created_idx
  on public.lead_deletion_backups (created_at desc);

comment on table public.lead_deletion_backups is
  'Snapshot of rows removed by a bulk lead delete, so the delete can be undone in-app.';
