"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { changeAppointmentStatus } from "./actions";
export function AppointmentStatusActions({
  id,
  status,
}: {
  id: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  async function change(value: string) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const result = await changeAppointmentStatus(id, value);
      if (result.success) router.refresh();
      else setError(result.error);
    } catch {
      setError("Status could not be saved.");
    } finally {
      setPending(false);
    }
  }
  if (["completed", "cancelled", "no_show"].includes(status)) return null;
  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        {[
          status === "booked" ? "confirmed" : null,
          status !== "arrived" ? "arrived" : null,
          "completed",
          "no_show",
          "cancelled",
        ]
          .filter((value): value is string => Boolean(value))
          .map((value) => (
            <Button
              size="sm"
              variant="outline"
              key={value}
              disabled={pending}
              onClick={() => void change(value)}
            >
              {value.replace("_", " ")}
            </Button>
          ))}
      </div>
      {error && (
        <p role="alert" className="text-xs text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}
