import { sanitizeRedirectPath } from "@/lib/safe-redirect";

import { LoginForm } from "./login-form";

/**
 * Server entry point for /login.
 *
 * Reading `redirectTo` here (instead of with `useSearchParams` on the client)
 * keeps the value validated on the server and lets the client form only ever
 * receive a safe same-origin path.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string | string[]; reason?: string | string[] }>;
}) {
  const { redirectTo, reason } = await searchParams;
  const dayEnded = (Array.isArray(reason) ? reason[0] : reason) === "day_ended";

  return <LoginForm redirectTo={sanitizeRedirectPath(redirectTo)} dayEnded={dayEnded} />;
}
