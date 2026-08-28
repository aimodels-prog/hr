import { useMemo, useState } from "react";
import { Search, Shield, UserRoundCog } from "lucide-react";
import { toast } from "sonner";
import { useCurrentUser } from "@/lib/auth";
import { EmployeeService } from "@/lib/data/employee-service";
import type { Role, User } from "@/lib/data/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import { Textarea } from "@/components/ui/textarea";

const badgeClass: Record<Role, string> = {
  Employee: "bg-slate-500/15 text-slate-700",
  "Line Manager": "bg-amber-500/15 text-amber-700",
  HR: "bg-blue-500/15 text-blue-700",
  Accounts: "bg-emerald-500/15 text-emerald-700",
  IT: "bg-cyan-500/15 text-cyan-700",
  "Super Admin": "bg-purple-500/15 text-purple-700",
};

const extraAccess: Array<{ role: Role; description: string }> = [
  {
    role: "Line Manager",
    description: "Review requests, attendance and timesheets for direct reports.",
  },
  { role: "HR", description: "Manage recruitment, employee records, leave and people operations." },
  { role: "Accounts", description: "Prepare payroll and review approved travel costs." },
  { role: "IT", description: "Employee access while IT responsibilities are prepared." },
  { role: "Super Admin", description: "Full access to all areas and company settings." },
];

export function UserManagementPanel() {
  const { userId, activeRole, getActorContext } = useCurrentUser();
  const [service] = useState(() => new EmployeeService());
  const [users, setUsers] = useState(() =>
    service.getUsers(getActorContext(), { includeArchived: true }),
  );
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<User | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [status, setStatus] = useState<User["status"]>("Active");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const employees = useMemo(
    () => service.getEmployees(getActorContext(), { includeArchived: true }),
    [getActorContext, service],
  );
  const rows = useMemo(
    () =>
      users.filter((user) => {
        const employee = employees.find((item) => item.id === user.employeeId);
        const searchText =
          `${user.displayName} ${user.workspaceEmail} ${employee?.position ?? ""} ${employee?.department ?? ""}`.toLowerCase();
        return searchText.includes(query.trim().toLowerCase());
      }),
    [employees, query, users],
  );

  const open = (user: User) => {
    setSelected(user);
    setRoles(user.roles.includes("Employee") ? user.roles : ["Employee", ...user.roles]);
    setStatus(user.status);
    setReason("");
  };

  const toggle = (role: Role, checked: boolean) =>
    setRoles((current) =>
      checked ? Array.from(new Set([...current, role])) : current.filter((item) => item !== role),
    );

  const save = () => {
    if (!selected) return;
    setSaving(true);
    try {
      service.updateUserAccess(selected.id, roles, status, reason, getActorContext());
      toast.success(`${selected.displayName}'s access has been updated`);
      setSelected(null);
      setUsers(service.getUsers(getActorContext(), { includeArchived: true }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update this user");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>People and Access</CardTitle>
        <CardDescription>
          Everyone starts with Employee access. HR or a Super Admin can add access when a person’s
          responsibilities change.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, email or job..."
            className="pl-8"
          />
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Job</TableHead>
                <TableHead>Sign-in Email</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No users match your search.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((user) => {
                  const employee = employees.find((item) => item.id === user.employeeId);
                  const locked = activeRole === "HR" && user.roles.includes("Super Admin");
                  return (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">
                        {user.displayName}
                        {user.id === userId && (
                          <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {employee
                          ? `${employee.position} · ${employee.department}`
                          : "Employee record not linked"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{user.workspaceEmail}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {user.roles.map((role) => (
                            <Badge key={role} variant="outline" className={badgeClass[role]}>
                              {role}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{user.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={locked}
                          title={locked ? "Only a Super Admin can change this account" : undefined}
                          onClick={() => open(user)}
                        >
                          <UserRoundCog className="mr-1.5 h-4 w-4" />
                          Manage
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog open={Boolean(selected)} onOpenChange={(isOpen) => !isOpen && setSelected(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Manage access for {selected?.displayName}
            </DialogTitle>
            <DialogDescription>
              {selected?.workspaceEmail}. Changes take effect immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[65vh] space-y-5 overflow-y-auto py-2 pr-1">
            <div>
              <label className="text-sm font-medium">Sign-in Status</label>
              <Select value={status} onValueChange={(value) => setStatus(value as User["status"])}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Suspended">Suspended (cannot sign in)</SelectItem>
                  <SelectItem value="Archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Access</label>
              <div className="mt-2 rounded-lg border bg-muted/30 p-3">
                <p className="text-sm font-medium">Employee</p>
                <p className="text-xs text-muted-foreground">
                  Included for everyone and cannot be removed.
                </p>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {extraAccess.map(({ role, description }) => {
                  const locked = activeRole !== "Super Admin" && role === "Super Admin";
                  return (
                    <label
                      key={role}
                      htmlFor={`role-${role}`}
                      className={`flex items-start gap-3 rounded-lg border p-3 ${roles.includes(role) ? "border-primary/40 bg-primary/5" : ""} ${locked ? "opacity-60" : "cursor-pointer"}`}
                    >
                      <Checkbox
                        id={`role-${role}`}
                        checked={roles.includes(role)}
                        disabled={locked}
                        onCheckedChange={(checked) => toggle(role, checked === true)}
                      />
                      <span>
                        <span className="block text-sm font-medium">{role}</span>
                        <span className="block text-xs leading-4 text-muted-foreground">
                          {description}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div>
              <label htmlFor="change-reason" className="text-sm font-medium">
                Reason for change
              </label>
              <Textarea
                id="change-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="For example: Promoted to Finance Manager"
                className="mt-1.5 min-h-20"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                This helps HR understand why access changed.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || reason.trim().length < 5}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
