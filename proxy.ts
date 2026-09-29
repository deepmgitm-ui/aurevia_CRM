import { updateSession } from "@/lib/supabase/middleware";
import type { NextRequest } from "next/server";

/**
 * Next.js 16 renamed the `middleware` file convention to `proxy` (the exported
 * function must be named `proxy`). Everything else behaves the same: this runs
 * before a request is rendered, which is where the Supabase session cookie gets
 * refreshed and unauthenticated `/dashboard` traffic is sent to `/login`.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
