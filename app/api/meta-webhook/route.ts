import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

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

function dashIfEmpty(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "-";
}

function sanitizePhone(value: unknown): string {
  const digits = dashIfEmpty(value).replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits || "-";
}

function getObject(value: JsonValue | undefined): { [key: string]: JsonValue } {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function getFieldValue(fields: MetaField[], names: string[]): string | null {
  const field = fields.find((candidate) => {
    const label =
      typeof candidate.field_name === "string"
        ? candidate.field_name
        : typeof candidate.name === "string"
          ? candidate.name
          : "";
    return names.includes(label.toLowerCase());
  });

  return getString(field?.values?.[0]);
}

function extractLeadData(fields: MetaField[]): LeadData {
  const name =
    getFieldValue(fields, ["full_name", "name", "first_name"]) ?? "";
  const phone = getFieldValue(fields, ["phone_number", "phone", "mobile"]);
  const email = getFieldValue(fields, ["email_address", "email"]);
  const gender = getFieldValue(fields, ["gender"]);
  const city = getFieldValue(fields, ["city"]);
  const disease = getFieldValue(fields, ["disease"]);
  const insuranceStatus =
    getFieldValue(fields, ["insurance_status", "insurance status"]);
  const remarks = getFieldValue(fields, ["remarks", "remark", "remark 1"]);

  return {
    name: dashIfEmpty(name),
    phone: sanitizePhone(phone),
    email: dashIfEmpty(email),
    lead_date: new Date().toLocaleDateString("en-GB"),
    gender: dashIfEmpty(gender),
    city: dashIfEmpty(city),
    disease: dashIfEmpty(disease),
    insurance_status: dashIfEmpty(insuranceStatus),
    remarks: dashIfEmpty(remarks),
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

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  const verifyToken = process.env.META_VERIFY_TOKEN;

  console.log("[Meta Webhook][GET] Verification request received", {
    mode,
    hasToken: Boolean(token),
    hasChallenge: Boolean(challenge),
  });

  if (
    mode === "subscribe" &&
    token === verifyToken &&
    typeof challenge === "string"
  ) {
    console.log("[Meta Webhook][GET] Verification successful");
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  console.warn("[Meta Webhook][GET] Verification failed");
  return new Response("Forbidden", { status: 403 });
}

// Facebook retries webhooks on non-2xx responses, so every POST path ends in 200.
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  console.log("[Meta Webhook][POST] Request received", { requestId });

  try {
    const payload = (await request.json()) as JsonValue;
    const root = getObject(payload);
    const entry = Array.isArray(root.entry) ? getObject(root.entry[0]) : {};
    const changes = Array.isArray(entry.changes) ? getObject(entry.changes[0]) : {};
    const value = getObject(changes.value);

    const leadgenId = getString(value.leadgen_id);
    console.log("[Meta Webhook][POST] Payload parsed", {
      requestId,
      object: getString(root.object),
      entryCount: Array.isArray(root.entry) ? root.entry.length : 0,
      leadgenId,
    });

    if (!leadgenId) {
      console.warn("[Meta Webhook][POST] leadgen_id missing in payload", { requestId });
      return NextResponse.json(
        { success: false, error: "leadgen_id is missing from the webhook payload." },
        { status: 200 },
      );
    }

    const accessToken = process.env.META_ACCESS_TOKEN;
    if (!accessToken) {
      console.error("[Meta Webhook][POST] META_ACCESS_TOKEN is not configured", { requestId });
      return NextResponse.json(
        { success: false, error: "Meta access token is not configured." },
        { status: 200 },
      );
    }

    const graphResponse = await fetch(
      `https://graph.facebook.com/v19.0/${leadgenId}?access_token=${accessToken}`,
    );
    const graphResult = (await graphResponse.json()) as JsonValue;
    const graphObject = getObject(graphResult);

    if (!graphResponse.ok || graphObject.error) {
      console.error("[Meta Webhook][POST] Graph API request failed", {
        requestId,
        leadgenId,
        status: graphResponse.status,
        error: JSON.stringify(graphObject.error ?? null),
      });
      return NextResponse.json(
        { success: false, error: "Unable to fetch lead details from the Meta Graph API." },
        { status: 200 },
      );
    }

    const fields: MetaField[] = Array.isArray(graphObject.field_data)
      ? (graphObject.field_data as MetaField[])
      : [];
    const leadData = extractLeadData(fields);
    console.log("[Meta Webhook][POST] Lead data extracted from Graph API", {
      requestId,
      leadgenId,
      hasName: Boolean(leadData.name),
      hasPhone: Boolean(leadData.phone),
      hasEmail: Boolean(leadData.email),
    });

    const supabase = getSupabaseAdmin();

    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .insert({
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
        status: "New",
        // Stored as 'Hot' (the app's canonical value); the UI renders it as "Hot 🔥".
        temperature: "Hot",
        // '-' leaves the lead in the distribution pool for random/equal assignment.
        assigned_to: "-",
      })
      .select("id")
      .single();

    if (leadError || !lead) {
      console.error("[Meta Webhook][POST] Lead insertion failed", {
        requestId,
        leadgenId,
        error: leadError?.message ?? "No lead returned after insertion.",
      });
      return NextResponse.json(
        { success: false, error: "Unable to create the lead." },
        { status: 200 },
      );
    }

    console.log("[Meta Webhook][POST] Lead inserted successfully", {
      requestId,
      leadId: lead.id,
      leadgenId,
    });

    return NextResponse.json(
      { success: true, leadId: lead.id },
      { status: 200 },
    );
  } catch (error) {
    console.error("[Meta Webhook][POST] Unexpected error", {
      requestId,
      error: error instanceof Error ? error.message : error,
    });
    // Always 200 so Facebook does not retry the webhook.
    return NextResponse.json(
      { success: false, error: "Unable to process Meta webhook." },
      { status: 200 },
    );
  }
}
