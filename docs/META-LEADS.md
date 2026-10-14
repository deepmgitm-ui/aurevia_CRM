# Connect Meta Lead Ads

The CRM already receives lead-form webhooks at `/api/meta-webhook`, retrieves
the submitted form fields from the Graph API, maps custom questions, and saves
the lead with source `Meta Ads`. It records the Meta lead ID so Meta retries do
not create another CRM lead. It verifies Meta's request signature before
accepting patient data.

## Values to configure

Add these values as server-only environment variables in Vercel (Production and
Preview only if you want to test there), then redeploy:

- `META_VERIFY_TOKEN`: a long random value you create and also enter in Meta.
- `META_APP_SECRET`: from Meta App Dashboard → App settings → Basic.
- `META_ACCESS_TOKEN`: a Page access token for the Page that owns the lead
  form, with the required lead retrieval permission.
- `SUPABASE_SERVICE_ROLE_KEY`: the existing server-side key used to save leads.
- `NEXT_PUBLIC_SUPABASE_URL`: the existing project URL.
- `META_GRAPH_API_VERSION`: currently `v26.0` unless the app has been tested
  against a different supported version.

Never paste these secrets into CRM chat or commit them to Git. Keep the token
and app secret out of browser-exposed variables.

## Meta Developer Dashboard

1. In Meta for Developers, create/select the business app and add Webhooks and
   the Lead Ads permissions/products required for the clinic's Page.
2. Under Webhooks, select the Page object and subscribe to `leadgen`.
3. Set the callback URL to `https://<public-production-domain>/api/meta-webhook`
   and the verify token to the exact `META_VERIFY_TOKEN` value. Choose Verify
   and Save. The callback must be reachable by Meta without a login page.
4. In the Page's Lead Ads settings, connect the app and grant it access to the
   Page and lead forms. Generate the Page access token with lead retrieval and
   Page subscription permissions; set it as `META_ACCESS_TOKEN` in Vercel.
5. In Meta's Lead Ads Testing tool, submit a test lead. Confirm it appears in
   the CRM with source `Meta Ads`, the expected patient fields and campaign
   label. Submit/retry the same test lead and confirm only one record exists.

Meta may require business verification, app review and approved permissions
before a real clinic Page can authorize lead retrieval. Those approvals happen
in Meta and cannot be completed from this repository.

## Vercel deployment protection

The current Vercel project has SSO protection enabled for deployment domains,
and it has no custom domain attached. Meta cannot complete webhook verification
through a protected login page. Use a production custom domain that is exempt
from deployment protection, or configure Vercel's automation bypass for this
third-party webhook. The bypass query secret grants access to the protected
deployment, so treat it like a credential and prefer a dedicated public
production domain where possible. See [Vercel's webhook bypass guidance](https://vercel.com/docs/security/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation).

## Troubleshooting

- Webhook verification fails: check the exact callback URL and verify token,
  then redeploy after setting Vercel variables.
- Delivery returns a signature error or 503: confirm `META_APP_SECRET` matches
  the selected Meta app and is present in the active deployment environment.
- Graph API lookup fails: refresh the Page token and verify lead retrieval
  permissions and Page access in Meta Business settings.
- Delivery succeeds but the lead is absent: inspect Vercel function logs by
  request ID and verify `SUPABASE_SERVICE_ROLE_KEY` and the Supabase URL.
