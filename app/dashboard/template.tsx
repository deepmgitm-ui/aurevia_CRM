import type { ReactNode } from "react";

/** Re-mounts with dashboard navigation so the page gets a brief entrance cue. */
export default function DashboardTemplate({ children }: { children: ReactNode }) {
  return <div className="crm-route-enter">{children}</div>;
}
