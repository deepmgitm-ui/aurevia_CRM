create index if not exists crm_lead_deletion_reviews_agent_note_by_idx
  on public.crm_lead_deletion_reviews (agent_note_by)
  where agent_note_by is not null;

create index if not exists crm_lead_deletion_reviews_decided_by_idx
  on public.crm_lead_deletion_reviews (decided_by)
  where decided_by is not null;
