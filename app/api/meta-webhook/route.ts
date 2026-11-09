import { createHmac, timingSafeEqual } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

import { extractMetaLead } from "@/lib/meta-lead";
import { getLeadgenEvents } from "@/lib/meta-webhook";

export const runtime = "nodejs";
// Never cache the verification endpoint — Meta's "Verify and Save" must always hit the live handler.
export const dynamic = "force-dynamic";

const META_GRAPH_API_VERSION = (process.env.META_GRAPH_API_VERSION?.trim() || "v26.0")
  .replace(/^v?/i, "v");
// Meta's "Verify and Save" token. In production it MUST come from the
// environment — the previous hardcoded fallback let anyone who could read this
// repo verify the webhook. Local development keeps the friendly value so
// `next dev` works before a full Meta app is configured.
const META_VERIFY_TOKEN =
  process.env.META_VERIFY_TOKEN?.trim() ||
  (process.env.NODE_ENV === "production" ? "" : "aurevia_super_secret_token_123");

// Required for public lead writes. The POST handler returns 503 until this is
// configured so unauthenticated webhook requests can never create patient data.
const META_APP_SECRET = process.env.META_APP_SECRET?.trim();

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

// Meta sends `field_name` in webhook payloads but `name` in Graph API responses.
type MetaField = {
  field_name?: string;
  name?: string;
  values?: JsonValue[];
};

type LeadData = {
  name: string;
  phone: string;
  email: string;
  lead_date: string;
  gender: string;
  city: string;
  disease: string;
  insurance_status: string;
  remarks: string;
};

function getString(value: JsonValue | undefined): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return null;
}

function getObject(value: JsonValue | undefined): { [key: string]: JsonValue } {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** Meta's X-Hub-Signature-256, compared in constant time. */
function isValidMetaSignature(rawBody: string, header: string | null): boolean {
  if (!META_APP_SECRET) return true;
  const provided = (header ?? "").trim();
  if (!provided.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", META_APP_SECRET).update(rawBody, "utf8").digest("hex");
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(provided.slice("sha256=".length), "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Thin adapter over lib/meta-lead.ts — all alias / keyword matching lives there
 * so `scripts/verify-meta.mts` can test it without a server. Meta forms name
 * their questions however they like ("which_treatment_are_you_interested_in"),
 * which is exactly why the old exact-name lookup left treatment + city blank.
 */
function extractLeadData(fields: MetaField[]): LeadData {
  const parsed = extractMetaLead(fields);
  return {
    name: parsed.name,
    phone: parsed.phone,
    email: parsed.email,
    lead_date: parsed.leadDate,
    gender: parsed.gender,
    city: parsed.city,
    disease: parsed.disease,
    insurance_status: parsed.insuranceStatus,
    remarks: parsed.remarks,
  };
}

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase server environment variables are not configured.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    // Meta's "Verify and Save": the token must match the env value exactly.
    if (!META_VERIFY_TOKEN) {
      console.error("[Meta Webhook][GET] META_VERIFY_TOKEN is not configured — refusing to verify");
      return new Response("Verify token not configured", { status: 403 });
    }
    if (mode === "subscribe" && token === META_VERIFY_TOKEN) {
      return new Response(challenge, {
        status: 200,
        headers: { "Content-Type": "text/plain" }
      });
    }
    return new Response("Forbidden", { status: 403 });
  } catch {
    return new Response("Error", { status: 500 });
  }
}

// A 2xx acknowledges delivery; return non-2xx for failures Meta should retry.
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  console.log("[Meta Webhook][POST] Request received", { requestId });

  try {
    // Lead details contain patient contact data. Never accept public writes
    // when Meta's request-signing secret has not been configured.
    if (!META_APP_SECRET) {
      console.error("[Meta Webhook][POST] META_APP_SECRET is not configured", { requestId });
      return NextResponse.json(
        { success: false, error: "Meta webhook signature verification is not configured." },
        { status: 503 },
      );
    }

    // The signature covers the RAW body, so read the text first and parse it by
    // hand (request.json() would consume the stream and leave nothing to hash).
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 1_000_000) {
      return NextResponse.json({ success: false, error: "Webhook payload is too large." }, { status: 413 });
    }
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > 1_000_000) {
      return NextResponse.json({ success: false, error: "Webhook payload is too large." }, { status: 413 });
    }
    if (!isValidMetaSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
      console.warn("[Meta Webhook][POST] Invalid X-Hub-Signature-256 — payload rejected", { requestId });
      return NextResponse.json({ success: false, error: "Invalid signature." }, { status: 401 });
    }

    let payload: JsonValue;
    try {
      payload = JSON.parse(rawBody || "{}") as JsonValue;
    } catch {
      console.warn("[Meta Webhook][POST] Invalid JSON payload", { requestId });
      return NextResponse.json({ success: false, error: "Invalid JSON payload." }, { status: 400 });
    }
    const events = getLeadgenEvents(payload);
    console.log("[Meta Webhook][POST] Payload parsed", {
      requestId,
      eventCount: events.length,
    });

    if (events.length === 0) {
      console.warn("[Meta Webhook][POST] No leadgen events in payload", { requestId });
      return NextResponse.json(
        { success: false, error: "No leadgen events found in the webhook payload." },
        { status: 400 },
      );
    }

    const accessToken = process.env.META_ACCESS_TOKEN;
    if (!accessToken) {
      console.error("[Meta Webhook][POST] META_ACCESS_TOKEN is not configured", { requestId });
      return NextResponse.json(
        { success: false, error: "Meta access token is not configured." },
        { status: 503 },
      );
    }

    const supabase = getSupabaseAdmin();
    const results: { leadId?: string; duplicate?: boolean; reviewQueued?: boolean; assignedTo?: string }[] = [];
    for (const { leadgenId } of events) {
      // A retry for a Meta lead already stored can be acknowledged immediately,
      // even if the Graph token has since expired.
      const { data: existingMetaLead, error: existingMetaLeadError } = await supabase
        .from("leads")
        .select("id, assigned_to")
        .eq("meta_leadgen_id", leadgenId)
        .maybeSingle();
      if (existingMetaLeadError) {
        console.error("[Meta Webhook][POST] Meta lead idempotency lookup failed", {
          requestId,
          error: existingMetaLeadError.message,
        });
        return NextResponse.json(
          { success: false, error: "Unable to verify whether this lead was already received." },
          { status: 503 },
        );
      }
      if (existingMetaLead) {
        results.push({ leadId: existingMetaLead.id, assignedTo: existingMetaLead.assigned_to ?? "-", duplicate: true });
        continue;
      }

      // `campaign_name` / `form_id` give every lead a traceable origin without
      // another API call.
      const graphResponse = await fetch(
        `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${leadgenId}?fields=field_data,campaign_id,campaign_name,form_id&access_token=${encodeURIComponent(accessToken)}`,
        { signal: AbortSignal.timeout(12_000) },
      );
      const graphResult = (await graphResponse.json()) as JsonValue;
      const graphObject = getObject(graphResult);

      if (!graphResponse.ok || graphObject.error) {
        console.error("[Meta Webhook][POST] Graph API request failed", {
          requestId,
          status: graphResponse.status,
          error: JSON.stringify(graphObject.error ?? null),
        });
        return NextResponse.json(
          { success: false, error: "Unable to fetch lead details from the Meta Graph API." },
          { status: 502 },
        );
      }

      const fields: MetaField[] = Array.isArray(graphObject.field_data)
        ? (graphObject.field_data as MetaField[])
        : [];
      const leadData = extractLeadData(fields);
      const campaignName = getString(graphObject.campaign_name) ?? "-";
      const campaignId = getString(graphObject.campaign_id) ?? "-";
      const formId = getString(graphObject.form_id) ?? "-";

      // Different Meta lead IDs with a recently seen phone enter the existing
      // duplicate-review workflow instead of being silently discarded.
      if (leadData.phone && leadData.phone !== "-") {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: existing, error: duplicateLookupError } = await supabase
          .from("leads")
          .select("id")
          .ilike("phone", `%${leadData.phone}`)
          .gte("created_at", since)
          .limit(1);
        if (duplicateLookupError) {
          console.error("[Meta Webhook][POST] Phone duplicate lookup failed", {
            requestId,
            error: duplicateLookupError.message,
          });
          return NextResponse.json(
            { success: false, error: "Unable to check whether this lead already exists." },
            { status: 503 },
          );
        }
        if (existing?.length) {
          const phoneIdentity = leadData.phone.replace(/\D/g, "").slice(-10);
          const { error: reviewError } = await supabase.rpc("crm_capture_duplicate_review_candidates", {
            p_candidates: [{ phone_identity: phoneIdentity, name: leadData.name }],
            p_source: "Meta Ads",
          });
          if (reviewError) {
            console.error("[Meta Webhook][POST] Duplicate review could not be queued", {
              requestId,
              error: reviewError.message,
            });
            return NextResponse.json(
              { success: false, error: "Unable to save the duplicate review." },
              { status: 503 },
            );
          }
          results.push({ leadId: existing[0].id, duplicate: true, reviewQueued: true });
          continue;
        }
      }

      const { data: created, error: leadError } = await supabase.rpc("crm_insert_meta_lead", {
        p_meta_leadgen_id: leadgenId,
        p_campaign_id: campaignId === "-" ? null : campaignId,
        p_campaign_name: campaignName === "-" ? null : campaignName,
        p_form_id: formId === "-" ? null : formId,
        p_request_id: requestId,
        p_lead: leadData,
      });

      if (leadError?.code === "23505") {
        const phoneIdentity = leadData.phone.replace(/\D/g, "").slice(-10);
        const { error: reviewError } = await supabase.rpc("crm_capture_duplicate_review_candidates", {
          p_candidates: [{ phone_identity: phoneIdentity, name: leadData.name }],
          p_source: "Meta Ads",
        });
        if (reviewError) {
          console.error("[Meta Webhook][POST] Duplicate review could not be queued", {
            requestId,
            error: reviewError.message,
          });
          return NextResponse.json(
            { success: false, error: "Unable to save the duplicate review." },
            { status: 503 },
          );
        }
        results.push({ duplicate: true, reviewQueued: true });
        continue;
      }
      if (leadError || !Array.isArray(created) || !created[0]?.lead_id) {
        console.error("[Meta Webhook][POST] Lead insertion failed", {
          requestId,
          error: leadError?.message ?? "No lead returned after insertion.",
        });
        return NextResponse.json(
          { success: false, error: "Unable to create the lead." },
          { status: 503 },
        );
      }
      const result = created[0] as { lead_id: string; assigned_to: string; duplicate: boolean };
      results.push({ leadId: result.lead_id, assignedTo: result.assigned_to, duplicate: result.duplicate });
    }

    return NextResponse.json({ success: true, processed: results.length, results }, { status: 200 });
  } catch (error) {
    console.error("[Meta Webhook][POST] Unexpected error", {
      requestId,
      error: error instanceof Error ? error.message : error,
    });
    // A non-2xx response lets Meta retry transient Graph API / database failures.
    return NextResponse.json(
      { success: false, error: "Unable to process Meta webhook." },
      { status: 500 },
    );
  }
}
