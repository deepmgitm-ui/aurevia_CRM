"use client";

import { useState } from "react";

import { changeOwnPassword } from "@/app/actions/users";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";

export function PasswordPanel() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (newPassword !== confirmPassword) {
      setPasswordError("The new passwords do not match.");
      toast.add({ title: "Passwords do not match", description: "Enter the same new password in both fields.", type: "error" });
      return;
    }
    setPasswordError("");
    setSaving(true);
    try {
      const response = await changeOwnPassword(currentPassword, newPassword);
      if (!response.success) {
        toast.add({ title: "Unable to change password", description: response.error, type: "error" });
      } else {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        toast.add({ title: "Password changed", description: "Your new password is ready to use.", type: "success" });
      }
    } catch {
      toast.add({ title: "Unable to change password", description: "The server could not be reached. Try again.", type: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="max-w-xl border-0 shadow-sm">
      <CardHeader><CardTitle className="text-lg">Password</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="current-password">Current password</Label>
            <Input id="current-password" name="currentPassword" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <Input id="new-password" name="newPassword" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => { setNewPassword(event.target.value); setPasswordError(""); }} minLength={8} maxLength={128} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input id="confirm-password" name="confirmPassword" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setPasswordError(""); }} minLength={8} maxLength={128} required aria-invalid={passwordError ? true : undefined} aria-describedby={passwordError ? "password-error" : undefined} />
            {passwordError && <p id="password-error" role="alert" className="text-sm text-rose-700">{passwordError}</p>}
          </div>
          <Button type="submit" disabled={saving || newPassword.length < 8 || !currentPassword || !confirmPassword}>
            {saving ? "Saving…" : "Change password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
