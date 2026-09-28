/**
 * Single source of truth for the Supabase environment variables.
 *
 * `NEXT_PUBLIC_*` variables are inlined at build time, so they must always be
 * referenced statically (never with a dynamic lookup such as `process.env[name]`).
 */
export interface SupabaseEnv {
  url: string;
  key: string;
}

// Evaluated once per bundle. Missing values surface through getSupabaseEnv().
const RAW_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const RAW_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const MISSING_SUPABASE_ENV_MESSAGE =
  'Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to ".env.local" and restart the dev server.';

/**
 * Returns the trimmed Supabase URL/key, or `null` when they are not set.
 *
 * Trimming matters locally: a copied value with a trailing space or newline
 * makes `createServerClient` reject the URL and every auth call fail.
 */
export function getSupabaseEnv(): SupabaseEnv | null {
  const url = RAW_URL?.trim().replace(/\/+$/, "");
  const key = RAW_KEY?.trim();

  if (!url || !key) {
    return null;
  }

  return { url, key };
}

/** Same as `getSupabaseEnv`, but throws a message that explains how to fix it. */
export function requireSupabaseEnv(): SupabaseEnv {
  const env = getSupabaseEnv();

  if (!env) {
    throw new Error(MISSING_SUPABASE_ENV_MESSAGE);
  }

  return env;
}
