import { createClient } from "@/lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ archiveId: string }> },
) {
  const { archiveId } = await params;
  if (!UUID_PATTERN.test(archiveId)) return Response.json({ error: "Invalid archive id." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return Response.json({ error: "Sign in to download this archive." }, { status: 401 });

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || profile?.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });

  const { data: archive, error } = await supabase
    .from("crm_lead_retention_archives")
    .select("id, deleted_at, deleted_by_name, lead_count, activity_count, lead_rows, activity_rows, related_rows")
    .eq("id", archiveId)
    .maybeSingle();
  if (error || !archive) return Response.json({ error: "Archive not found." }, { status: 404 });

  const filename = `aurevia-lead-retention-${archive.deleted_at.slice(0, 10)}-${archive.id}.json`;
  return Response.json(
    {
      format: "aurevia-crm-lead-retention-archive/v1",
      archived_at: archive.deleted_at,
      archived_by: archive.deleted_by_name,
      lead_count: archive.lead_count,
      activity_count: archive.activity_count,
      leads: archive.lead_rows,
      activity_history: archive.activity_rows,
      related_history: archive.related_rows,
    },
    {
      headers: {
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
