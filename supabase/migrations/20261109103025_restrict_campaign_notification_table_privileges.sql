-- Keep the campaign rules RLS-controlled and make notifications immutable to
-- clients except for deleting their own unread rows after marking them read.
revoke all on table public.crm_campaign_assignment_rules from authenticated, public, anon;
grant select, insert, update, delete on table public.crm_campaign_assignment_rules to authenticated;

revoke all on table public.crm_notifications from authenticated, public, anon;
grant select, delete on table public.crm_notifications to authenticated;
