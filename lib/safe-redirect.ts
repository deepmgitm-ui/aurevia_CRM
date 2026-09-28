/**
 * Turns user controlled input (the `?redirectTo=` query parameter or the
 * matching form field) into a safe same-origin path, or `null` when the value
 * cannot be trusted.
 *
 * Only absolute paths are allowed ("/dashboard/leads"), which rules out open
 * redirects to other origins ("https://evil.example", "//evil.example") and
 * pseudo schemes ("javascript:", "data:").
 */
export function sanitizeRedirectPath(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const target = value.trim();

  if (!target.startsWith("/") || target.startsWith("//")) {
    return null;
  }

  // Backslashes are normalised to "/" by browsers and could smuggle a
  // protocol-relative URL; control characters can break response headers.
  if (target.includes("\\") || /[\u0000-\u001f\u007f]/.test(target)) {
    return null;
  }

  return target;
}
