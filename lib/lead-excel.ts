export interface LeadExcelRecord {
  name?: string | null;
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
}

/** Download a readable Excel copy before a user-triggered lead deletion. */
export async function downloadLeadsExcel(leads: LeadExcelRecord[], fileName: string): Promise<void> {
  const XLSX = await import("xlsx");
  const rows = leads.map((lead) => ({
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
    "Assigned To": lead.assigned_to ?? "",
    "Created At": lead.created_at ?? "",
  }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet["!cols"] = [
    { wch: 26 }, { wch: 16 }, { wch: 28 }, { wch: 12 }, { wch: 18 }, { wch: 28 },
    { wch: 18 }, { wch: 42 }, { wch: 16 }, { wch: 18 }, { wch: 20 }, { wch: 20 },
    { wch: 24 }, { wch: 24 },
  ];
  sheet["!autofilter"] = { ref: sheet["!ref"] ?? "A1:N1" };
  sheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Deleted Leads Backup");
  XLSX.writeFile(workbook, fileName.toLowerCase().endsWith(".xlsx") ? fileName : `${fileName}.xlsx`, {
    compression: true,
  });
}
