export interface LeadExcelRecord {
  name?: string | null;
  id?: string | null;
  lead_sequence_id?: number | null;
  phone?: string | null;
  email?: string | null;
  gender?: string | null;
  city?: string | null;
  disease?: string | null;
  insurance_status?: string | null;
  remarks?: string | null;
  lead_date?: string | null;
  follow_up_date?: string | null;
  source?: string | null;
  status?: string | null;
  assigned_to?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  imported_status?: string | null;
  intake_status?: string | null;
  workflow_bucket?: string | null;
}

/** Download a readable Excel copy before a user-triggered lead deletion. */
export async function downloadLeadsExcel(
  leads: LeadExcelRecord[],
  fileName: string,
  activities: Array<{ id: string; lead_id: string; user_id: string; actor_name?: string; action_type: string; description: string | null; created_at: string }> = [],
): Promise<void> {
  const XLSX = await import("xlsx");
  const rows = leads.map((lead) => ({
    "Lead ID": lead.lead_sequence_id == null ? "" : `#${lead.lead_sequence_id}`,
    "Database ID": lead.id ?? "",
    Name: lead.name ?? "",
    Phone: lead.phone ?? "",
    Email: lead.email ?? "",
    Gender: lead.gender ?? "",
    City: lead.city ?? "",
    Treatment: lead.disease ?? "",
    "Insurance Status": lead.insurance_status ?? "",
    Remarks: lead.remarks ?? "",
    "Lead Date": lead.lead_date ?? "",
    "Follow-Up Date": lead.follow_up_date ?? "",
    Source: lead.source ?? "",
    Status: lead.status ?? "",
    "Source Status": lead.imported_status ?? lead.intake_status ?? "",
    "Workflow Bucket": lead.workflow_bucket ?? "",
    "Assigned To": lead.assigned_to ?? "",
    "Created At": lead.created_at ?? "",
    "Updated At": lead.updated_at ?? "",
    "Additional Stored Fields (JSON)": JSON.stringify(Object.fromEntries(Object.entries(lead).filter(([key]) => ![
      "id", "lead_sequence_id", "name", "phone", "email", "gender", "city", "disease", "insurance_status", "remarks",
      "lead_date", "follow_up_date", "source", "status", "imported_status", "intake_status", "workflow_bucket",
      "assigned_to", "created_at", "updated_at",
    ].includes(key)))),
  }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet["!cols"] = [
    { wch: 12 }, { wch: 38 },
    { wch: 26 }, { wch: 16 }, { wch: 28 }, { wch: 12 }, { wch: 18 }, { wch: 28 },
    { wch: 18 }, { wch: 42 }, { wch: 16 }, { wch: 18 }, { wch: 22 }, { wch: 22 },
    { wch: 20 }, { wch: 20 }, { wch: 24 }, { wch: 24 }, { wch: 80 }, { wch: 80 },
  ];
  sheet["!autofilter"] = { ref: sheet["!ref"] ?? "A1:N1" };
  sheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Deleted Leads Backup");
  if (activities.length) {
    const history = XLSX.utils.json_to_sheet(activities.map((activity) => ({
      "Lead Database ID": activity.lead_id,
      "Activity ID": activity.id,
      "Updated By": activity.actor_name ?? activity.user_id,
      "Actor User ID": activity.user_id,
      Action: activity.action_type,
      Details: activity.description ?? "",
      "Date and Time": activity.created_at,
    })));
    history["!cols"] = [{ wch: 38 }, { wch: 38 }, { wch: 24 }, { wch: 38 }, { wch: 20 }, { wch: 60 }, { wch: 28 }];
    history["!autofilter"] = { ref: history["!ref"] ?? "A1:G1" };
    history["!freeze"] = { xSplit: 0, ySplit: 1 };
    XLSX.utils.book_append_sheet(workbook, history, "Activity History");
  }
  XLSX.writeFile(workbook, fileName.toLowerCase().endsWith(".xlsx") ? fileName : `${fileName}.xlsx`, {
    compression: true,
  });
}
