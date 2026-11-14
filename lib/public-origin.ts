import type { NextRequest } from "next/server";

/**
 * Render can expose the app internally as localhost:<port>. Prefer the
 * configured public Meta callback origin, then trusted proxy headers, before
 * falling back to Next's request URL when building browser redirects.
 */
export function publicUrl(request: NextRequest, pathname: string): URL {
  const callbackUrl = process.env.META_REDIRECT_URI?.trim();
  if (callbackUrl) {
    try {
      return new URL(pathname, new URL(callbackUrl).origin);
    } catch {
      // Continue to the forwarded host if the optional setting is malformed.
    }
  }

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host")?.split(",")[0]?.trim();
  if (host) {
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const protocol = forwardedProto || request.nextUrl.protocol.replace(/:$/, "");
    try {
      return new URL(pathname, `${protocol}://${host}`);
    } catch {
      // Fall back to Next's parsed request URL below.
    }
  }

  return new URL(pathname, request.nextUrl.origin);
}
