"use client";

import { useState } from "react";

import {
  adminCreateUser,
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
    if (!window.confirm(`Revoke CRM access for ${user.name || user.email}?`)) return;

    setPendingUserId(user.id);
    const response = await removeUserAccess(user.id);
    if (!response.success) {
      toast.add({ title: "Unable to revoke access", description: response.error, type: "error" });
    } else {
      setUsers((currentUsers) => currentUsers.filter((currentUser) => currentUser.id !== user.id));
      toast.add({ title: "Access revoked", description: `${user.name || user.email} no longer has CRM access.`, type: "success" });
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
              <TableHead className="text-right">Access</TableHead>
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
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={pendingUserId === user.id}
                    onClick={() => void handleRevoke(user)}
                  >
                    Revoke Access
                  </Button>
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
                {isCreatingUser ? "Creating..." : "Create User"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
