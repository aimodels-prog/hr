import { useEffect, useMemo, useState } from "react";
import { format, isAfter, startOfDay, subDays } from "date-fns";
import {
  Activity,
  AlertTriangle,
  Bot,
  ChevronRight,
  FilterX,
  Search,
  UserRound,
} from "lucide-react";

import { useCurrentUser } from "@/lib/auth";
import { getApplicationDataServices } from "@/lib/data/application-data";
import {
  getAuditActivity,
  getAuditActivityGroup,
  getAuditArea,
  getAuditChanges,
  getAuditOutcome,
  getAuditRecordLabel,
  getAuditSummary,
  humanizeAuditText,
  isAutomatedAuditEvent,
  type AuditActivityGroup,
  type AuditNameLookup,
} from "@/lib/data/audit-presentation";
import type { AuditEvent, Candidate, Employee, User } from "@/lib/data/types";
import type { LeavePolicy } from "@/lib/data/leave-types";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTableShell } from "@/components/ui/data-table-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface AuditViewerProps {
  entityId?: string;
  entityType?: string;
  global?: boolean;
}

type ActivitySource = "people" | "automated" | "all";
const PAGE_SIZE = 15;
const DATE_WINDOWS = { all: undefined, today: 0, week: 7, month: 30, quarter: 90 } as const;

function createNameLookup(): AuditNameLookup {
  const { storage } = getApplicationDataServices();
  const employees = storage.readCollection<Employee>("employees");
  const candidates = storage.readCollection<Candidate>("candidates");
  const policies = storage.readCollection<LeavePolicy>("leave_policies");
  const users = storage.readCollection<User>("users");
  return {
    employees: Object.fromEntries(employees.map((item) => [item.id, item.legalName])),
    candidates: Object.fromEntries(
      candidates.map((item) => [item.id, `${item.firstName} ${item.lastName}`.trim()]),
    ),
    policies: Object.fromEntries(policies.map((item) => [item.id, item.name])),
    users: Object.fromEntries(users.map((item) => [item.id, item.displayName])),
  };
}

function sourceLabel(source: ActivitySource): string {
  return source === "people"
    ? "People activity"
    : source === "automated"
      ? "Automated activity"
      : "All activity";
}

function riskClasses(risk: AuditEvent["riskLevel"]): string {
  if (risk === "High" || risk === "Critical") return "border-rose-200 bg-rose-50 text-rose-700";
  if (risk === "Medium") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export function AuditViewer({ entityId, entityType, global }: AuditViewerProps) {
  const currentUser = useCurrentUser();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loadError, setLoadError] = useState("");
  const [integrityIssueCount, setIntegrityIssueCount] = useState(0);
  const [lookup, setLookup] = useState<AuditNameLookup>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [source, setSource] = useState<ActivitySource>(global ? "people" : "all");
  const [actor, setActor] = useState("all");
  const [role, setRole] = useState("all");
  const [area, setArea] = useState("all");
  const [action, setAction] = useState("all");
  const [entity, setEntity] = useState("all");
  const [activityGroup, setActivityGroup] = useState<AuditActivityGroup | "all">("all");
  const [risk, setRisk] = useState("all");
  const [dateWindow, setDateWindow] = useState<keyof typeof DATE_WINDOWS>("month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);

  useEffect(() => {
    try {
      const audit = getApplicationDataServices().audit;
      const allEvents = audit.listForContext(currentUser.getActorContext(), {
        global: Boolean(global),
        ...(global ? {} : { entityId, entityType }),
      });
      setEvents(
        allEvents.sort(
          (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
        ),
      );
      setLookup(createNameLookup());
      setLoadError("");
      setIntegrityIssueCount(
        global ? audit.checkIntegrity(currentUser.getActorContext()).length : 0,
      );
    } catch (error) {
      setEvents([]);
      setLoadError(error instanceof Error ? error.message : "Audit history could not be loaded.");
    }
  }, [currentUser, entityId, entityType, global]);

  useEffect(
    () => setPage(1),
    [
      searchTerm,
      source,
      actor,
      role,
      area,
      action,
      entity,
      activityGroup,
      risk,
      dateWindow,
      dateFrom,
      dateTo,
    ],
  );

  const actors = useMemo(
    () =>
      Array.from(new Map(events.map((event) => [event.actor.userId, event.actor.displayName])))
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [events],
  );
  const roles = useMemo(
    () =>
      Array.from(
        new Set(
          events.map((event) => event.actor.activeRole ?? event.actor.roles[0] ?? "Employee"),
        ),
      ).sort(),
    [events],
  );

  const areas = useMemo(
    () => Array.from(new Set(events.map(getAuditArea))).sort((a, b) => a.localeCompare(b)),
    [events],
  );
  const actions = useMemo(
    () => Array.from(new Set(events.map(getAuditActivity))).sort((a, b) => a.localeCompare(b)),
    [events],
  );
  const entities = useMemo(
    () => Array.from(new Set(events.map((event) => event.entityType))).sort(),
    [events],
  );

  const filteredEvents = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    const days = DATE_WINDOWS[dateWindow];
    const threshold = days === undefined ? undefined : startOfDay(subDays(new Date(), days));
    return events.filter((event) => {
      const automated = isAutomatedAuditEvent(event);
      if (source === "people" && automated) return false;
      if (source === "automated" && !automated) return false;
      if (actor !== "all" && event.actor.userId !== actor) return false;
      if (role !== "all" && (event.actor.activeRole ?? event.actor.roles[0] ?? "Employee") !== role)
        return false;
      if (area !== "all" && getAuditArea(event) !== area) return false;
      if (action !== "all" && getAuditActivity(event) !== action) return false;
      if (entity !== "all" && event.entityType !== entity) return false;
      if (activityGroup !== "all" && getAuditActivityGroup(event) !== activityGroup) return false;
      if (risk !== "all" && event.riskLevel !== risk) return false;
      if (threshold && !isAfter(new Date(event.occurredAt), threshold)) return false;
      const eventDate = event.occurredAt.slice(0, 10);
      if (dateFrom && eventDate < dateFrom) return false;
      if (dateTo && eventDate > dateTo) return false;
      if (!search) return true;
      return [
        event.actor.displayName,
        getAuditActivity(event),
        getAuditArea(event),
        getAuditRecordLabel(event, lookup),
        getAuditSummary(event, lookup),
        event.reason ?? "",
      ].some((value) => value.toLowerCase().includes(search));
    });
  }, [
    action,
    activityGroup,
    actor,
    area,
    dateFrom,
    dateTo,
    dateWindow,
    entity,
    events,
    lookup,
    risk,
    role,
    searchTerm,
    source,
  ]);

  if (!currentUser) return null;
  const canSeeFinancial = currentUser.can("payroll:view");
  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visibleEvents = filteredEvents.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const selectedChanges = selectedEvent ? getAuditChanges(selectedEvent, canSeeFinancial) : [];
  const hasFilters = Boolean(
    searchTerm ||
    actor !== "all" ||
    role !== "all" ||
    area !== "all" ||
    action !== "all" ||
    entity !== "all" ||
    activityGroup !== "all" ||
    risk !== "all" ||
    dateWindow !== "month" ||
    dateFrom ||
    dateTo,
  );

  const resetFilters = () => {
    setSearchTerm("");
    setActor("all");
    setRole("all");
    setArea("all");
    setAction("all");
    setEntity("all");
    setActivityGroup("all");
    setRisk("all");
    setDateWindow("month");
    setDateFrom("");
    setDateTo("");
  };

  return (
    <>
      {loadError && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Audit history unavailable</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}
      {global && integrityIssueCount > 0 && (
        <Alert className="mb-4 border-amber-300 bg-amber-50">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Audit records need attention</AlertTitle>
          <AlertDescription>
            {integrityIssueCount} record{integrityIssueCount === 1 ? "" : "s"} contain missing or
            unresolved references. The records remain preserved for investigation.
          </AlertDescription>
        </Alert>
      )}
      <Card className="overflow-hidden border-border/80 shadow-sm">
        <CardHeader className="border-b bg-card px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Activity className="h-5 w-5 text-primary" />
                Recorded activity
              </CardTitle>
              <CardDescription className="mt-1">
                Review important actions, approvals and access decisions across VIA HR System.
              </CardDescription>
            </div>
            <Tabs value={source} onValueChange={(value) => setSource(value as ActivitySource)}>
              <TabsList className="grid w-full grid-cols-3 sm:w-auto">
                <TabsTrigger value="people">
                  <UserRound className="mr-1.5 h-3.5 w-3.5" />
                  People
                </TabsTrigger>
                <TabsTrigger value="automated">
                  <Bot className="mr-1.5 h-3.5 w-3.5" />
                  Automated
                </TabsTrigger>
                <TabsTrigger value="all">All</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="relative md:col-span-2 xl:col-span-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search audit history"
                placeholder="Search person, activity or record"
                className="pl-9"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
            <Select value={actor} onValueChange={setActor}>
              <SelectTrigger aria-label="Filter by person">
                <SelectValue placeholder="All people" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All people</SelectItem>
                {actors.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger aria-label="Filter by role">
                <SelectValue placeholder="All roles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                {roles.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={area} onValueChange={setArea}>
              <SelectTrigger aria-label="Filter by area">
                <SelectValue placeholder="All areas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All areas</SelectItem>
                {areas.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger aria-label="Filter by recorded action">
                <SelectValue placeholder="All recorded actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All recorded actions</SelectItem>
                {actions.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={entity} onValueChange={setEntity}>
              <SelectTrigger aria-label="Filter by record type">
                <SelectValue placeholder="All record types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All record types</SelectItem>
                {entities.map((item) => (
                  <SelectItem key={item} value={item}>
                    {humanizeAuditText(item)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={activityGroup}
              onValueChange={(value) => setActivityGroup(value as AuditActivityGroup | "all")}
            >
              <SelectTrigger aria-label="Filter by activity">
                <SelectValue placeholder="All activities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All activities</SelectItem>
                <SelectItem value="Approval">Approvals</SelectItem>
                <SelectItem value="Change">Changes</SelectItem>
                <SelectItem value="Access">Access</SelectItem>
                <SelectItem value="Export">Exports</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="date"
              aria-label="Audit history from date"
              value={dateFrom}
              onChange={(event) => {
                setDateFrom(event.target.value);
                if (event.target.value) setDateWindow("all");
              }}
            />
            <Input
              type="date"
              aria-label="Audit history to date"
              value={dateTo}
              onChange={(event) => {
                setDateTo(event.target.value);
                if (event.target.value) setDateWindow("all");
              }}
            />
            <Select value={risk} onValueChange={setRisk}>
              <SelectTrigger aria-label="Filter by attention level">
                <SelectValue placeholder="All levels" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All attention levels</SelectItem>
                <SelectItem value="High">High attention</SelectItem>
                <SelectItem value="Critical">Critical attention</SelectItem>
                <SelectItem value="Medium">Medium attention</SelectItem>
                <SelectItem value="Low">Routine</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={dateWindow}
              onValueChange={(value) => setDateWindow(value as keyof typeof DATE_WINDOWS)}
            >
              <SelectTrigger aria-label="Filter by date">
                <SelectValue placeholder="Last 30 days" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="week">Last 7 days</SelectItem>
                <SelectItem value="month">Last 30 days</SelectItem>
                <SelectItem value="quarter">Last 90 days</SelectItem>
                <SelectItem value="all">All dates</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Clear filters"
              title="Clear filters"
              disabled={!hasFilters}
              onClick={resetFilters}
            >
              <FilterX className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {visibleEvents.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={Activity}
                title="No matching activity"
                description={`No ${sourceLabel(source).toLowerCase()} matches the selected filters.`}
                action={
                  hasFilters ? (
                    <Button variant="outline" onClick={resetFilters}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <>
              <DataTableShell className="hidden rounded-none border-0 shadow-none md:block">
                <Table>
                  <TableHeader className="bg-muted/35">
                    <TableRow>
                      <TableHead className="w-[150px] pl-6">Date and time</TableHead>
                      <TableHead className="w-[190px]">Person</TableHead>
                      <TableHead>Activity</TableHead>
                      <TableHead className="w-[150px]">Area</TableHead>
                      <TableHead className="w-[160px]">Record</TableHead>
                      <TableHead className="w-[110px]">Result</TableHead>
                      <TableHead className="w-12">
                        <span className="sr-only">View details</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleEvents.map((event) => {
                      const automated = isAutomatedAuditEvent(event);
                      return (
                        <TableRow
                          key={event.id}
                          className="cursor-pointer"
                          tabIndex={0}
                          onClick={() => setSelectedEvent(event)}
                          onKeyDown={(keyEvent) => {
                            if (keyEvent.key === "Enter" || keyEvent.key === " ") {
                              keyEvent.preventDefault();
                              setSelectedEvent(event);
                            }
                          }}
                        >
                          <TableCell className="pl-6">
                            <div className="font-medium">
                              {format(new Date(event.occurredAt), "d MMM yyyy")}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {format(new Date(event.occurredAt), "h:mm a")}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2.5">
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/8 text-primary">
                                {automated ? (
                                  <Bot className="h-4 w-4" />
                                ) : (
                                  <UserRound className="h-4 w-4" />
                                )}
                              </span>
                              <div className="min-w-0">
                                <div className="truncate font-medium">
                                  {automated ? "VIA HR System" : event.actor.displayName}
                                </div>
                                <div className="truncate text-xs text-muted-foreground">
                                  {automated
                                    ? "Automated"
                                    : (event.actor.activeRole ??
                                      event.actor.roles[0] ??
                                      "Employee")}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{getAuditActivity(event)}</div>
                            <div className="mt-0.5 line-clamp-1 max-w-[420px] text-xs text-muted-foreground">
                              {getAuditSummary(event, lookup)}
                            </div>
                          </TableCell>
                          <TableCell>{getAuditArea(event)}</TableCell>
                          <TableCell
                            className="max-w-[160px] truncate"
                            title={getAuditRecordLabel(event, lookup)}
                          >
                            {getAuditRecordLabel(event, lookup)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={getAuditOutcome(event)} />
                          </TableCell>
                          <TableCell>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </DataTableShell>

              <div className="divide-y md:hidden">
                {visibleEvents.map((event) => (
                  <button
                    type="button"
                    key={event.id}
                    className="flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    onClick={() => setSelectedEvent(event)}
                  >
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/8 text-primary">
                      {isAutomatedAuditEvent(event) ? (
                        <Bot className="h-4 w-4" />
                      ) : (
                        <UserRound className="h-4 w-4" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-3">
                        <span className="font-medium">{getAuditActivity(event)}</span>
                        <StatusBadge status={getAuditOutcome(event)} className="shrink-0" />
                      </span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {getAuditRecordLabel(event, lookup)} · {getAuditArea(event)}
                      </span>
                      <span className="mt-2 block text-xs text-muted-foreground">
                        {event.actor.displayName} ·{" "}
                        {format(new Date(event.occurredAt), "d MMM yyyy, h:mm a")}
                      </span>
                    </span>
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-3 border-t px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Showing {(safePage - 1) * PAGE_SIZE + 1}–
                  {Math.min(safePage * PAGE_SIZE, filteredEvents.length)} of {filteredEvents.length}
                </p>
                <Pagination className="mx-0 w-auto justify-start sm:justify-end">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        href="#"
                        aria-disabled={safePage === 1}
                        className={safePage === 1 ? "pointer-events-none opacity-50" : undefined}
                        onClick={(event) => {
                          event.preventDefault();
                          setPage((value) => Math.max(1, value - 1));
                        }}
                      />
                    </PaginationItem>
                    <PaginationItem>
                      <span className="px-3 text-sm font-medium">
                        Page {safePage} of {totalPages}
                      </span>
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationNext
                        href="#"
                        aria-disabled={safePage === totalPages}
                        className={
                          safePage === totalPages ? "pointer-events-none opacity-50" : undefined
                        }
                        onClick={(event) => {
                          event.preventDefault();
                          setPage((value) => Math.min(totalPages, value + 1));
                        }}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Sheet open={Boolean(selectedEvent)} onOpenChange={(open) => !open && setSelectedEvent(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          {selectedEvent && (
            <div className="space-y-6">
              <SheetHeader className="pr-8">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={getAuditOutcome(selectedEvent)} />
                  <Badge variant="outline" className={riskClasses(selectedEvent.riskLevel)}>
                    {selectedEvent.riskLevel === "Low"
                      ? "Routine"
                      : `${selectedEvent.riskLevel} attention`}
                  </Badge>
                </div>
                <SheetTitle className="pt-2 text-xl">{getAuditActivity(selectedEvent)}</SheetTitle>
                <SheetDescription>{getAuditSummary(selectedEvent, lookup)}</SheetDescription>
              </SheetHeader>
              <div className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border bg-muted/20 p-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Performed by</p>
                  <p className="mt-1 font-medium">
                    {isAutomatedAuditEvent(selectedEvent)
                      ? "VIA HR System"
                      : selectedEvent.actor.displayName}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Role</p>
                  <p className="mt-1 font-medium">
                    {isAutomatedAuditEvent(selectedEvent)
                      ? "Automated"
                      : (selectedEvent.actor.activeRole ??
                        selectedEvent.actor.roles[0] ??
                        "Employee")}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Date</p>
                  <p className="mt-1 font-medium">
                    {format(new Date(selectedEvent.occurredAt), "d MMMM yyyy")}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Time</p>
                  <p className="mt-1 font-medium">
                    {format(new Date(selectedEvent.occurredAt), "h:mm:ss a")}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Area</p>
                  <p className="mt-1 font-medium">{getAuditArea(selectedEvent)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Record</p>
                  <p className="mt-1 font-medium">{getAuditRecordLabel(selectedEvent, lookup)}</p>
                </div>
              </div>
              {selectedEvent.reason && (
                <section>
                  <h3 className="text-sm font-semibold">Reason or note</h3>
                  <p className="mt-2 rounded-lg border-l-4 border-primary/40 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                    {selectedEvent.reason}
                  </p>
                </section>
              )}
              <section>
                <h3 className="text-sm font-semibold">What changed</h3>
                {selectedChanges.length === 0 ? (
                  <p className="mt-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    This activity did not change any record fields.
                  </p>
                ) : (
                  <div className="mt-2 divide-y overflow-hidden rounded-xl border">
                    {selectedChanges.map((change) => (
                      <div
                        key={change.field}
                        className="grid gap-2 p-4 text-sm sm:grid-cols-[140px_1fr]"
                      >
                        <div className="font-medium">{change.field}</div>
                        <div>
                          {change.kind === "changed" && (
                            <div className="text-muted-foreground">
                              <span className="mr-2 text-xs uppercase tracking-wide">From</span>
                              {change.before}
                            </div>
                          )}
                          {change.kind === "removed" && (
                            <div className="text-muted-foreground">
                              <span className="mr-2 text-xs uppercase tracking-wide">Removed</span>
                              {change.before}
                            </div>
                          )}
                          {change.after && (
                            <div
                              className={
                                change.kind === "changed" ? "mt-1 font-medium" : "font-medium"
                              }
                            >
                              <span className="mr-2 text-xs uppercase tracking-wide text-muted-foreground">
                                {change.kind === "added" ? "Added" : "To"}
                              </span>
                              {change.after}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              <Separator />
              <details className="rounded-xl border bg-muted/15 p-4">
                <summary className="cursor-pointer text-sm font-medium">Audit reference</summary>
                <dl className="mt-4 grid gap-3 break-all text-xs text-muted-foreground">
                  <div>
                    <dt className="font-medium text-foreground">Reference</dt>
                    <dd className="mt-1">{selectedEvent.id}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-foreground">Record reference</dt>
                    <dd className="mt-1">{selectedEvent.entityId}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-foreground">Recorded action</dt>
                    <dd className="mt-1">{humanizeAuditText(selectedEvent.action)}</dd>
                  </div>
                </dl>
              </details>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
