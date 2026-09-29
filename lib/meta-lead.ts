/**
 * Aurevia CRM — Meta (Facebook / Instagram) lead-form parsing.
 *
 * Deliberately PURE and framework-free (no `next/*`, no `node:crypto`) so
 * `scripts/verify-meta.mts` can test every mapping without bootstrapping a server.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Meta lead forms do NOT use fixed field names. "Which treatment are you
 * interested in?" arrives as `which_treatment_are_you_interested_in`, an
 * "Eye problem?" question arrives as `eye_problem`, and a custom question can be
 * named anything at all. Matching only the handful of documented names is the
 * exact reason treatment-wise reporting showed blanks — so every lookup here
 * normalises the label first (lowercase, non-alphanumerics → `_`) and then
 * matches KEYWORDS instead of one exact string.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Meta sends `field_name` in webhook payloads but `name` in Graph API responses. */
export type MetaField = {
  field_name?: string;
  name?: string;
  values?: JsonValue[];
};

export interface MetaLeadFields {
  name: string;
  phone: string;
  email: string;
  leadDate: string;
  gender: string;
  city: string;
  disease: string;
  insuranceStatus: string;
  remarks: string;
}

/** Exact label aliases (already normalised) per column. */
export const META_FIELD_ALIASES = {
  name: ["full_name", "name", "first_name", "patient_name", "your_name", "username"],
  phone: [
    "phone_number",
    "phone",
    "mobile",
    "mobile_number",
    "contact_number",
    "contact_no",
    "contact",
    "whatsapp_number",
    "whatsapp",
  ],
  email: ["email_address", "email", "email_id", "e_mail"],
  gender: ["gender", "sex"],
  city: ["city", "town", "location", "area", "city_name", "place"],
  disease: [
    "disease",
    "treatment",
    "treatment_type",
    "treatment_required",
    "service",
    "service_interested_in",
    "procedure",
    "surgery",
    "condition",
    "eye_problem",
    "eye_issue",
    "problem",
    "health_concern",
    "interested_in",
    "requirement",
  ],
  insuranceStatus: ["insurance_status", "insurance", "insurance_provider", "mediclaim", "insurance_company"],
  remarks: [
    "remarks",
    "remark",
    "remark_1",
    "message",
    "messages",
    "notes",
    "note",
    "comment",
    "comments",
    "query",
    "additional_information",
    "anything_else",
  ],
} as const;

/** Fuzzy keyword fallbacks, used when no exact alias matched. */
const META_FIELD_KEYWORDS = {
  phone: ["phone", "mobile", "contact", "whatsapp"],
  email: ["email", "mail"],
  name: ["name"],
  city: ["city", "location", "town", "area"],
  disease: [
    "treatment",
    "disease",
    "problem",
    "condition",
    "surgery",
    "procedure",
    "service",
    "interest",
    "eye",
    "vision",
  ],
} as const;

export function dashIfEmpty(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "-";
}

export function metaString(value: JsonValue | undefined): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

/** "Which treatment are you interested in?" → "which_treatment_are_you_interested_in". */
export function normalizeMetaLabel(label: string): string {
  return (label ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function metaFieldLabel(field: MetaField): string {
  const raw =
    typeof field.field_name === "string"
      ? field.field_name
      : typeof field.name === "string"
        ? field.name
        : "";
  return normalizeMetaLabel(raw);
}

/** First value of the first field whose normalised label is in `labels`. */
export function metaFieldValue(fields: MetaField[], labels: readonly string[]): string | null {
  const wanted = new Set(labels.map((label) => normalizeMetaLabel(label)));
  const field = fields.find((candidate) => wanted.has(metaFieldLabel(candidate)));
  return metaString(field?.values?.[0]);
}

/** First value of the first field whose label CONTAINS any keyword. */
export function metaFieldMatching(fields: MetaField[], keywords: readonly string[]): string | null {
  const field = fields.find((candidate) => {
    const label = metaFieldLabel(candidate);
    return keywords.some((keyword) => label.includes(normalizeMetaLabel(keyword)));
  });
  return metaString(field?.values?.[0]);
}

/** Last 10 digits — how Indian numbers are stored everywhere else in the CRM. */
export function sanitizeMetaPhone(value: unknown): string {
  const digits = dashIfEmpty(value).replace(/\D/g, "");
  if (!digits) return "-";
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

const TREATMENT_HINTS: { pattern: RegExp; label: string }[] = [
  { pattern: /lasik|lasic|lasek|contoura|blade.?free|smile/i, label: "LASIK" },
  { pattern: /cataract|catract|motiyabind|motia|phaco|\biol\b|lens/i, label: "Cataract" },
  { pattern: /\bicl\b|phakic|implantable/i, label: "ICL" },
  { pattern: /retina|diabet|macula|vitreous/i, label: "Retina" },
  { pattern: /keratoconus|cross.?link/i, label: "Keratoconus" },
  { pattern: /squint|strabismus/i, label: "Squint" },
  { pattern: /glaucoma/i, label: "Glaucoma" },
  { pattern: /pterygium/i, label: "Pterygium" },
  { pattern: /\bdcr\b|dacryo|watering/i, label: "DCR" },
  { pattern: /spectacle|glasses|specs|power/i, label: "Spectacles" },
];

/**
 * Last-resort treatment detection inside a free-text answer — for a form whose
 * treatment question was named something we could not guess but whose answer
 * says "I want lasik". Returns "-" when nothing recognisable is in there.
 */
export function detectTreatmentInText(text: string): string {
  for (const { pattern, label } of TREATMENT_HINTS) {
    if (pattern.test(text)) return label;
  }
  return "-";
}

/**
 * Answers "konsa lead kis treatment ka hai" for Meta traffic: tries the
 * documented names, then any custom question that smells like a treatment
 * ("eye_problem", "which_treatment…"), and finally scans the free-text answers
 * for a treatment keyword so even an oddly named form lands in the right bucket.
 */
export function extractMetaLead(fields: MetaField[]): MetaLeadFields {
  const name =
    metaFieldValue(fields, META_FIELD_ALIASES.name) ?? metaFieldMatching(fields, META_FIELD_KEYWORDS.name) ?? "";
  const phone =
    metaFieldValue(fields, META_FIELD_ALIASES.phone) ?? metaFieldMatching(fields, META_FIELD_KEYWORDS.phone);
  const email =
    metaFieldValue(fields, META_FIELD_ALIASES.email) ?? metaFieldMatching(fields, META_FIELD_KEYWORDS.email);
  const gender = metaFieldValue(fields, META_FIELD_ALIASES.gender);
  const city =
    metaFieldValue(fields, META_FIELD_ALIASES.city) ?? metaFieldMatching(fields, META_FIELD_KEYWORDS.city);
  const disease =
    metaFieldValue(fields, META_FIELD_ALIASES.disease) ?? metaFieldMatching(fields, META_FIELD_KEYWORDS.disease);
  const insuranceStatus = metaFieldValue(fields, META_FIELD_ALIASES.insuranceStatus);
  const remarkField = metaFieldValue(fields, META_FIELD_ALIASES.remarks);

  // Anything the form asked that we have no column for is worth keeping — it is
  // usually "preferred time", "how did you hear about us", etc.
  const knownLabels = new Set<string>(
    Object.values(META_FIELD_ALIASES).flatMap((labels) => [...labels]),
  );
  const extras = fields
    .filter((field) => {
      const label = metaFieldLabel(field);
      if (!label || knownLabels.has(label)) return false;
      return Boolean(metaString(field?.values?.[0]));
    })
    .map((field) => {
      const label = metaFieldLabel(field).replace(/_/g, " ");
      return `${label}: ${metaString(field?.values?.[0]) ?? ""}`;
    });

  const remarks = [remarkField ?? "", ...extras].filter(Boolean).join(" | ");
  const resolvedDisease = dashIfEmpty(disease);

  return {
    name: dashIfEmpty(name),
    phone: sanitizeMetaPhone(phone),
    email: dashIfEmpty(email),
    leadDate: new Date().toLocaleDateString("en-GB"),
    gender: dashIfEmpty(gender),
    city: dashIfEmpty(city),
    // Nothing usable in the treatment question? Try the free-text answers before
    // giving up, so the pipeline chart does not grow another "Not Recorded" bar.
    disease: resolvedDisease === "-" && remarks ? detectTreatmentInText(remarks) : resolvedDisease,
    insuranceStatus: dashIfEmpty(insuranceStatus),
    remarks: dashIfEmpty(remarks),
  };
}

