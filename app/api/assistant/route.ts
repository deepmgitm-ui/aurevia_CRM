import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MESSAGE_LENGTH = 1000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_REQUESTS = 30;

type UserRole = "admin" | "manager" | "employee";

interface RateLimitEntry {
  startedAt: number;
  count: number;
}

const rateLimits = new Map<string, RateLimitEntry>();

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function getHelpReply(message: string, role: UserRole): string {
  const normalized = message.toLocaleLowerCase();
  const asksWhere = /\b(where|kaha|kahan|kha|kidhar|milegi|milengi|milta|milti|find|open)\b/.test(normalized);

  if (/\b(lead assignment|assign leads?|unassigned|assigned leads?|agent count|lead count|team leads?)\b|kis agent|kitne leads/.test(normalized)) {
    return role === "employee"
      ? "Apni leads Dashboard ya Leads page par dekh sakte ho. Team ke doosre agents ke lead counts employee role mein nahi dikhte."
      : "Dashboard par “Lead assignments” section mein Unassigned aur Assigned tabs hain. “Assigned” kholo—har agent ka total lead count uske card par dikhega. Kisi card ko tap karke us agent ki leads dekh sakte ho.";
  }

  if (/\b(lead|leads|lead page|new lead|import|excel|csv|source deletion|bulk assign)\b/.test(normalized)) {
    return asksWhere
      ? "Leads left-side menu mein “Leads” par milenge. Mobile par ☰ menu kholo, phir “Leads” tap karo. Nayi lead, Excel/CSV import, filters, source batches aur assignment ke options isi page par hain."
      : "Leads page par lead list, search/filters, nayi lead add karna, Excel/CSV import, assignment aur source-batch deletion ke options milte hain. Left menu se “Leads” kholo; mobile par pehle ☰ tap karo.";
  }

  if (/\b(attendance|hazri|absent|check.?in|attendance request)\b/.test(normalized)) {
    return "Attendance left-side menu se kholo. Employee apni attendance aur request dekh sakta hai; admin/manager team attendance aur requests review kar sakte hain.";
  }

  if (/\b(pipeline|board|kanban)\b/.test(normalized)) {
    return "Pipeline Board left-side menu mein “Pipeline Board” par hai. Yahan lead stages dekh sakte ho.";
  }

  if (/\b(appointment|appointments|calendar|calender|event|events)\b/.test(normalized)) {
    return "Appointments/Calendar dashboard ke upar “Appointments” tab mein milta hai. Consultation aur surgery records ke liye left menu se “Consultations” ya “Surgeries” kholo.";
  }

  if (/\b(consultation|consultations)\b/.test(normalized)) {
    return "Consultations left-side menu ya dashboard ke upar “Consultations” tab mein milengi.";
  }

  if (/\b(surger(y|ies)|operation)\b/.test(normalized)) {
    return "Surgeries left-side menu ya dashboard ke upar “Surgeries” tab mein milengi.";
  }

  if (/\b(patient|patients)\b/.test(normalized)) {
    return "Patients left-side menu mein “Patients” par milenge.";
  }

  if (/\b(agent|agents|employee|employees|team member|profile|profiles)\b/.test(normalized)) {
    return role === "employee"
      ? "Apna profile upar apne naam/photo par tap karke edit kar sakte ho. Admin/manager team profiles ke liye left menu mein “Agents” kholo."
      : "Team members aur profiles left-side menu mein “Agents” par milenge. Apna profile upar apne naam/photo par tap karke edit kar sakte ho.";
  }

  if (/\b(marketing|meta|ads|facebook)\b/.test(normalized)) {
    return "Marketing aur Meta lead connection ke options left-side menu mein “Marketing” par milenge.";
  }

  if (/\b(report|reports|analysis|analytics|source|city)\b/.test(normalized)) {
    return "Reports left-side menu mein “Reports” par hain. Lead Analysis, Source Analysis, Agents Performance aur City Analysis dashboard ke upar tabs mein milte hain.";
  }

  if (/\b(task|tasks|follow.?up)\b/.test(normalized)) {
    return "Tasks ke liye dashboard ke upar “Tasks” button kholo. Lead ke follow-up aur details Leads page par milte hain.";
  }

  if (/\b(setting|settings|automation|master data)\b/.test(normalized)) {
    return "Settings left-side menu mein “Settings” par hain. Admin settings mein automation aur master data ke options bhi milte hain.";
  }

  if (/\b(dashboard|overview|home)\b/.test(normalized) || asksWhere) {
    return "CRM ke main features:\n• Leads — left menu > Leads\n• Pipeline Board — left menu > Pipeline Board\n• Attendance — left menu > Attendance\n• Tasks — dashboard ke upar Tasks button\n• Appointments, Lead Analysis, Source/City Analysis — dashboard ke upar tabs\n• Agents, Marketing, Reports, Settings — left menu";
  }

  return "Main CRM ke features dhoondhne mein help kar sakta hoon. Jaise “leads kahan hain?”, “attendance kahan milegi?”, “agent-wise lead count kahan hai?” ya “appointments kaise kholun?” poochho.";
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError("Please send a valid message.", 400);
  }

  const message =
    payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
      ? payload.message.trim()
      : "";
  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    return jsonError(`Message must be between 1 and ${MAX_MESSAGE_LENGTH} characters.`, 400);
  }

  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return jsonError("Please sign in to use CRM help.", 401);

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profileError || !profile) return jsonError("Your CRM profile could not be verified.", 403);
    if (profile.role !== "admin" && profile.role !== "manager" && profile.role !== "employee") {
      return jsonError("Your account does not have permission to use CRM help.", 403);
    }
    const role = profile.role;

    const now = Date.now();
    const limit = rateLimits.get(user.id);
    if (!limit || now - limit.startedAt >= RATE_LIMIT_WINDOW_MS) {
      rateLimits.set(user.id, { startedAt: now, count: 1 });
    } else if (limit.count >= RATE_LIMIT_REQUESTS) {
      return jsonError("Please wait a minute before sending more messages.", 429);
    } else {
      limit.count += 1;
    }

    return NextResponse.json({ answer: getHelpReply(message, role) });
  } catch (error) {
    console.error("[assistant] CRM help request failed:", error instanceof Error ? error.message : "Unknown error");
    return jsonError("CRM help could not load. Please try again shortly.", 500);
  }
}
