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
    const results: { leadId?: string; duplicate?: boolean }[] = [];
    for (const { leadgenId } of events) {
      // `campaign_name` / `form_id` give every lead a traceable origin without
      // another API call.
      const graphResponse = await fetch(
        `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${leadgenId}?fields=field_data,campaign_name,form_id&access_token=${encodeURIComponent(accessToken)}`,
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
      const formId = getString(graphObject.form_id) ?? "-";

      // A retry is idempotent by Meta's unique leadgen ID. Same-phone leads
      // remain deduplicated for the existing 24-hour window.
      if (leadData.phone && leadData.phone !== "-") {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: existing } = await supabase
          .from("leads")
          .select("id")
          .ilike("phone", `%${leadData.phone}`)
          .gte("created_at", since)
          .limit(1);
        if (existing?.length) {
          results.push({ leadId: existing[0].id, duplicate: true });
          continue;
        }
      }

      const { data: lead, error: leadError } = await supabase
        .from("leads")
        .insert({
          meta_leadgen_id: leadgenId,
          name: leadData.name,
          phone: leadData.phone,
          email: leadData.email,
          lead_date: leadData.lead_date,
          gender: leadData.gender,
          city: leadData.city,
          disease: leadData.disease,
          insurance_status: leadData.insurance_status,
          remarks: leadData.remarks,
          source: "Meta Ads",
          source_batch_id: requestId,
          source_batch_label: `Meta Ads${campaignName !== "-" ? ` — ${campaignName}` : ""}${formId !== "-" ? ` · Form ${formId}` : ""}`.slice(0, 240),
          source_batch_created_at: new Date().toISOString(),
          status: "New",
          assigned_to: "-",
        })
        .select("id")
        .single();

      if (leadError?.code === "23505") {
        results.push({ duplicate: true });
        continue;
      }
      if (leadError || !lead) {
        console.error("[Meta Webhook][POST] Lead insertion failed", {
          requestId,
          error: leadError?.message ?? "No lead returned after insertion.",
        });
        return NextResponse.json(
          { success: false, error: "Unable to create the lead." },
          { status: 503 },
        );
      }
      results.push({ leadId: lead.id });
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
