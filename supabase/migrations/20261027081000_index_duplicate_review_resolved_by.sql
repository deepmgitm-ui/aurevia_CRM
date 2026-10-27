create index if not exists crm_duplicate_review_queue_resolved_by_idx
  on public.crm_duplicate_review_queue (resolved_by);
