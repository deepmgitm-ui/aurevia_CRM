/**
 * Shared (client + server) constants and types for the lead-deletion safety net.
 *
 * Deleting every lead is the one action that can empty the product, so
 * `bulkDeleteLeads` (a) requires the literal confirmation phrase below when
 * nothing scopes the delete, and (b) snapshots the doomed rows into the
 * `lead_deletion_backups` table first — free-tier Supabase has no automatic
 * backups, so without a snapshot a mis-click would be permanent.
 *
 * This lives outside `app/actions/leads.ts` because a `"use server"` module may
 * only export async functions.
 */

/** The literal phrase a user must type before an unscoped "delete all" runs. */
export const DELETE_ALL_CONFIRMATION = "DELETE ALL";

/**
 * Shown whenever the snapshot table is unavailable, so the app keeps working
 * (deletes still succeed) while telling the admin exactly how to switch the
 * undo feature on.
 */
export const LEAD_DELETION_BACKUP_SETUP_HINT =
  "Run supabase-deletion-backup-migration.sql in the Supabase SQL editor to enable one-click restore.";

/**
 * True when a Supabase error means "the table/column does not exist yet"
 * (Postgres 42P01 / PostgREST PGRST205), i.e. the migration hasn't been pasted
 * into the SQL editor. Deletion is not blocked by this — it only disables undo.
 */
export function isMissingBackupTableError(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST204") return true;
  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("could not find the table") ||
    message.includes("does not exist") ||
    message.includes("schema cache")
  );
}

/** Admin/manager view of one stored bulk-deletion snapshot. */
export interface LeadDeletionBackup {
  id: string;
  scope: string;
  search: string;
  deleted_by_name: string;
  row_count: number;
  activity_count: number;
  restored_at: string | null;
  created_at: string;
}
