export interface StaffActivity {
  observed_at?: string;
  user_id: string;
  name: string;
  role: string;
  first_seen: string | null;
  last_seen: string | null;
  last_active: string | null;
  session_started_at: string | null;
  online_seconds: number;
  active_seconds: number;
}

export function activityState(
  row: StaffActivity,
  now = Date.now(),
): "Active" | "Idle" | "Offline" {
  const seen = row.last_seen ? Date.parse(row.last_seen) : NaN;
  if (!Number.isFinite(seen) || now - seen > 150_000) return "Offline";
  const active = row.last_active ? Date.parse(row.last_active) : NaN;
  return Number.isFinite(active) && now - active <= 300_000 ? "Active" : "Idle";
}

export function activityDuration(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  if (minutes < 1) return "< 1m";
  return minutes < 60
    ? `${minutes}m`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
