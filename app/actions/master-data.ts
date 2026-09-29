// Aurevia CRM — master data (picklist) server actions.
//
// Reads/writes `crm_option_lists`. When the migration has not been applied the
// table is missing: reads fall back to MASTER_DATA_SEED and writes fail with
// the exact SQL file to run — so the Settings screen works (read-only seeds)
// before the admin ever touches the SQL editor.
"use server";

import { createClient } from "@/lib/supabase/server";

import {
  MASTER_DATA_LISTS,
  seedMasterData,
  type MasterDataListKey,
  type MasterDataResponse,
  type MasterDataSaveResponse,
} from "@/lib/master-data";

function missingTableError(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST204") return true;
  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("could not find the table") ||
    message.includes("does not exist") ||
    message.includes("schema cache")
  );
}

type MasterDataSupabase = Awaited<ReturnType<typeof createClient>>;

async function getViewerRole(supabase: MasterDataSupabase): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  return profile?.role ?? null;
}

/** Every list: DB values first, then any seed values the DB does not have yet. */
export async function getMasterData(): Promise<MasterDataResponse> {
  try {
    const supabase = await createClient();
    const seeded = seedMasterData();
    const { data, error } = await supabase.from("crm_option_lists").select("key, options");
    if (error || !data) return { success: true, data: seeded };
    const lists = { ...seeded.lists };
    for (const row of data as Record<string, unknown>[]) {
      const key = String(row.key ?? "") as MasterDataListKey;
      if (!MASTER_DATA_LISTS.includes(key)) continue;
      const stored = Array.isArray(row.options) ? row.options.map((value) => String(value ?? "").trim()) : [];
      const seen = new Set(lists[key].map((value) => value.toLowerCase()));
      const merged = [...lists[key]];
      for (const value of stored) {
        if (value && value !== "-" && !seen.has(value.toLowerCase())) {
          seen.add(value.toLowerCase());
          merged.push(value);
        }
      }
      lists[key] = merged;
    }
    return { success: true, data: { lists, fromDatabase: true } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error && error.message ? error.message : "Unable to load master data.",
    };
  }
}

/** Replace one list wholesale (admins/managers only). Blanks and "-" are dropped. */
export async function saveMasterDataList(
  key: MasterDataListKey,
  options: string[],
): Promise<MasterDataSaveResponse> {
  if (!MASTER_DATA_LISTS.includes(key)) return { success: false, error: "Unknown list." };
  try {
    const supabase = await createClient();
    const role = await getViewerRole(supabase);
    if (role !== "admin" && role !== "manager") {
      return { success: false, error: "Only admins and managers can edit master data (403 Forbidden)." };
    }
    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const option of options) {
      const value = String(option ?? "").trim();
      if (!value || value === "-" || seen.has(value.toLowerCase())) continue;
      seen.add(value.toLowerCase());
      cleaned.push(value);
    }
    const { error } = await supabase
      .from("crm_option_lists")
      .upsert({ key, options: cleaned, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) {
      return missingTableError(error)
        ? {
            success: false,
            error:
              "Master data is not set up yet. Run supabase-master-data-migration.sql in the Supabase SQL editor first.",
          }
        : { success: false, error: error.message };
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error && error.message ? error.message : "Unable to save master data.",
    };
  }
}
