# Aurevia CRM — What shipped, what to add next, and how to stay free

> Bhaiyon wali summary: site tez rahe, Supabase free tier me rahe, aur har lead
> ka pata chale — kab aaya, kis treatment ka hai, kahan se aaya.

## 1. Is round me kya judda (Sep 2026)

- **"Added today / yesterday / 3 days ago / 1 week ago …"** — har lead row me
  (`relativeLeadAge` in `app/dashboard/lead-filters.ts`). Saare date formats
  samajhta hai: DD/MM/YYYY (Excel/Meta), YYYY-MM-DD (pickers), ISO timestamps.
- **NEW pill + green row** — aaj/kal/parson ke leads (`isNewLead`, 3-day window)
  table me turant dikhte hain.
- **Treatment-wise breakdown** — leads page pe clickable chips (count ke saath),
  chart wale hi `canonicalTreatment` grouping se, isliye charts aur chips kabhi
  disagree nahi karenge.
- **Age strip** — Today → Yesterday → 2..6 days → 1/2/3 weeks → Older, one click
  filter. Plus "Clear all filters" button jab kuch active ho.
- **Treatment column upgrade** — raw `disease` ke bajaye canonical label + color
  dot + original text sub-line me.
- **Meta webhook hardening** (`app/api/meta-webhook/route.ts` + `lib/meta-lead.ts`):
  custom form questions bhi map hote hain (`which_treatment…` → treatment),
  free-text answers me treatment scan hota hai, campaign name remarks me judta
  hai, 24h duplicate leads skip hote hain, optional X-Hub signature check,
  production me verify token ke bina 403 (koi hardcoded bypass nahi).
- **Indexes** — `leads(status, created_at)`, `leads(assigned_to, created_at)`,
  `leads(phone)` judde (`supabase-indexes.sql`).
- **Verifiers** — `npm run verify:meta` naya; `verify:lead-filters` me age +
  tally ke cases.

## 2. Supabase free tier — kharcha kahan hota hai, rokna kaise hai

Free tier (Sep 2026): ~500 MB database, 1 GB file storage, 5 GB egress/month,
50k MAU, **500k Edge Function invocations**. Humaare liye sirf 3 cheezein matter
karti hain: **database rows**, **egress (data transfer)** aur **realtime
connections**.

### Ye app pehle se cheap kyun hai

- Leads page sirf **50 rows** laata hai (`getLeadsPage` + `.range()`); poori
  table kabhi download nahi hoti.
- Analytics queries me `select('*')` nahi hai — sirf chahiye wale columns
  (`ANALYTICS_BASE_COLUMNS` + treatment probe columns).
- Treatment tally wahi light projection reuse karti hai (ek extra query, ~892
  rows × chhote columns ≈ kuch KB).
- Indexes lage hain → sequential scans nahi, isliye 50k rows tak bhi page ~1
  query me khulta rahega.

### Rules (todoge to bill/pause aayega)

1. **`select('*')` kabhi mat lao** — nayi columns chahiye to projection me jodo.
2. **Export CSV ko rate-limit rakho** — `getLeadsForExport` poori table kheenchta
   hai; 10k+ rows ke baad ise background/PDF-weekly-summary me badlo.
3. **Realtime sirf jahan zaroori** — bell notifications ek connection khaate hain;
   table auto-refresh ke liye polling (30s) mat lagao.
4. **Images ko Storage me, DB me nahi** — agent photos Supabase Storage public
   bucket me raho (already the plan, `photo_url` me sirf URL).
5. **`lead_rollup` view hai** (`supabase-indexes.sql` ke neeche) — jab table
   5–10k cross kare, tally wahi se nikalo; 50k ke baad monthly aggregate table
   banao via scheduled function.

### Kharcha check karne ki jagah

Supabase dashboard → Organization → Usage. Database > 400 MB ya egress tezi se
badhe to mujhe bata — pehla kadam hamesha ek index ya ek projection fix hota
hai, plan upgrade nahi.

## 3. Meta leads — setup checklist (ye karne pe leads rukenge nahi)

App → `https://<vercel-domain>/api/meta-webhook`

1. **Meta App → Settings → Basic** → App Secret copy karo → Vercel env
   `META_APP_SECRET` set karo (signature check on).
2. **App Dashboard → Webhooks → Page → Subscribe** → Callback URL upar wali,
   Verify Token = wahi jo Vercel env `META_VERIFY_TOKEN` me hai → "Verify and
   Save" dabao.
3. Subscribe to **`leadgen`** field. Token ke liye System User + `leads_retrieval`
   permission (page access token, long-lived) → Vercel env `META_ACCESS_TOKEN`.
4. **Test**: Webhooks page se "Test" bhejo ya ek real test lead bharo → lead
   "Meta Ads" source, status New, temperature Hot ke saath aana chahiye, aur
   remarks me `[Campaign Name]` dikhna chahiye.
5. Duplicate aaye? Logs me "Duplicate lead skipped" dikhega — 24h window me
   same number wali entry link hoti hai, nayi row nahi banti.

Sabse common failure: **token mismatch** (Meta me kuch aur, Vercel env me kuch
aur) — tab "Verify and Save" red hota hai. Dusra: `META_ACCESS_TOKEN` expired —
Graph API 190 error logs me dikhega.

## 4. Aage kya add kar sakte ho (priority order, sab free-tier-safe)

1. **Lead detail drawer me "Added 3 days ago"** — table me hai, drawer me nahi
   (1-line change, `relativeLeadAge` already exported).
2. **"New today" bell/count** — dashboard stats me `counts.new` already hai;
   employee ko apne naye leads ka morning summary chahiye to calendar page pe
   ek banner.
3. **Follow-up streak / agent leaderboard** — `findTopPerformer` + activities
   se, koi nayi table nahi.
4. **WhatsApp reminders** — Meta ke `META_ACCESS_TOKEN` se alag, WhatsApp Cloud
   API token lagega; pehle template approve karwao ("follow-up reminder"), phir
   ek server action. Free: 1000 conversations/month.
5. **Kanban pipeline view** — wahi `LeadsPage` data, sirf layout (koi nayi query
   nahi).
6. **Duplicate hunter (manual import wala)** — Excel import ke time same phone wale
   rows ko flag karo, webhook wala 24h rule wahan bhi lagao.
7. **Monthly rollup job** — table 10k cross kare tab `lead_rollup` se ek summary
   table + `getTreatmentTally` ko usi pe shift karo.
8. **meta_lead_id column** — `leads` me ek `meta_lead_id text unique` jodo; webhook
   exact-ID dedupe karega (abhi phone+24h rule hai, kaafi hai jab tak form volume
   chhota hai).
