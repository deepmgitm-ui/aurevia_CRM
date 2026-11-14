# Connect Meta Lead Ads

The CRM already receives lead-form webhooks at `/api/meta-webhook`, retrieves
the submitted form fields from the Graph API, maps custom questions, and saves
the lead with source `Meta Ads`. It records the Meta lead ID so Meta retries do
not create another CRM lead. It verifies Meta's request signature before
accepting patient data.

## Values to configure

Add these values as server-only environment variables in the Render
`aurevia-crm` service's Environment settings, then redeploy:

- `META_APP_ID`: the app ID from Meta App Dashboard → App settings → Basic.
- `META_APP_SECRET`: from Meta App Dashboard → App settings → Basic.
- `META_REDIRECT_URI`: `https://aurevia-crm.onrender.com/api/meta/callback`. Add this exact
  URL to Facebook Login → Valid OAuth Redirect URIs in the Meta app.
- `META_TOKEN_ENCRYPTION_KEY`: a random 32-byte key, encoded as 64 hex characters.
- `META_VERIFY_TOKEN`: a long random value you create and also enter in Meta.
- `META_ACCESS_TOKEN`: optional fallback Page access token for webhook delivery; OAuth
  stores connected Page tokens in the CRM.
- `SUPABASE_SERVICE_ROLE_KEY`: the existing server-side key used to save leads.
- `NEXT_PUBLIC_SUPABASE_URL`: the existing project URL.
- `META_GRAPH_API_VERSION`: currently `v26.0` unless the app has been tested
  against a different supported version.

Never paste these secrets into CRM chat or commit them to Git. Keep the token
and app secret out of browser-exposed variables.

## Meta Developer Dashboard

1. In Meta for Developers, create/select the business app, enable Facebook Login,
   and add the required Marketing API and Lead Ads permissions (`ads_read`,
   `ads_management`, `leads_retrieval`, `pages_show_list`,
   `pages_read_engagement`, `pages_manage_metadata`). Meta may require App Review
   or Advanced Access for people outside the app's roles.
2. Add `https://aurevia-crm.onrender.com/api/meta/callback` under Facebook Login →
   Valid OAuth Redirect URIs. This OAuth URL is different from the webhook URL.
3. Under Webhooks, select the Page object and subscribe to `leadgen`; set the
   callback URL to `https://aurevia-crm.onrender.com/api/meta-webhook` and the
   verify token to the exact Render `META_VERIFY_TOKEN`. Choose Verify and Save.
4. In the Page's Lead Ads settings, connect the app and grant the Facebook user
   access to the Page and lead forms.
5. In CRM Marketing, select Connect Facebook Ads and finish Facebook Login. The
   CRM then loads active campaigns and registers the Page leadgen webhook.
5. In Meta's Lead Ads Testing tool, submit a test lead. Confirm it appears in
   the CRM with source `Meta Ads`, the expected patient fields and campaign
   label. Submit/retry the same test lead and confirm only one record exists.

Meta may require business verification, app review and approved permissions
before a real clinic Page can authorize lead retrieval. Those approvals happen
in Meta and cannot be completed from this repository.

## Public webhook availability

Meta needs a public callback URL that does not require CRM sign-in. The current
Render service URL is `https://aurevia-crm.onrender.com`; use
`https://aurevia-crm.onrender.com/api/meta-webhook` unless the service's public
domain changes. Render Free can spin down after 15 minutes without inbound
traffic and take about a minute to wake, so the first webhook after idle may be
delayed. Meta retries and the stored `leadgen_id` make repeated deliveries
idempotent. See [Render's Free instance limits](https://render.com/docs/free).

## Troubleshooting

- Webhook verification fails: check the exact callback URL and verify token,
  then redeploy after setting Render variables.
- Delivery returns a signature error or 503: confirm `META_APP_SECRET` matches
  the selected Meta app and is present in the active deployment environment.
- Graph API lookup fails: refresh the Page token and verify lead retrieval
  permissions and Page access in Meta Business settings.
- Delivery succeeds but the lead is absent: inspect Render service logs by
  request ID and verify `SUPABASE_SERVICE_ROLE_KEY` and the Supabase URL.
