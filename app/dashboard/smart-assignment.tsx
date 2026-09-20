"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";

import { assignUnassignedLeads } from "@/app/actions/leads";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";

interface AssigneeOption {
  id: string;
  name: string;
}

// Amber "unassigned leads" banner with an actionable "Assign Leads" button
// that opens the Smart Assignment Modal (count + employee selection +
// round-robin/equal-split distribution via assignUnassignedLeads).
export function SmartAssignmentBanner({
  unassigned,
  employees,
}: {
  unassigned: number;
  employees: AssigneeOption[];
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [count, setCount] = useState(unassigned);
  const [selected, setSelected] = useState<string[]>([]);
  const [isAssigning, setIsAssigning] = useState(false);

  const parsedCount = Math.floor(Number(count) || 0);
  const countValid = parsedCount >= 1 && parsedCount <= unassigned;
  const canSubmit = !isAssigning && countValid && selected.length > 0;

  // Live preview of the equal split (remainder goes to the first employees).
  const splitPreview = useMemo(() => {
    if (selected.length === 0 || parsedCount < 1) return null;
    const base = Math.floor(parsedCount / selected.length);
    const remainder = parsedCount % selected.length;
    return { base, remainder };
  }, [parsedCount, selected.length]);

  function openModal() {
    setCount(unassigned);
    setSelected([]);
    setIsOpen(true);
  }

  function toggleEmployee(name: string, checked: boolean) {
    setSelected((current) => (checked ? [...current, name] : current.filter((entry) => entry !== name)));
  }

  function toggleSelectAll(checked: boolean) {
    setSelected(checked ? employees.map((employee) => employee.name) : []);
  }

  const allSelected = employees.length > 0 && selected.length === employees.length;

  async function handleAssign() {
    if (!canSubmit) return;
    setIsAssigning(true);
    const response = await assignUnassignedLeads(parsedCount, selected);
    if (!response.success) {
      toast.add({ title: "Assignment failed", description: response.error, type: "error" });
    } else {
      const { assigned, perEmployee } = response.data;
      toast.add({
        title: `Successfully distributed ${assigned} leads among ${perEmployee.length} employees.`,
        description: perEmployee.map((entry) => `${entry.name}: ${entry.count}`).join(" · "),
        type: "success",
      });
      setIsOpen(false);
      // Server re-render: the banner disappears and team stats update.
      router.refresh();
    }
    setIsAssigning(false);
  }

  if (unassigned <= 0 || employees.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between">
      <p>
        <span className="font-semibold">{unassigned.toLocaleString()}</span> lead
        {unassigned === 1 ? " is" : "s are"} not assigned to any team member.
      </p>
      <Button type="button" size="sm" className="shrink-0" onClick={openModal}>
        <UserPlus aria-hidden="true" />
        Assign Leads
      </Button>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Smart Assignment</DialogTitle>
            <DialogDescription>
              Distribute unassigned leads equally among the selected team members.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="smart-assign-count">How many leads do you want to assign?</Label>
              <Input
                id="smart-assign-count"
                type="number"
                min={1}
                max={unassigned}
                value={count}
                onChange={(event) => setCount(Math.floor(Number(event.target.value) || 0))}
              />
              <p className="text-xs text-slate-500">
                {unassigned.toLocaleString()} unassigned leads available.
                {!countValid && <span className="text-rose-600"> Enter a number between 1 and {unassigned}.</span>}
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Select employees</Label>
                <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-600">
                  <input
                    type="checkbox"
                    aria-label="Select all employees"
                    checked={allSelected}
                    onChange={(event) => toggleSelectAll(event.target.checked)}
                  />
                  Select All
                </label>
              </div>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                {employees.map((employee) => (
                  <label
                    key={employee.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      aria-label={`Assign leads to ${employee.name}`}
                      checked={selected.includes(employee.name)}
                      onChange={(event) => toggleEmployee(employee.name, event.target.checked)}
                    />
                    {employee.name}
                  </label>
                ))}
              </div>
              {splitPreview && (
                <p className="text-xs text-slate-500">
                  {splitPreview.base} lead{splitPreview.base === 1 ? "" : "s"} each
                  {splitPreview.remainder > 0
                    ? `, plus 1 extra to the first ${splitPreview.remainder} selected.`
                    : "."}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
            <Button type="button" disabled={!canSubmit} onClick={() => void handleAssign()}>
              {isAssigning ? "Assigning..." : "Assign Now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}