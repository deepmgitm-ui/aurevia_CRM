"use client";

import { useEffect } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Error boundary for the /dashboard subtree.
 *
 * Without it, anything thrown while rendering the dashboard (for example a
 * Supabase auth/`Invalid Refresh Token` failure) replaced the page with the
 * framework error screen. Here the user gets a retry plus a clean way back to
 * the login page.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard] Unhandled error:", error);
  }, [error]);

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-muted/30 px-4 py-12">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="gap-2 text-center">
          <CardTitle className="text-2xl">Something went wrong</CardTitle>
          <CardDescription>
            We couldn&apos;t load this part of the dashboard. Your session may
            have expired.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button type="button" className="h-10 w-full" onClick={reset}>
            Try again
          </Button>
          <a
            href="/login"
            className={cn(buttonVariants({ variant: "outline" }), "h-10 w-full")}
          >
            Back to sign in
          </a>
        </CardContent>
      </Card>
    </main>
  );
}
