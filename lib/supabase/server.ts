import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { requireSupabaseEnv } from "./env";

export async function createClient() {
  const cookieStore = await cookies();
  const { url, key } = requireSupabaseEnv();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies. Middleware refreshes the
          // session cookie instead (see lib/supabase/middleware.ts).
        }
      },
    },
  });
}

export type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type SafeUser = {
  user: User | null;
  error: Error | null;
};

/**
 * Reads the signed-in user without ever throwing.
 *
 * `supabase.auth.getUser()` can reject (`AuthApiError: Invalid Refresh Token`
 * when the cookie holds a session the Auth server refuses to refresh) and
 * Server Components cannot clear cookies. Returning `user: null` in that case
 * lets the caller redirect to /login instead of crashing the render, which is
 * what showed up in the browser as a 404/error page.
 */
export async function getUserSafely(
  client?: SupabaseServerClient,
): Promise<SafeUser> {
  try {
    const supabase = client ?? (await createClient());
    const { data, error } = await supabase.auth.getUser();

    if (error) {
      return { user: null, error };
    }

    return { user: data.user ?? null, error: null };
  } catch (error) {
    console.error("[supabase] Could not read the current user:", error);

    return {
      user: null,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

