-- Aurevia CRM — master data (admin-editable picklists).
-- Idempotent: every statement can be re-run safely.
--
-- WHY: dropdown options (lead statuses, treatments, sources, cities, ...) were
-- hardcoded in the client. An admin can now change them at runtime in
-- Settings -> Master Data instead of waiting for a code deploy. If this table
-- is missing or empty, the app falls back to the seed in lib/master-data.ts,
-- so nothing ever renders a broken/empty select.
--
-- ---------------------------------------------------------------------------
-- crm_option_lists: one row per list key, holding an ordered string array.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_option_lists (
  key text primary key,
  options text[] not null default '{}'::text[],
  updated_at timestamptz not null default now()
);

alter table public.crm_option_lists enable row level security;

-- Everyone signed in can READ the lists (they feed every dropdown).
drop policy if exists crm_option_lists_select_all on public.crm_option_lists;
create policy crm_option_lists_select_all
on public.crm_option_lists for select
to authenticated
using (true);

-- Only admins/managers can WRITE them (Settings screen enforces the same).
drop policy if exists crm_option_lists_write_admin_manager on public.crm_option_lists;
create policy crm_option_lists_write_admin_manager
on public.crm_option_lists for all
to authenticated
using (public.current_user_role() in ('admin', 'manager'))
with check (public.current_user_role() in ('admin', 'manager'));

-- ---------------------------------------------------------------------------
-- Seed: the same values the app previously hardcoded (see lib/master-data.ts
-- MASTER_DATA_SEED). `on conflict do nothing` keeps admin edits intact on
-- re-runs — the migration only fills lists that do not exist yet.
-- ---------------------------------------------------------------------------
insert into public.crm_option_lists (key, options) values
  ('statuses', array[
    'New', 'Follow Up', 'Contacted', 'DNP', 'DNP 3', 'RNR',
    'Not Interested', 'Budget Issue', 'Location Issue', 'Non Surgical',
    'Consultation Booked', 'Consultation Attended', 'Surgery Completed',
    'OPD Booked', 'OPD Done', 'IPD Done',
    'Invalid Number', 'Lost', 'Won'
  ]),
  ('treatments', array['LASIK', 'Cataract', 'ICL', 'Retina', 'Spectacles', 'Other']),
  ('sources', array[
    'Meta Ads', 'Online Enquiry', 'Agent Referral', 'Doctor Referral',
    'Walk-in', 'Corporate Tie-up', 'Social Media', 'Manual', 'Excel/CSV'
  ]),
  ('cities', array['Mumbai', 'Pune', 'Delhi', 'Nagpur', 'Thane', 'Nashik']),
  ('temperatures', array['Hot', 'Warm', 'Cold'])
on conflict (key) do nothing;

comment on table public.crm_option_lists is
  'Admin-editable dropdown options (statuses, treatments, sources, cities, temperatures).';
