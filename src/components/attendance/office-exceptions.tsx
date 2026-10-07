import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useCurrentUser } from "@/lib/auth";
import { EmployeeService } from "@/lib/data/employee-service";
import { getMasterDataRepository } from "@/lib/data/master-data";
import { OFFICE_EXCEPTION_TYPES, type OfficeExceptionType } from "@/lib/data/office-exceptions";
import {
  listOfficeExceptionsFn,
  saveOfficeExceptionFn,
  cancelOfficeExceptionFn,
} from "@/lib/server-functions/attendance.server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function OfficeExceptions({ onSaved }: { onSaved: () => void | Promise<void> }) {
  const user = useCurrentUser();
  const cache = useQueryClient();
  const actor = {
    actorId: user.id,
    activeRole: user.activeRole,
    ...(user.workspaceEmail ? { actorEmail: user.workspaceEmail } : {}),
  };
  const query = useQuery({
    queryKey: ["office-exceptions", user.id, user.activeRole],
    queryFn: () => listOfficeExceptionsFn({ data: { actor } }),
  });
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<OfficeExceptionType>("Company programme");
  const [startDate, setStart] = useState("");
  const [endDate, setEnd] = useState("");
  const [scope, setScope] = useState<"Everyone" | "Location" | "Department" | "Employees">(
    "Everyone",
  );
  const [scopeId, setScopeId] = useState("");
  const [employeeIds, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const people = new EmployeeService()
    .getEmployees(user.getActorContext())
    .filter((p) => !["Inactive", "Archived"].includes(p.status));
  const options = people.map((p) => ({
    value: p.databaseId ?? p.id,
    label: p.preferredName || p.legalName,
  }));
  const refresh = async () => {
    await cache.invalidateQueries();
    await onSaved();
  };
  const save = async () => {
    setBusy(true);
    try {
      await saveOfficeExceptionFn({
        data: {
          actor,
          title,
          kind,
          startDate,
          endDate: endDate || startDate,
          scope,
          ...(scopeId ? { scopeId } : {}),
          employeeIds,
          countAsWorked: kind !== "Excused closure",
        },
      });
      setTitle("");
      await refresh();
      toast.success("Office exception saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save office exception");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Office exception</CardTitle>
          <p className="text-sm text-muted-foreground">
            Record a company activity, remote-working day or excused closure once for everyone
            affected.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="block space-y-1 text-sm">
            Name
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="For example: Company training day"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              Type
              <SearchableSelect
                value={kind}
                options={OFFICE_EXCEPTION_TYPES.map((value) => ({ value, label: value }))}
                onValueChange={(v) => setKind(v as OfficeExceptionType)}
              />
            </label>
            <label className="space-y-1 text-sm">
              Applies to
              <SearchableSelect
                value={scope}
                options={["Everyone", "Location", "Department", "Employees"].map((value) => ({
                  value,
                  label: value,
                }))}
                onValueChange={(v) => {
                  setScope(v as typeof scope);
                  setScopeId("");
                  setIds([]);
                }}
              />
            </label>
            <label className="space-y-1 text-sm">
              From
              <Input type="date" value={startDate} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="space-y-1 text-sm">
              Until
              <Input
                type="date"
                min={startDate}
                value={endDate}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>
          {(scope === "Location" || scope === "Department") && (
            <SearchableSelect
              aria-label={scope}
              value={scopeId}
              options={getMasterDataRepository(scope === "Location" ? "locations" : "departments")
                .list()
                .filter((x) => x.isActive)
                .map((x) => ({ value: x.databaseId ?? x.id, label: x.name }))}
              onValueChange={setScopeId}
            />
          )}
          {scope === "Employees" && (
            <div className="space-y-2">
              <SearchableSelect
                aria-label="Add employee"
                value=""
                placeholder="Search and add employees"
                options={options.filter((o) => !employeeIds.includes(o.value))}
                onValueChange={(id) => setIds((ids) => [...ids, id])}
              />
              <div className="flex flex-wrap gap-2">
                {employeeIds.map((id) => (
                  <Button
                    variant="outline"
                    key={id}
                    onClick={() => setIds((ids) => ids.filter((x) => x !== id))}
                  >
                    {options.find((o) => o.value === id)?.label} ×
                  </Button>
                ))}
              </div>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            {kind === "Excused closure"
              ? "Excused time is credited, but is not marked as work performed."
              : "Counts as a full working day, including the configured break."}{" "}
            Leave, holidays and rest days are not replaced. Timesheets still need approval.
          </p>
          <Button
            disabled={
              busy ||
              title.trim().length < 3 ||
              !startDate ||
              (scope === "Employees" && !employeeIds.length) ||
              (["Location", "Department"].includes(scope) && !scopeId)
            }
            onClick={() => save()}
          >
            {busy ? "Saving…" : "Save office exception"}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Recorded exceptions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {query.isError ? (
            <Button variant="outline" onClick={() => query.refetch()}>
              Could not load exceptions. Retry
            </Button>
          ) : query.isPending ? (
            <p>Loading…</p>
          ) : !query.data?.length ? (
            <p className="text-sm text-muted-foreground">No office exceptions yet.</p>
          ) : (
            query.data.map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div>
                  <p className="font-medium">{row.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {row.startDate} – {row.endDate} · {row.kind} · {row.employeeIds.length}{" "}
                    employees{row.archivedAt ? " · Cancelled" : ""}
                  </p>
                </div>
                {!row.archivedAt && (
                  <ConfirmAction
                    title="Cancel this office exception?"
                    description="Attendance credits will be withdrawn. Original punches and approved timesheets are kept. HR must review any affected approved timesheet separately."
                    confirmLabel="Cancel exception"
                    onConfirm={async () => {
                      await cancelOfficeExceptionFn({ data: { actor, id: row.id } });
                      await refresh();
                    }}
                  >
                    <Button variant="outline">Cancel exception</Button>
                  </ConfirmAction>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
