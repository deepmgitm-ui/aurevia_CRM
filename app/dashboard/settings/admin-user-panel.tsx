"use client";

import { useState } from "react";

import {
  adminCreateUser,
  adminResetUserPassword,
  getAllUsers,
  removeUserAccess,
  updateUserRole,
  type ManagedUser,
} from "@/app/actions/users";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";

export function AdminUserPanel({ initialUsers }: { initialUsers: ManagedUser[] }) {
  const [users, setUsers] = useState(initialUsers);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [passwordUser, setPasswordUser] = useState<ManagedUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  async function handleResetPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passwordUser || isResettingPassword) return;
    setIsResettingPassword(true);
    try {
      const response = await adminResetUserPassword(passwordUser.id, resetPassword);
      if (!response.success) {
        toast.add({ title: "Unable to reset password", description: response.error, type: "error" });
      } else {
        toast.add({ title: "Password reset", description: `${passwordUser.name || passwordUser.email} can sign in with the new password.`, type: "success" });
        setPasswordUser(null);
        setResetPassword("");
      }
    } catch {
      toast.add({ title: "Unable to reset password", description: "The server could not be reached. Try again.", type: "error" });
    } finally {
      setIsResettingPassword(false);
    }
  }

  async function handleCreateUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isCreatingUser) return;

    setIsCreatingUser(true);
    const response = await adminCreateUser(newUserEmail, newUserPassword, newUserName);
    if (!response.success) {
      toast.add({ title: "Unable to create user", description: response.error, type: "error" });
      setIsCreatingUser(false);
      return;
    }

    toast.add({
      title: "User created",
      description: `${newUserName} can now sign in to the CRM.`,
      type: "success",
    });
    setIsAddUserOpen(false);
    setNewUserName("");
    setNewUserEmail("");
    setNewUserPassword("");
    setIsCreatingUser(false);

    const refreshed = await getAllUsers();
    if (refreshed.success) setUsers(refreshed.data);
  }

  async function handleRoleChange(userId: string, value: unknown) {
    if (typeof value !== "string") return;

    setPendingUserId(userId);
    const response = await updateUserRole(userId, value);
    if (!response.success) {
      toast.add({ title: "Unable to update role", description: response.error, type: "error" });
    } else {
      setUsers((currentUsers) =>
        currentUsers.map((user) =>
          user.id === userId ? { ...user, role: response.data } : user,
        ),
      );
      toast.add({ title: "Role updated", description: "The user's role was updated.", type: "success" });
    }
    setPendingUserId(null);
  }

  async function handleRevoke(user: ManagedUser) {
    if (!window.confirm(`Permanently remove ${user.name || user.email} from the CRM and Supabase? Their profile photo will also be deleted.`)) return;

    setPendingUserId(user.id);
    const response = await removeUserAccess(user.id);
    if (!response.success) {
      toast.add({ title: "Unable to revoke access", description: response.error, type: "error" });
    } else {
      setUsers((currentUsers) => currentUsers.filter((currentUser) => currentUser.id !== user.id));
      toast.add({ title: "User removed", description: `${user.name || user.email} was removed from CRM and Supabase.`, type: "success" });
    }
    setPendingUserId(null);
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="text-lg">User Management (Admin Only)</CardTitle>
            <p className="mt-1 text-sm text-slate-500">Manage CRM roles and access.</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge className="border-green-200 bg-green-100 text-green-700 hover:bg-green-100">Admin</Badge>
            <Button type="button" size="sm" onClick={() => setIsAddUserOpen(true)}>
              + Add User
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Account</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-slate-500">No users found.</TableCell>
              </TableRow>
            ) : users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium text-slate-900">{user.name}</TableCell>
                <TableCell className="text-slate-600">{user.email}</TableCell>
                <TableCell>
                  <Select
                    value={user.role}
                    onValueChange={(value) => void handleRoleChange(user.id, value)}
                    disabled={pendingUserId === user.id}
                  >
                    <SelectTrigger size="sm" className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="employee">Employee</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={pendingUserId === user.id} onClick={() => setPasswordUser(user)}>
                      Reset Password
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={pendingUserId === user.id}
                      onClick={() => void handleRevoke(user)}
                    >
                      Revoke Access
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <Dialog open={isAddUserOpen} onOpenChange={setIsAddUserOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
            <DialogDescription>
              Create a new CRM account. The user will be able to sign in immediately.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(event) => void handleCreateUser(event)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-user-name">Full Name</Label>
              <Input
                id="new-user-name"
                value={newUserName}
                onChange={(event) => setNewUserName(event.target.value)}
                required
                autoComplete="name"
                placeholder="e.g. Priya Sharma"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-user-email">Email</Label>
              <Input
                id="new-user-email"
                type="email"
                value={newUserEmail}
                onChange={(event) => setNewUserEmail(event.target.value)}
                required
                autoComplete="email"
                placeholder="user@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-user-password">Password</Label>
              <Input
                id="new-user-password"
                type="password"
                value={newUserPassword}
                onChange={(event) => setNewUserPassword(event.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                placeholder="Minimum 8 characters"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddUserOpen(false)} disabled={isCreatingUser}>
                Cancel
              </Button>
              <Button type="submit" disabled={isCreatingUser}>
                {isCreatingUser ? "Creating…" : "Create User"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={passwordUser !== null} onOpenChange={(open) => { if (!open && !isResettingPassword) { setPasswordUser(null); setResetPassword(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>Set a new sign-in password for {passwordUser?.name || passwordUser?.email}.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(event) => void handleResetPassword(event)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="admin-reset-password">New password</Label>
              <Input id="admin-reset-password" name="newPassword" type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} required minLength={8} maxLength={128} autoComplete="new-password" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setPasswordUser(null); setResetPassword(""); }} disabled={isResettingPassword}>Cancel</Button>
              <Button type="submit" disabled={isResettingPassword || resetPassword.length < 8}>{isResettingPassword ? "Resetting…" : "Set new password"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
