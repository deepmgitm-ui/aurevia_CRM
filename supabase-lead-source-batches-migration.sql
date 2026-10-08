-- Exact import-batch identity for safe, selective lead deletion.
-- Existing leads keep NULL batch fields and are shown as Legacy / batch unknown.
-- Idempotent: safe to run more than once.

alter table public.leads
  add column if not exists source_batch_id uuid,
  add column if not exists source_batch_label text,
  add column if not exists source_batch_created_at timestamptz;

create index if not exists leads_source_batch_id_idx
  on public.leads (source_batch_id)
  where source_batch_id is not null;
