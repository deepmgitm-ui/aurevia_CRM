import { createServerClient } from "@supabase/ssr";
import {
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
} from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseEnv, MISSING_SUPABASE_ENV_MESSAGE } from "./env";

const PROTECTED_PATH_PREFIX = "/dashboard";

/**
 * Supabase stores the session in cookies prefixed with `sb-`. When one of them
 * holds an expired session whose refresh token the Auth server rejects, the
 * cookie is poison: every request keeps failing until it is removed. Clearing
 * it on the response the browser actually receives is what breaks the
 * `/dashboard` -> failure -> `/login` -> `/dashboard` loop.
 */
const AUTH_COOKIE_PREFIX = "sb-";

function isAuthCookie(name: string): boolean {
  return name.startsWith(AUTH_COOKIE_PREFIX);
}

function isProtectedPath(pathname: string): boolean {
  return (
    pathname === PROTECTED_PATH_PREFIX ||
    pathname.startsWith(`${PROTECTED_PATH_PREFIX}/`)
  );
}

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

/** Builds a clean `/login` URL, keeping the protected path for post-login. */
function buildLoginUrl(request: NextRequest): URL {
  const url = new URL("/login", request.nextUrl.origin);
  const from = `${request.nextUrl.pathname}${request.nextUrl.search}`;

  if (isProtectedPath(request.nextUrl.pathname)) {
    url.searchParams.set("redirectTo", from);
  }

  return url;
}

/** Expires every Supabase auth cookie carried by the request. */
function clearAuthCookies(
  request: NextRequest,
  response: NextResponse,
): NextResponse {
  for (const { name } of request.cookies.getAll()) {
    if (isAuthCookie(name)) {
      response.cookies.set(name, "", { path: "/", maxAge: 0, sameSite: "lax" });
    }
  }

  return response;
}

/**
 * Copies cookies (refreshed session or expirations) from one response to
 * another. A redirect replaces the response that supabase-js wrote to, so
 * without this the browser keeps replaying the dead session cookie.
 */
function copyResponseCookies(
  from: NextResponse,
  to: NextResponse,
): NextResponse {
  for (const cookie of from.cookies.getAll()) {
    to.cookies.set(cookie);
  }

  return to;
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // The Meta webhook authenticates with its own secrets and must never be
  // answered with an HTML redirect to the login page.
  if (isApiRoute(pathname)) {
    return NextResponse.next({ request });
  }

  try {
    return await refreshSession(request);
  } catch (error) {
    // Last line of defence: whatever goes wrong in here (missing env vars, an
    // unexpected supabase-js failure, ...) must not surface as an unhandled
    // error or a 404 in the browser.
    console.error(
      "[supabase/middleware] Unexpected error while refreshing the session:",
      error,
    );

    if (isProtectedPath(pathname)) {
      return NextResponse.redirect(buildLoginUrl(request));
    }

    return NextResponse.next({ request });
  }
}

async function refreshSession(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request });

  const { pathname } = request.nextUrl;
  const protectedPath = isProtectedPath(pathname);

  const env = getSupabaseEnv();

  if (!env) {
    // `createServerClient` throws when the URL/key are missing, so guard
    // before it. Dashboard traffic is sent to the login page (which renders
    // without Supabase) instead of returning a 500/404.
    console.error(`[supabase/middleware] ${MISSING_SUPABASE_ENV_MESSAGE}`);

    if (protectedPath) {
      return NextResponse.redirect(buildLoginUrl(request));
    }

    return supabaseResponse;
  }

  const supabase = createServerClient(env.url, env.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        supabaseResponse = NextResponse.next({ request });

        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  let hasUser = false;
  // True when the stored session can never be used again (expired refresh
  // token, revoked session, malformed cookie): its cookies must be dropped.
  let sessionIsDead = false;

  try {
    const { data, error } = await supabase.auth.getUser();

    if (error) {
      if (isAuthSessionMissingError(error)) {
        // Normal signed-out visitor — there simply is no session.
        sessionIsDead = true;
      } else if (isAuthRetryableFetchError(error)) {
        // Supabase was unreachable. The session itself may still be valid, so
        // keep the cookies and let the next request retry.
        console.warn(
          "[supabase/middleware] Could not verify the session (network error), keeping cookies:",
          error.message,
        );
      } else {
        // Includes `AuthApiError: Invalid Refresh Token`.
        sessionIsDead = true;
        console.warn(
          "[supabase/middleware] Session cookie was rejected, signing the visitor out:",
          error.message,
        );
      }
    } else {
      hasUser = Boolean(data.user);
    }
  } catch (error) {
    if (isAuthRetryableFetchError(error)) {
      console.warn(
        "[supabase/middleware] Session refresh failed with a network error, keeping cookies:",
        error,
      );
    } else {
      // supabase-js re-throws non-auth errors (for example an
      // `Invalid Refresh Token` failure surfaced by a custom fetch). Treat it
      // exactly like a rejected session instead of failing the request.
      sessionIsDead = true;
      console.warn(
        "[supabase/middleware] Unusable session cookie, signing the visitor out:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  if (hasUser) {
    return supabaseResponse;
  }

  // From here on there is no verified user.

  if (!protectedPath) {
    // Public pages keep rendering (redirecting here is what created
    // `/login` -> `/login` loops). The stale cookies are still dropped so the
    // next request starts clean.
    return sessionIsDead
      ? clearAuthCookies(request, supabaseResponse)
      : supabaseResponse;
  }

  const redirectResponse = NextResponse.redirect(buildLoginUrl(request));

  // Cookies supabase-js just refreshed or expired live on `supabaseResponse`,
  // which this redirect replaces — copy them over, then make sure the cookie
  // that caused the failure is expired on the redirect itself.
  copyResponseCookies(supabaseResponse, redirectResponse);

  return sessionIsDead
    ? clearAuthCookies(request, redirectResponse)
    : redirectResponse;
}
