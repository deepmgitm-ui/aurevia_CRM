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
  name: [
    "full_name",
    "patient_full_name",
    "customer_name",
    "patient_name",
    "contact_name",
    "your_name",
    "name",
    "username",
  ],
  phone: [
    "original_mobile_number",
    "primary_phone_number",
    "alternate_phone_number",
    "telephone_number",
    "phone_number",
    "phone",
    "mobile",
    "mobile_number",
    "mobile_no",
    "phone_no",
    "contact_number",
    "contact_no",
    "contact",
    "whatsapp_number",
    "whatsapp_phone",
    "whatsapp_mobile",
    "whatsapp",
    "tel",
  ],
  email: ["email_address", "email", "email_id", "e_mail", "mail"],
  gender: ["gender", "sex"],
  city: [
    "city",
    "town",
    "location",
    "area",
    "city_name",
    "current_city",
    "district",
    "residence",
    "place",
  ],
  disease: [
    "disease",
    "treatment",
    "treatment_type",
    "treatment_required",
    "treatment_interested_in",
    "interested_treatment",
    "service",
    "service_interested_in",
    "procedure",
    "procedure_interested_in",
    "surgery",
    "condition",
    "eye_problem",
    "eye_issue",
    "eye_condition",
    "problem",
    "health_concern",
    "interested_in",
    "requirement",
    "query",
    "department",
  ],
  insuranceStatus: [
    "insurance_status",
    "insurance",
    "insurance_provider",
    "mediclaim",
    "medical_insurance",
    "insurance_company",
  ],
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
    "additional_comments",
    "other_details",
    "other_information",
    "description",
    "preferred_call_time",
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
  const field = fields.find(
    (candidate) =>
      wanted.has(metaFieldLabel(candidate)) &&
      Boolean(candidate.values?.some((value) => metaString(value)?.trim())),
  );
  return metaFieldValues(field);
}

/** First value of the first field whose label CONTAINS any keyword. */
export function metaFieldMatching(fields: MetaField[], keywords: readonly string[]): string | null {
  const field = fields.find((candidate) => {
    const label = metaFieldLabel(candidate);
    if (!candidate.values?.some((value) => metaString(value)?.trim())) return false;
    if (keywords.includes("name") && /\b(campaign|ad|form|page|account)_/.test(label)) return false;
    return keywords.some((keyword) => label.includes(normalizeMetaLabel(keyword)));
  });
  return metaFieldValues(field);
}

function metaFieldValues(field: MetaField | undefined): string | null {
  if (!field?.values) return null;
  const values = field.values
    .map((value) => metaString(value))
    .filter((value): value is string => Boolean(value?.trim()));
  return values.length ? values.join(", ") : null;
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
 * Answers "which lead wants which treatment" for Meta traffic: tries the
 * documented names, then any custom question that smells like a treatment
 * ("eye_problem", "which_treatment…"), and finally scans the free-text answers
 * for a treatment keyword so even an oddly named form lands in the right bucket.
 */
export function extractMetaLead(fields: MetaField[]): MetaLeadFields {
  const firstName = metaFieldValue(fields, ["first_name", "given_name", "firstname"]);
  const lastName = metaFieldValue(fields, ["last_name", "family_name", "surname", "lastname"]);
  const combinedName = [firstName, lastName].filter(Boolean).join(" ");
  const name =
    metaFieldValue(fields, META_FIELD_ALIASES.name) ??
    combinedName ??
    metaFieldMatching(fields, META_FIELD_KEYWORDS.name) ??
    "";
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
  // Anything the form asked that we have no column for is worth keeping — it is
  // usually a remark or custom question such as "preferred time".
  const knownLabels = new Set<string>(
    Object.entries(META_FIELD_ALIASES)
      .filter(([column]) => column !== "remarks")
      .flatMap(([, labels]) => [...labels]),
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

  const remarks = extras.join(" | ");
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
