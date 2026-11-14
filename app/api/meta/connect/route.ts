import { NextRequest, NextResponse } from "next/server";

import { getViewer } from "@/app/actions/leads";
import { createOAuthState, metaOAuthConfiguration } from "@/lib/meta-integration";
import { publicUrl } from "@/lib/public-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const config = metaOAuthConfiguration();
  const viewer = await getViewer();
  if (!viewer.success || !viewer.data) return NextResponse.redirect(publicUrl(request, "/login"));
  if (viewer.data.role !== "admin" && viewer.data.role !== "manager") return NextResponse.redirect(publicUrl(request, "/dashboard/marketing?meta=admin-only"));

  if (!config.appId || !config.appSecret || !config.redirectUri || !config.encryptionKey || !config.verifyToken) {
    return NextResponse.redirect(publicUrl(request, "/dashboard/marketing?meta=setup"));
  }

  const state = createOAuthState();
  const authUrl = new URL(`https://www.facebook.com/v${(process.env.META_GRAPH_API_VERSION?.trim() || "26.0").replace(/^v?/i, "")}/dialog/oauth`);
  authUrl.searchParams.set("client_id", config.appId);
  authUrl.searchParams.set("redirect_uri", config.redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", "ads_read,ads_management,leads_retrieval,pages_show_list,pages_read_engagement,pages_manage_metadata");

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
