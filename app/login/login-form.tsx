"use client";

import { useActionState, useEffect } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";

import { login, type LoginState } from "./actions";

interface LoginFormProps {
  /**
   * Protected page the visitor came from (validated as a same-origin path by
   * the server component). Carried through the form so a successful sign-in
   * lands back where the expired session interrupted them.
   */
  redirectTo: string | null;
}

export function LoginForm({ redirectTo }: LoginFormProps) {
  const [state, formAction, isPending] = useActionState<LoginState, FormData>(
    login,
    null,
  );

  useEffect(() => {
    if (state?.error) {
      toast.add({
        title: "Unable to sign in",
        description: state.error,
        type: "error",
      });
    }
  }, [state]);

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-muted/30 px-4 py-12">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="gap-2 text-center">
          <CardTitle className="text-2xl">Welcome back</CardTitle>
          <CardDescription>Sign in to continue to Aurevia CRM.</CardDescription>
        </CardHeader>
        <CardContent>
          {redirectTo ? (
            <p className="mb-5 rounded-lg bg-muted px-3 py-2 text-center text-sm text-slate-600">
              Your session expired. Sign in again to continue where you left
              off.
            </p>
          ) : null}
          <form action={formAction} className="space-y-5">
            {redirectTo ? (
              <input type="hidden" name="redirectTo" value={redirectTo} />
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="Enter your password"
                autoComplete="current-password"
                required
              />
            </div>
            <Button type="submit" className="h-10 w-full" disabled={isPending}>
              {isPending ? "Signing in..." : "Sign in"}
            </Button>
          </form>
          <p className="mt-5 text-center text-sm text-slate-500">
            Don&apos;t have an account?{" "}
            <a href="/signup" className="font-medium text-slate-900 hover:underline">
              Sign up
            </a>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
