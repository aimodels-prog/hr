import { useEffect, useState, useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { getScopedEmployees, getScopedDocuments } from "@/lib/auth/record-scope";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, FolderOpen } from "lucide-react";
import { EmployeeService } from "@/lib/data/employee-service";
import { DocumentService } from "@/lib/data/document-service";
import { format } from "date-fns";
import type { DocumentType, DocumentStatus } from "@/lib/data/types";

export const Route = createFileRoute("/staff/files")({
  component: EmployeeFilesRoute,
});

const DOCUMENT_TYPES: DocumentType[] = [
  "contract",
  "passport",
  "visa",
  "national_id",
  "work_permit",
  "driving_licence",
  "medical",
  "education_certificate",
  "professional_certificate",
  "bank_evidence",
  "other",
];

const DOCUMENT_STATUSES: DocumentStatus[] = [
  "Pending Verification",
  "Valid",
  "Rejected",
  "Replaced",
];

function EmployeeFilesRoute() {
  const currentUser = useCurrentUser();
  const employeeService = useMemo(() => new EmployeeService(), []);
  const documentService = useMemo(() => new DocumentService(), []);
  const [, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    void Promise.all([
      employeeService.hydrateCompatibilityCache(currentUser.getActorContext()),
      documentService.hydrateCompatibilityCache(currentUser.getActorContext()),
    ])
      .then(() => {
        if (active) setRefreshKey((value) => value + 1);
      })
      .catch((error) => {
        if (active)
          setLoadError(
            error instanceof Error ? error.message : "Employee files could not be loaded.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentUser, documentService, employeeService]);

  const allEmployees = employeeService.getEmployees(currentUser.getActorContext());
  const allDocs = documentService.getDocuments(currentUser.getActorContext());

  const employees = useMemo(
    () => getScopedEmployees(allEmployees, currentUser),
    [allEmployees, currentUser],
  );
  const scopedDocs = useMemo(
    () => getScopedDocuments(allDocs, allEmployees, currentUser),
    [allDocs, allEmployees, currentUser],
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const rows = useMemo(() => {
    return scopedDocs
      .map((doc) => ({ doc, employee: employees.find((e) => e.id === doc.employeeId) }))
      .filter((r) => r.employee)
      .filter((r) => typeFilter === "all" || r.doc.type === typeFilter)
      .filter((r) => statusFilter === "all" || r.doc.status === statusFilter)
      .filter((r) => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
          r.employee!.preferredName.toLowerCase().includes(q) ||
          r.employee!.legalName.toLowerCase().includes(q) ||
          r.employee!.employeeNumber.toLowerCase().includes(q) ||
          r.doc.type.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.doc.updatedAt.localeCompare(a.doc.updatedAt));
  }, [scopedDocs, employees, searchQuery, typeFilter, statusFilter]);

  const canViewRestricted = currentUser.can("employee:manage_all");

  return (
    <RequirePermission permission="employee:view_all" resourceName="Employee Files">
      <div className="flex flex-col gap-6 max-w-[1400px] mx-auto pb-10">
        <PageHeader
          title="Employee Files"
          description="Search and review documents across every employee, without opening each profile individually."
          breadcrumbs={[{ label: "Core HR" }, { label: "Employee Files" }]}
        />
        {loading && <p className="text-sm text-muted-foreground">Loading employee files...</p>}
        {loadError && <p className="text-sm text-destructive">{loadError}</p>}

        <div className="flex flex-wrap gap-4 rounded-xl border bg-card p-4 shadow-sm">
          <div className="relative flex-1 min-w-[250px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by employee name, number, or document type..."
              className="pl-9 bg-background"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[200px] bg-background">
              <SelectValue placeholder="Document Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {DOCUMENT_TYPES.map((t) => (
                <SelectItem key={t} value={t} className="capitalize">
                  {t.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[200px] bg-background">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {DOCUMENT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Document Type</TableHead>
                <TableHead>Document Number</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Profile</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    <FolderOpen className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                    No documents found matching your criteria.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map(({ doc, employee }) => (
                  <TableRow key={doc.id}>
                    <TableCell>
                      <div className="font-medium">{employee!.preferredName}</div>
                      <div className="text-xs text-muted-foreground">
                        {employee!.employeeNumber} &bull; {employee!.department}
                      </div>
                    </TableCell>
                    <TableCell className="capitalize">{doc.type.replace(/_/g, " ")}</TableCell>
                    <TableCell className="text-sm">
                      {doc.visibility === "Restricted" && !canViewRestricted
                        ? "***REDACTED***"
                        : doc.documentNumber || "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {doc.expiryDate ? format(new Date(doc.expiryDate), "MMM d, yyyy") : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          doc.status === "Valid"
                            ? "default"
                            : doc.status === "Rejected"
                              ? "destructive"
                              : doc.status === "Replaced"
                                ? "outline"
                                : "secondary"
                        }
                      >
                        {doc.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        to="/staff/employees/$employeeId"
                        params={{ employeeId: employee!.id }}
                        className="text-sm text-primary hover:underline"
                      >
                        Open Profile
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>
    </RequirePermission>
  );
}
