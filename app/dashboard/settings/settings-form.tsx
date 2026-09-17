"use client";

import { useState } from "react";

import { updateProfileName } from "@/app/actions/profile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";

type ProfileRole = "admin" | "manager" | "employee";

export function SettingsForm({ initialName, role }: { initialName: string; role: ProfileRole }) {
  const [name, setName] = useState(initialName);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    const response = await updateProfileName(name);

    if (!response.success) {
      toast.add({ title: "Unable to save changes", description: response.error, type: "error" });
    } else {
      setName(response.name);
      toast.add({ title: "Profile updated", description: "Your name has been saved.", type: "success" });
    }
    setIsSaving(false);
  }

  return (
    <Card className="max-w-xl border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg">Profile</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="profile-name">Full Name</Label>
            <Input id="profile-name" value={name} onChange={(event) => setName(event.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <div>
              {role === "admin" ? (
                <Badge className="border-green-200 bg-green-100 text-green-700 hover:bg-green-100">Admin</Badge>
              ) : role === "employee" ? (
                <Badge>Employee</Badge>
              ) : (
                <Badge variant="secondary">Manager</Badge>
              )}
            </div>
          </div>
          <Button type="submit" disabled={isSaving || !name.trim()}>
            {isSaving ? "Saving..." : "Save Profile"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
