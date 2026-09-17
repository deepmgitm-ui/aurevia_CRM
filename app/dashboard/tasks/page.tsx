import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface FollowUpLead {
  id: string;
  name: string;
  phone: string | null;
  disease: string;
  follow_up_date: string;
}

export default async function TasksPage() {
  const supabase = await createClient();
  const { data: leads } = await supabase
    .from("leads")
    .select("id, name, phone, disease, follow_up_date")
    .not("follow_up_date", "is", null)
    .neq("follow_up_date", "")
    .neq("follow_up_date", "-")
    .order("follow_up_date", { ascending: true });

  const followUps = (leads ?? []) as FollowUpLead[];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Tasks</h1>
        <p className="mt-2 text-sm text-slate-500">Follow-ups and calls that need your attention.</p>
      </div>
      <Card className="border-0 shadow-sm">
        <CardHeader><CardTitle className="text-lg">Follow-up Tasks</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Patient</TableHead><TableHead>Contact</TableHead><TableHead>Treatment</TableHead><TableHead>Follow-Up</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
            <TableBody>
              {followUps.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="h-32 text-center text-slate-500">No follow-up tasks scheduled.</TableCell></TableRow>
              ) : followUps.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell className="font-medium text-slate-900">{lead.name}</TableCell>
                  <TableCell>
                    <span className="mr-2">{lead.phone || "-"}</span>
                    <a href={`https://wa.me/91${lead.phone?.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs font-bold ml-2 inline-flex items-center hover:bg-green-200 border border-green-300">💬 WhatsApp</a>
                  </TableCell>
                  <TableCell>{lead.disease}</TableCell>
                  <TableCell className="font-semibold text-slate-900">{lead.follow_up_date}</TableCell>
                  <TableCell><Button type="button" variant="outline" size="sm">Mark Done</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
