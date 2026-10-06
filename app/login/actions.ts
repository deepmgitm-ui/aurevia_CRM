"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { clinicDate, SESSION_DAY_COOKIE } from "@/lib/attendance";
import { sanitizeRedirectPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

export type LoginState = {
  error?: string;
} | null;

const DEFAULT_REDIRECT = "/dashboard";
const AUTH_ROUTES = ["/login", "/signup"];

function resolveRedirectTarget(value: FormDataEntryValue | null): string {
  const requested = sanitizeRedirectPath(value);

  if (!requested) {
    return DEFAULT_REDIRECT;
  }

  // Never bounce back to an auth screen (that is how redirect loops start).
  const [pathname] = requested.split(/[?#]/);

  return AUTH_ROUTES.includes(pathname) ? DEFAULT_REDIRECT : requested;
}

export async function login(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = formData.get("email");
  const password = formData.get("password");

  if (typeof email !== "string" || typeof password !== "string") {
    return { error: "Email and password are required." };
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) {
    return { error: "Email and password are required." };
  }

  const redirectTo = resolveRedirectTarget(formData.get("redirectTo"));

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (error) {
      if (error.code === "invalid_credentials") {
        return { error: "Email or password is incorrect. Please check and try again." };
      }

      if (error.code === "email_not_confirmed") {
        return { error: "Please confirm your email address before signing in." };
      }

      if (error.status === 429) {
        return { error: "Too many sign-in attempts. Please wait a moment and try again." };
      }

      console.error("[auth] Sign in was rejected:", error.message, error.code);
      return {
        error:
          "The authentication service could not sign you in. Please try again, and contact an admin if this continues.",
      };
    }

    // Stamp the clinic day this session opened on. A Server Action CAN write
    // cookies (unlike a Server Component), so the proxy has something to compare
    // against on every later request and can end the session at midnight.
    const cookieStore = await cookies();
    cookieStore.set(SESSION_DAY_COOKIE, clinicDate(), {
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
    });
  } catch (error) {
    // Missing environment variables or an unreachable auth server: report it
    // instead of letting the action reject with an unhandled error.
    console.error("[auth] Sign in failed:", error);

    return {
      error:
        "Could not reach the authentication service. Check your Supabase configuration and try again.",
    };
  }

  redirect(redirectTo);
}

export async function logout(): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch (error) {
    // An invalid/expired refresh token must not block signing out. The
    // middleware (and the login page) expire the stale cookies on the next
    // request, so the user always ends up signed out.
    console.error("[auth] Sign out failed, clearing the session anyway:", error);
  }

  redirect("/login");
}
