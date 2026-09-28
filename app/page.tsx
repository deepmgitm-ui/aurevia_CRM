import { redirect } from "next/navigation";

import { getUserSafely } from "@/lib/supabase/server";

export default async function Home() {
  // getUserSafely() never throws: a stale/expired refresh token resolves to
  // `user: null` and the visitor is sent to the login page instead of hitting
  // an error page.
  const { user } = await getUserSafely();

  redirect(user ? "/dashboard" : "/login");
}


