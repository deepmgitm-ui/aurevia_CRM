import { NextRequest, NextResponse } from "next/server";

import { getViewer } from "@/app/actions/leads";
import { createOAuthState, metaOAuthConfiguration } from "@/lib/meta-integration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer.success || !viewer.data) return NextResponse.redirect(new URL("/login", request.url));
  if (viewer.data.role !== "admin") return NextResponse.redirect(new URL("/dashboard/marketing?meta=admin-only", request.url));

  const config = metaOAuthConfiguration();
  if (!config.appId || !config.appSecret || !config.redirectUri || !config.encryptionKey || !config.verifyToken) {
    return NextResponse.redirect(new URL("/dashboard/marketing?meta=setup", request.url));
  }

  const state = createOAuthState();
  const authUrl = new URL(`https://www.facebook.com/v${(process.env.META_GRAPH_API_VERSION?.trim() || "26.0").replace(/^v?/i, "")}/dialog/oauth`);
  authUrl.searchParams.set("client_id", config.appId);
  authUrl.searchParams.set("redirect_uri", config.redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", "ads_read,leads_retrieval,pages_show_list,pages_read_engagement,pages_manage_ads,pages_manage_metadata");

  const response = NextResponse.redirect(authUrl);
  response.cookies.set("aurevia_meta_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/meta/callback",
    maxAge: 600,
  });
  return response;
}
