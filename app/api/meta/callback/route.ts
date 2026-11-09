import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { getViewer } from "@/app/actions/leads";
import {
  exchangeMetaCode,
  fetchMetaPages,
  metaOAuthConfiguration,
  registerMetaWebhook,
  saveMetaCredentials,
  subscribeMetaPage,
} from "@/lib/meta-integration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function backToMarketing(request: NextRequest, status: string, detail?: string) {
  const url = new URL("/dashboard/marketing", request.url);
  url.searchParams.set("meta", status);
  if (detail) url.searchParams.set("detail", detail.slice(0, 220));
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("aurevia_meta_oauth_state")?.value;
  const returnedState = request.nextUrl.searchParams.get("state");
  const responseError = request.nextUrl.searchParams.get("error_description");
  const code = request.nextUrl.searchParams.get("code");
  const config = metaOAuthConfiguration();

  const response = (status: string, detail?: string) => {
    const result = backToMarketing(request, status, detail);
    result.cookies.set("aurevia_meta_oauth_state", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/meta/callback",
      maxAge: 0,
    });
    return result;
  };

  if (!viewer.success || !viewer.data) return NextResponse.redirect(new URL("/login", request.url));
  if (viewer.data.role !== "admin") return response("admin-only");
  if (!expectedState || !returnedState || expectedState !== returnedState) return response("state-error", "Meta sign-in expired. Start Connect Meta again.");
  if (responseError) return response("cancelled", responseError);
  if (!code || !config.appId || !config.appSecret || !config.redirectUri || !config.encryptionKey || !config.verifyToken) {
    return response("setup", "Meta app settings are incomplete.");
  }

  try {
    const userAccessToken = await exchangeMetaCode(code, config.redirectUri);
    await registerMetaWebhook(config.redirectUri);
    const pages = await fetchMetaPages(userAccessToken);
    if (pages.length === 0) return response("connect-error", "No Facebook Pages were available to subscribe for lead notifications.");
    for (const page of pages) await subscribeMetaPage(page);
    await saveMetaCredentials({ userAccessToken, pages }, viewer.data.id);
    return response("connected");
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Meta could not complete the connection.";
    return response("connect-error", detail);
  }
}
