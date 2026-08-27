import { useEffect, useMemo, useState } from "react";
import { Pencil, Search } from "lucide-react";

import { ManualAdjustmentDialog } from "@/components/leave/manual-adjustment-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTableShell } from "@/components/ui/data-table-shell";
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
import { EmployeeService } from "@/lib/data/employee-service";
import { LeaveService } from "@/lib/data/leave-service";
import type { LeaveBalanceReport, LeavePolicy } from "@/lib/data/leave-types";
import type { Employee } from "@/lib/data/types";

const PAGE_SIZE = 12;

interface BalanceRow {
  employee: Employee;
  policy: LeavePolicy;
  balance: LeaveBalanceReport;
}

function formatDays(value: number): string {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
}

export function LeaveBalanceRegister() {
  const leaveService = useMemo(() => new LeaveService(), []);
  const employeeService = useMemo(() => new EmployeeService(), []);
  const [, setRevision] = useState(0);
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("all");
  const [policyId, setPolicyId] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedRow, setSelectedRow] = useState<BalanceRow | null>(null);

  const employees = employeeService
    .getEmployees()
    .filter((employee) => !["Inactive", "Archived"].includes(employee.status))
    .sort((a, b) => a.preferredName.localeCompare(b.preferredName));

  const rows = employees.flatMap((employee) =>
    leaveService
      .getEligiblePolicies(employee.id)
      .filter((policy) => policy.scope === "Annual" || policy.scope === "Ledger")
      .map((policy) => ({
        employee,
        policy,
        balance: leaveService.calculateBalance(employee.id, policy.id),
      })),
  );

  const departments = [...new Set(employees.map((employee) => employee.department))].sort();
  const policies = Array.from(
    new Map(rows.map((row) => [row.policy.id, row.policy])).values(),
  ).sort((a, b) => a.name.localeCompare(b.name));
  const normalizedSearch = search.trim().toLowerCase();
  const filteredRows = rows.filter((row) => {
    if (department !== "all" && row.employee.department !== department) return false;
    if (policyId !== "all" && row.policy.id !== policyId) return false;
    if (!normalizedSearch) return true;
    return [
      row.employee.preferredName,
      row.employee.legalName,
      row.employee.employeeNumber,
      row.employee.department,
      row.policy.name,
      row.policy.code,
    ].some((value) => value.toLowerCase().includes(normalizedSearch));
  });
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const visibleRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => setPage(1), [department, policyId, search]);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <>
      <Card>
        <CardHeader className="border-b">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Employee Leave Balances</CardTitle>
              <CardDescription className="mt-1">
                Review employee leave balances and select Edit when a correction is needed.
              </CardDescription>
            </div>
            <Badge variant="secondary">{filteredRows.length} balance records</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_220px_220px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search employee, number or leave type"
                className="pl-9"
                aria-label="Search leave balances"
              />
            </div>
            <Select value={department} onValueChange={setDepartment}>
              <SelectTrigger aria-label="Filter by department">
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departments.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={policyId} onValueChange={setPolicyId}>
              <SelectTrigger aria-label="Filter by leave type">
                <SelectValue placeholder="All leave types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All leave types</SelectItem>
                {policies.map((policy) => (
                  <SelectItem key={policy.id} value={policy.id}>
                    {policy.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DataTableShell>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Leave type</TableHead>
                  <TableHead className="text-right">Allowance</TableHead>
                  <TableHead className="text-right">Carried</TableHead>
                  <TableHead className="text-right">Used / scheduled</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map((row) => (
                  <TableRow key={`${row.employee.id}:${row.policy.id}`}>
                    <TableCell className="min-w-52">
                      <p className="font-medium">{row.employee.preferredName}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.employee.employeeNumber} · {row.employee.department}
                      </p>
                    </TableCell>
                    <TableCell className="min-w-44">
                      <p className="font-medium">{row.policy.name}</p>
                      <p className="text-xs text-muted-foreground">{row.policy.code}</p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatDays(row.balance.entitlement)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatDays(row.balance.carriedForward)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatDays(row.balance.taken + row.balance.approvedFuture)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatDays(row.balance.pending)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatDays(row.balance.available)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => setSelectedRow(row)}>
                        <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {visibleRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                      No leave balances match the current filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </DataTableShell>

          {filteredRows.length > PAGE_SIZE && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {(page - 1) * PAGE_SIZE + 1}–
                {Math.min(page * PAGE_SIZE, filteredRows.length)} of {filteredRows.length}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => setPage((value) => value - 1)}
                >
                  Previous
                </Button>
                <span className="min-w-20 text-center text-sm tabular-nums">
                  {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === totalPages}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedRow && (
        <ManualAdjustmentDialog
          open={Boolean(selectedRow)}
          onOpenChange={(open) => !open && setSelectedRow(null)}
          defaultEmployeeId={selectedRow.employee.id}
          defaultPolicyId={selectedRow.policy.id}
          onSuccess={() => {
            setRevision((value) => value + 1);
            setSelectedRow(null);
          }}
        />
      )}
    </>
  );
}
