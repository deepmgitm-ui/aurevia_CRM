/** Masks phone numbers in list previews; the full value remains in lead details. */
export function maskPhoneForList(value: string | null | undefined): string {
  const phone = String(value ?? "").trim();
  if (!phone || phone === "-") return "-";

  const allDigits = phone.replace(/\D/g, "");
  const digits = allDigits.length > 10 ? allDigits.slice(-10) : allDigits;
  if (!digits) return "-";
  if (digits.length <= 3) return digits;
  return `${"*".repeat(digits.length - 3)}${digits.slice(-3)}`;
}
