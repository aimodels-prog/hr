import { SearchableSelect } from "@/components/ui/searchable-select";
import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmployeeService } from "@/lib/data/employee-service";
import { SettingsService } from "@/lib/data/settings-service";
import { employmentCalendarDate } from "@/lib/data/employment-change-policy";
import { buildOrganisationForest } from "@/lib/data/org-chart-layout";
import {
  getOrganisationChartHeadFn,
  saveOrganisationChartHeadFn,
} from "@/lib/server-functions/org-chart.server";
import { OrgChartTree } from "@/components/org-chart-tree";
import { Crown, Minus, Plus, Search, Settings2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/staff/org-chart")({ component: OrgChartRoute });

function OrgChartRoute() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const service = useMemo(() => new EmployeeService(), []);
  const [, refresh] = useState(0);
  const people = service.getDirectoryEmployees(user.getActorContext(), { includeArchived: false });
  const actor = {
    actorId: user.id,
    ...(user.workspaceEmail ? { actorEmail: user.workspaceEmail } : {}),
    activeRole: user.activeRole,
  };
  const headQuery = useQuery({
    queryKey: ["organisation-chart-head", user.id, user.activeRole],
    queryFn: () => getOrganisationChartHeadFn({ data: actor }),
    staleTime: 0,
  });
  const headId =
    people.find((person) => (person.databaseId ?? person.id) === headQuery.data?.employeeId)?.id ??
    null;
  const forest = buildOrganisationForest(people, headId);
  const [query, setQuery] = useState("");
  const [zoom, setZoom] = useState(100);
  const [expanded, setExpanded] = useState(true);
  const [treeVersion, setTreeVersion] = useState(0);
  const [editing, setEditing] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [supervisorId, setSupervisorId] = useState("none");
  const [selectedHead, setSelectedHead] = useState("");
  const [saving, setSaving] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const canvas = viewport.current;
    const head = canvas?.querySelector('[data-company-head="true"]');
    if (!canvas || !head) return;
    const card = head.getBoundingClientRect();
    const frame = canvas.getBoundingClientRect();
    canvas.scrollLeft += card.left + card.width / 2 - frame.left - canvas.clientWidth / 2;
  }, [headId, zoom, treeVersion, query]);
  const canManage = user.permissions.has("employee:manage_all");
  const normalized = query.trim().toLowerCase();
  const matches = new Set(
    people
      .filter(
        (person) =>
          normalized &&
          [
            person.preferredName,
            person.legalName,
            person.position,
            person.department,
            person.location,
          ].some((value) => value?.toLowerCase().includes(normalized)),
      )
      .map((person) => person.id),
  );
  const kept = new Set<string>();
  const visit = (id: string): boolean => {
    const descendantMatch = (forest.children.get(id) ?? [])
      .map((person) => visit(person.id))
      .some(Boolean);
    if (!normalized || matches.has(id) || descendantMatch) {
      kept.add(id);
      return true;
    }
    return false;
  };
  forest.roots.forEach((person) => visit(person.id));
  const visibleChildren = new Map(
    [...forest.children].map(([id, children]) => [
      id,
      children.filter((child) => kept.has(child.id)),
    ]),
  );
  const otherRoots = forest.roots.filter((person) => person.id !== headId && kept.has(person.id));
  const openRecord = canManage
    ? (id: string) => {
        void navigate({ to: "/staff/employees/$employeeId", params: { employeeId: id } });
      }
    : undefined;
  const saveHead = async () => {
    if (!headQuery.data) return;
    setSaving(true);
    try {
      const selected = people.find((person) => person.id === selectedHead);
      await saveOrganisationChartHeadFn({
        data: {
          actor,
          employeeId: selected ? (selected.databaseId ?? selected.id) : null,
          previousEmployeeId: headQuery.data.employeeId,
        },
      });
      await headQuery.refetch();
      setQuery("");
      setTreeVersion((value) => value + 1);
      toast.success("Company head saved. Reporting lines are unchanged.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save company head.");
      await headQuery.refetch();
    } finally {
      setSaving(false);
    }
  };
  const saveReporting = async () => {
    if (!employeeId) return;
    setSaving(true);
    try {
      const result = await service.updateEmploymentRecordAsync(
        employeeId,
        { lineManagerId: supervisorId === "none" ? null : supervisorId },
        employmentCalendarDate(new SettingsService().getAppSettingsSync().timezone),
        "Reporting line updated by HR",
        user.getActorContext(),
      );
      user.refreshRecords();
      refresh((value) => value + 1);
      setQuery("");
      setTreeVersion((value) => value + 1);
      toast.success(
        result.status === "Scheduled"
          ? "Reporting line change scheduled."
          : "Reporting line saved.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save reporting line.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <RequirePermission permission="employee:view_directory" resourceName="Organisation Chart">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PageHeader title="Organisation chart" />
          {canManage && (
            <Button
              onClick={() => {
                setSelectedHead(headId ?? "none");
                setEditing(true);
              }}
              disabled={!headQuery.data}
            >
              <Settings2 className="mr-2 h-4 w-4" />
              Arrange chart
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
          <div className="relative min-w-48 flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              aria-label="Search organisation chart"
              placeholder="Find a colleague or team"
              className="pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setExpanded(!expanded);
              setTreeVersion((value) => value + 1);
            }}
          >
            {expanded ? "Collapse teams" : "Expand teams"}
          </Button>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Zoom out"
              disabled={zoom <= 40}
              onClick={() => setZoom(Math.max(40, zoom - 10))}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <button
              type="button"
              className="min-w-12 text-sm tabular-nums"
              aria-label="Reset zoom"
              onClick={() => setZoom(100)}
            >
              {zoom}%
            </button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Zoom in"
              disabled={zoom >= 130}
              onClick={() => setZoom(Math.min(130, zoom + 10))}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {headQuery.isError && (
          <div role="alert" className="rounded-xl border p-4 text-sm">
            Company-head settings could not load.{" "}
            <button
              type="button"
              className="text-primary underline"
              onClick={() => void headQuery.refetch()}
            >
              Retry
            </button>
          </div>
        )}
        {headQuery.data && !forest.head && (
          <p className="text-sm text-muted-foreground">
            {headQuery.data.employeeId
              ? "The saved company head is no longer in the directory."
              : "Company head not set."}
            {canManage && " Select Arrange chart to choose one."}
          </p>
        )}
        <div
          ref={viewport}
          tabIndex={0}
          role="region"
          aria-label="Organisation hierarchy — scroll to explore"
          className="max-h-[75vh] min-h-96 overflow-auto rounded-xl border bg-muted/20 p-6 sm:p-10"
        >
          {normalized && matches.size === 0 ? (
            <p className="py-20 text-center text-sm text-muted-foreground">
              No matching colleagues.
            </p>
          ) : (
            <div
              key={`${treeVersion}-${normalized}`}
              className="mx-auto flex w-max min-w-full flex-col items-center gap-12"
              style={{ zoom: zoom / 100 }}
            >
              {forest.head && kept.has(forest.head.id) && (
                <OrgChartTree
                  person={forest.head}
                  childrenByManager={visibleChildren}
                  headId={headId}
                  matches={matches}
                  expandAll={normalized ? true : expanded}
                  {...(openRecord ? { onOpen: openRecord } : {})}
                />
              )}
              {otherRoots.length > 0 && (
                <section className="flex flex-col items-center gap-6">
                  {forest.head && (
                    <p className="rounded-full border border-dashed px-4 py-2 text-xs text-muted-foreground">
                      Other teams · no reporting link to company head
                    </p>
                  )}
                  <div className="flex items-start gap-10">
                    {otherRoots.map((person) => (
                      <OrgChartTree
                        key={person.id}
                        person={person}
                        childrenByManager={visibleChildren}
                        headId={headId}
                        matches={matches}
                        expandAll={normalized ? true : expanded}
                        {...(openRecord ? { onOpen: openRecord } : {})}
                      />
                    ))}
                  </div>
                </section>
              )}
              {people.length === 0 && (
                <p className="py-20 text-sm text-muted-foreground">No employees to display.</p>
              )}
            </div>
          )}
        </div>
        <Dialog
          open={editing}
          onOpenChange={(open) => {
            if (!saving) setEditing(open);
          }}
        >
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Arrange chart</DialogTitle>
              <DialogDescription>
                Choose the company head or update a reporting line.
              </DialogDescription>
            </DialogHeader>
            <fieldset disabled={saving} className="space-y-3 rounded-xl border p-4">
              <Label className="flex items-center gap-2">
                <Crown className="h-4 w-4 text-primary" />
                Company head
              </Label>
              <SearchableSelect
                value={selectedHead}
                onValueChange={setSelectedHead}
                disabled={saving}
                aria-label="Company head"
                placeholder={"Choose company head"}
                options={[
                  { value: "none", label: "Not set" },
                  ...people.map((person) => ({
                    value: person.id,
                    label: `${person.preferredName} · ${person.employeeNumber}`,
                    keywords: [person.legalName, person.workEmail, person.position],
                  })),
                ]}
              />
              <p className="text-xs text-muted-foreground">
                Shown at the top. Supervisors and approvals stay unchanged.
              </p>
              <Button
                onClick={() => void saveHead()}
                disabled={saving || !headQuery.data || selectedHead === (headId ?? "none")}
              >
                Save company head
              </Button>
            </fieldset>
            <fieldset disabled={saving} className="space-y-3 rounded-xl border p-4">
              <Label>Reporting line</Label>
              <SearchableSelect
                value={employeeId}
                onValueChange={(id) => {
                  setEmployeeId(id);
                  setSupervisorId(
                    people.find((person) => person.id === id)?.lineManagerId ?? "none",
                  );
                }}
                disabled={saving}
                aria-label="Employee to arrange"
                placeholder={"Choose employee"}
                options={[
                  ...people.map((person) => ({
                    value: person.id,
                    label: `${person.preferredName} · ${person.employeeNumber}`,
                    keywords: [person.legalName, person.workEmail, person.position],
                  })),
                ]}
              />
              <SearchableSelect
                value={supervisorId}
                onValueChange={setSupervisorId}
                disabled={!employeeId || saving}
                aria-label="Reports to"
                placeholder={"Reports to"}
                options={[
                  { value: "none", label: "No supervisor" },
                  ...people
                    .filter((person) => person.id !== employeeId)
                    .map((person) => ({
                      value: person.id,
                      label: `${person.preferredName} · ${person.employeeNumber}`,
                      keywords: [person.legalName, person.workEmail, person.position],
                    })),
                ]}
              />
              <p className="text-xs text-muted-foreground">
                Changes the employee's supervisor and approval routing.
              </p>
              <Button
                variant="outline"
                onClick={() => void saveReporting()}
                disabled={!employeeId || saving}
              >
                Save reporting line
              </Button>
            </fieldset>
          </DialogContent>
        </Dialog>
      </div>
    </RequirePermission>
  );
}
