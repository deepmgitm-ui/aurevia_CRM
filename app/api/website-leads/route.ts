import { createHmac, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ORIGINS = new Set([
  "https://aureviahealthcare.com",
  "https://www.aureviahealthcare.com",
]);
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const MAX_BODY_BYTES = 8 * 1024;
const intakeAttempts = new Map<string, { startedAt: number; count: number }>();

type IntakePayload = {
  name?: unknown;
  phone?: unknown;
  city?: unknown;
  treatment?: unknown;
  message?: unknown;
  utmSource?: unknown;
  utmMedium?: unknown;
  utmCampaign?: unknown;
  utmContent?: unknown;
  utmTerm?: unknown;
  landingPage?: unknown;
  website_url?: unknown;
};

function text(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function getClientAddress(request: NextRequest): string {
  const direct = request.headers.get("x-real-ip") ?? request.headers.get("cf-connecting-ip");
  if (direct?.trim()) return direct.trim();

  // The first X-Forwarded-For entry is the original client in Render's proxy chain.
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

function consumeRateLimit(address: string): boolean {
  const now = Date.now();
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return false;

  const key = createHmac("sha256", secret).update(address).digest("hex");
  const previous = intakeAttempts.get(key);
  if (!previous || now - previous.startedAt >= RATE_LIMIT_WINDOW_MS) {
    intakeAttempts.set(key, { startedAt: now, count: 1 });
  } else if (previous.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  } else {
    previous.count += 1;
  }

  // Bound memory use and discard expired addresses while this process is active.
  if (intakeAttempts.size > 5_000) {
    for (const [attemptKey, attempt] of intakeAttempts) {
      if (now - attempt.startedAt >= RATE_LIMIT_WINDOW_MS) intakeAttempts.delete(attemptKey);
    }
    if (intakeAttempts.size > 10_000) intakeAttempts.clear();
  }
  return true;
}

function json(request: NextRequest, body: unknown, status = 200) {
  const origin = request.headers.get("origin") ?? "";
  const headers = new Headers({ Vary: "Origin", "Cache-Control": "no-store" });
  if (ALLOWED_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "content-type");
  }
  return NextResponse.json(body, { status, headers });
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("Supabase server environment variables are not configured.");

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin") ?? "";
  if (!ALLOWED_ORIGINS.has(origin)) return json(request, { success: false }, 403);
  return json(request, { success: true });
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const origin = request.headers.get("origin") ?? "";
  if (!ALLOWED_ORIGINS.has(origin)) return json(request, { success: false, error: "Origin is not allowed." }, 403);
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(request, { success: false, error: "Lead intake is temporarily unavailable." }, 503);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) return json(request, { success: false, error: "Request is too large." }, 413);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return json(request, { success: false, error: "JSON request body required." }, 415);
  }

  let payload: IntakePayload;
  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
      return json(request, { success: false, error: "Request is too large." }, 413);
    }
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json(request, { success: false, error: "Invalid request." }, 400);
    }
    payload = parsed as IntakePayload;
  } catch {
    return json(request, { success: false, error: "Invalid request." }, 400);
  }

  // Quietly accept honeypot submissions without creating leads.
  if (text(payload.website_url, 200)) return json(request, { success: true });
  if (!consumeRateLimit(getClientAddress(request))) {
    return json(request, { success: false, error: "Too many submissions. Try again later." }, 429);
  }

  const name = text(payload.name, 160);
  const phone = text(payload.phone, 32);
  const digits = phone.replace(/\D/g, "");
  if (name.length < 2 || digits.length < 10 || digits.length > 15) {
    return json(request, { success: false, error: "Enter a valid name and phone number." }, 400);
  }

  const city = text(payload.city, 120) || "-";
  const treatment = text(payload.treatment, 160) || "-";
  const message = text(payload.message, 2_000);
  const tracking = [
    ["source", text(payload.utmSource, 120)],
    ["medium", text(payload.utmMedium, 120)],
    ["campaign", text(payload.utmCampaign, 160)],
    ["content", text(payload.utmContent, 160)],
    ["term", text(payload.utmTerm, 160)],
  ] as const;
  const trackingNote = tracking.filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`).join(" · ");
  const landingPage = text(payload.landingPage, 240);
  const remarks = [message, trackingNote, landingPage ? `Page: ${landingPage}` : ""].filter(Boolean).join("\n");
  const sourceLabel = `Added from Site${city !== "-" ? ` — ${city}` : ""}${treatment !== "-" ? ` · ${treatment}` : ""}`.slice(0, 240);

  try {
    const supabase = getSupabaseAdmin();
    const { data: lead, error } = await supabase
      .from("leads")
      .insert({
        name,
        phone,
        email: "-",
        gender: "-",
        city,
        disease: treatment,
        insurance_status: "-",
        remarks,
        lead_date: new Date().toISOString().slice(0, 10),
        follow_up_date: "-",
        source: "Added from Site",
        source_batch_id: requestId,
        source_batch_label: sourceLabel,
        source_batch_created_at: new Date().toISOString(),
        status: "New",
        assigned_to: "-",
      })
      .select("id")
      .single();

    if (error?.code === "23505" && /phone already exists/i.test(error.message)) {
      const phoneIdentity = digits.slice(-10);
      const { error: reviewError } = await supabase.rpc("crm_capture_duplicate_review_candidates", {
        p_candidates: [{ phone_identity: phoneIdentity, name }],
        p_source: "Added from Site",
      });
      if (reviewError) {
        console.error("[Website Lead Intake] Duplicate review could not be queued", {
          requestId,
          error: reviewError.message,
        });
        return json(request, { success: false, error: "Unable to save your request." }, 503);
      }
      return json(request, { success: true, duplicate: true });
    }
    if (error || !lead) {
      console.error("[Website Lead Intake] Lead insert failed", { requestId, error: error?.message ?? "No lead returned." });
      return json(request, { success: false, error: "Unable to save your request." }, 503);
    }

    return json(request, { success: true, duplicate: false });
  } catch (error) {
    console.error("[Website Lead Intake] Unexpected error", {
      requestId,
      error: error instanceof Error ? error.message : error,
    });
    return json(request, { success: false, error: "Unable to save your request." }, 500);
  }
}
