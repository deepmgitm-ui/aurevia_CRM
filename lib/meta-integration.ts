import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

export type MetaCredentials = {
  userAccessToken: string;
  pages: { id: string; name: string; accessToken: string }[];
};

export type MetaCampaign = { id: string; name: string; status: string | null };

type EncryptedCredentials = {
  credentials_ciphertext: string;
  credentials_iv: string;
  credentials_auth_tag: string;
};

type GraphObject = Record<string, unknown>;
type GraphPage<T> = { data?: T[]; paging?: { next?: string } };

const GRAPH_VERSION = (process.env.META_GRAPH_API_VERSION?.trim() || "v26.0").replace(/^v?/i, "v");

function encryptionKey(): Buffer {
  const value = process.env.META_TOKEN_ENCRYPTION_KEY?.trim();
  if (!value) throw new Error("Meta token encryption key is not configured.");
  const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("Meta token encryption key must be 32 bytes (64 hex characters or base64).");
  return key;
}

export function encryptMetaCredentials(credentials: MetaCredentials) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(credentials), "utf8"),
    cipher.final(),
  ]);
  return {
    credentials_ciphertext: ciphertext.toString("base64"),
    credentials_iv: iv.toString("base64"),
    credentials_auth_tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptMetaCredentials(row: EncryptedCredentials): MetaCredentials {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(row.credentials_iv, "base64"));
  decipher.setAuthTag(Buffer.from(row.credentials_auth_tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(row.credentials_ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  const value = JSON.parse(plaintext) as Partial<MetaCredentials>;
  if (typeof value.userAccessToken !== "string" || !Array.isArray(value.pages)) {
    throw new Error("Saved Meta connection data is invalid.");
  }
  return value as MetaCredentials;
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server environment is not configured.");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function saveMetaCredentials(credentials: MetaCredentials, userId: string) {
  const { error } = await supabaseAdmin()
    .from("crm_meta_connections")
    .upsert({ id: "primary", ...encryptMetaCredentials(credentials), connected_by: userId, connected_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  if (error) throw new Error("Meta connection could not be saved. Apply the CRM database migration and try again.");
}

export async function getMetaCredentials(): Promise<MetaCredentials | null> {
  const { data, error } = await supabaseAdmin()
    .from("crm_meta_connections")
    .select("credentials_ciphertext, credentials_iv, credentials_auth_tag")
    .eq("id", "primary")
    .maybeSingle();
  if (error) throw new Error("Meta connection could not be loaded.");
  return data ? decryptMetaCredentials(data) : null;
}

export async function getMetaWebhookAccessToken(pageId: string | null): Promise<string | null> {
  if (pageId) {
    const credentials = await getMetaCredentials();
    const page = credentials?.pages.find((item) => item.id === pageId);
    if (page) return page.accessToken;
  }
  return process.env.META_ACCESS_TOKEN?.trim() || null;
}

async function graphRequest<T>(pathOrUrl: string, accessToken: string, init?: RequestInit): Promise<T> {
  const url = pathOrUrl.startsWith("https://")
    ? new URL(pathOrUrl)
    : new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${pathOrUrl.replace(/^\//, "")}`);
  const response = await fetch(url, {
    ...init,
    headers: { ...init?.headers, ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const result = await response.json() as T & { error?: { message?: string } };
  if (!response.ok || result.error) {
    throw new Error(result.error?.message || "Meta could not return this information. Check permissions and reconnect.");
  }
  return result;
}

async function graphList<T>(path: string, accessToken: string, fields: string): Promise<T[]> {
  const firstUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path.replace(/^\//, "")}`);
  firstUrl.searchParams.set("fields", fields);
  firstUrl.searchParams.set("limit", "100");
  const rows: T[] = [];
  let next: string | undefined = firstUrl.toString();
  for (let page = 0; next && page < 50; page += 1) {
    const result: GraphPage<T> = await graphRequest<GraphPage<T>>(next, accessToken);
    rows.push(...(result.data ?? []));
    next = result.paging?.next;
  }
  return rows;
}

export async function exchangeMetaCode(code: string, redirectUri: string): Promise<string> {
  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appId || !appSecret) throw new Error("Meta App ID and App Secret are required to connect.");
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code", code);
  const shortLived = await graphRequest<{ access_token?: string }>(url.toString(), "");
  if (!shortLived.access_token) throw new Error("Meta did not return an access token.");

  const longLivedUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
  longLivedUrl.searchParams.set("grant_type", "fb_exchange_token");
  longLivedUrl.searchParams.set("client_id", appId);
  longLivedUrl.searchParams.set("client_secret", appSecret);
  longLivedUrl.searchParams.set("fb_exchange_token", shortLived.access_token);
  const longLived = await graphRequest<{ access_token?: string }>(longLivedUrl.toString(), "");
  if (!longLived.access_token) throw new Error("Meta did not return a long-lived access token.");
  return longLived.access_token;
}

export async function fetchMetaPages(accessToken: string): Promise<MetaCredentials["pages"]> {
  const pages = await graphList<GraphObject>("me/accounts", accessToken, "id,name,access_token");
  return pages.flatMap((page) => {
    const id = typeof page.id === "string" ? page.id : "";
    const name = typeof page.name === "string" ? page.name : "Facebook Page";
    const token = typeof page.access_token === "string" ? page.access_token : "";
    return id && token ? [{ id, name, accessToken: token }] : [];
  });
}

export async function subscribeMetaPage(page: MetaCredentials["pages"][number]) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${page.id}/subscribed_apps`);
  url.searchParams.set("subscribed_fields", "leadgen");
  const result = await graphRequest<{ success?: boolean }>(url.toString(), page.accessToken, { method: "POST" });
  if (result.success !== true) throw new Error(`Meta could not enable lead notifications for ${page.name}.`);
}

export async function registerMetaWebhook(redirectUri: string) {
  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  const verifyToken = process.env.META_VERIFY_TOKEN?.trim();
  if (!appId || !appSecret || !verifyToken) throw new Error("Meta app and webhook settings are incomplete.");
  const callbackUrl = new URL("/api/meta-webhook", new URL(redirectUri).origin).toString();
  const body = new URLSearchParams({
    object: "page",
    callback_url: callbackUrl,
    verify_token: verifyToken,
    fields: "leadgen",
  });
  const result = await graphRequest<{ success?: boolean }>(`${appId}/subscriptions`, `${appId}|${appSecret}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (result.success !== true) throw new Error("Meta did not confirm the lead webhook setup.");
}

export async function fetchConnectedMetaCampaigns(): Promise<{ connected: boolean; campaigns: MetaCampaign[]; error: string | null }> {
  let credentials: MetaCredentials | null;
  try {
    credentials = await getMetaCredentials();
  } catch (error) {
    return { connected: false, campaigns: [], error: error instanceof Error ? error.message : "Meta connection could not be loaded." };
  }
  if (!credentials) return { connected: false, campaigns: [], error: null };

  try {
    const accounts = await graphList<GraphObject>("me/adaccounts", credentials.userAccessToken, "id,name,account_status");
    const campaignLists = await Promise.all(accounts.flatMap((account) => {
      const accountId = typeof account.id === "string" ? account.id : "";
      if (!accountId) return [];
      return [graphList<GraphObject>(`${accountId}/campaigns`, credentials.userAccessToken, "id,name,effective_status")];
    }));
    const byId = new Map<string, MetaCampaign>();
    for (const campaign of campaignLists.flat()) {
      const id = typeof campaign.id === "string" ? campaign.id : "";
      const name = typeof campaign.name === "string" ? campaign.name.trim() : "";
      const status = typeof campaign.effective_status === "string" ? campaign.effective_status : null;
      if (id && name && status === "ACTIVE") byId.set(id, { id, name, status });
    }
    return { connected: true, campaigns: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name)), error: null };
  } catch (error) {
    return {
      connected: true,
      campaigns: [],
      error: error instanceof Error ? error.message.slice(0, 220) : "Active Meta campaigns could not be loaded.",
    };
  }
}

export function metaOAuthConfiguration() {
  return {
    appId: process.env.META_APP_ID?.trim() || "",
    appSecret: process.env.META_APP_SECRET?.trim() || "",
    redirectUri: process.env.META_REDIRECT_URI?.trim() || "",
    encryptionKey: process.env.META_TOKEN_ENCRYPTION_KEY?.trim() || "",
    verifyToken: process.env.META_VERIFY_TOKEN?.trim() || "",
  };
}

export function createOAuthState() {
  return randomBytes(32).toString("base64url");
}
