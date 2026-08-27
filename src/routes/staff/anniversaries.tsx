import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnniversaryService, type UpcomingAnniversary } from "@/lib/data/anniversary-service";
import { EmployeeService } from "@/lib/data/employee-service";
import { PartyPopper, CalendarClock, CalendarDays, History } from "lucide-react";
import { format } from "date-fns";

export const Route = createFileRoute("/staff/anniversaries")({
  component: AnniversariesRoute,
});

function bucketFor(entry: UpcomingAnniversary): "past" | "week" | "month" | "quarter" {
  if (entry.daysRemaining < 0) return "past";
  if (entry.daysRemaining <= 7) return "week";
  if (entry.daysRemaining <= 30) return "month";
  return "quarter";
}

function daysLabel(daysRemaining: number): string {
  if (daysRemaining === 0) return "Today";
  if (daysRemaining < 0) {
    const days = Math.abs(daysRemaining);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }
  return `In ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}`;
}

function AnniversariesRoute() {
  const currentUser = useCurrentUser();
  const anniversaryService = useMemo(() => new AnniversaryService(), []);
  const employeeService = useMemo(() => new EmployeeService(), []);
  const managerNameById = useMemo(() => {
    const employees = employeeService.getEmployeeRepository().list({ includeArchived: true });
    return new Map(employees.map((e) => [e.id, e.preferredName]));
  }, [employeeService]);

  // Runs on every visit - each notification is deduplicated per employee/milestone/threshold,
  // so this is safe to re-run without spamming anyone.
  useEffect(() => {
    if (currentUser) {
      anniversaryService.runReminderEngine(currentUser.getActorContext()).catch(console.error);
    }
  }, [currentUser, anniversaryService]);

  const entries = useMemo(
    () => anniversaryService.getUpcomingAnniversaries(90, 14),
    [anniversaryService],
  );

  const buckets = useMemo(() => {
    const grouped: Record<"past" | "week" | "month" | "quarter", UpcomingAnniversary[]> = {
      past: [],
      week: [],
      month: [],
      quarter: [],
    };
    for (const entry of entries) grouped[bucketFor(entry)].push(entry);
    return grouped;
  }, [entries]);

  const milestoneCount = entries.filter((e) => e.isMilestone && e.daysRemaining >= 0).length;

  const [activeTab, setActiveTab] = useState<"week" | "month" | "quarter" | "past">("week");
  const activeEntries = buckets[activeTab];

  return (
    <RequirePermission permission="employee:manage_all" resourceName="Work Anniversaries">
      <div className="flex flex-col gap-6 max-w-[1400px] mx-auto pb-10">
        <PageHeader
          title="Work Anniversaries"
          description="Upcoming tenure milestones across VIA, so recognition never gets missed."
          breadcrumbs={[{ label: "Core HR" }, { label: "Work Anniversaries" }]}
        />

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-primary/5 border-primary/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-primary flex items-center">
                <PartyPopper className="mr-2 h-4 w-4" /> Milestones Upcoming
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-primary">{milestoneCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center">
                <CalendarClock className="mr-2 h-4 w-4" /> This Week
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{buckets.week.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center">
                <CalendarDays className="mr-2 h-4 w-4" /> Next 90 Days
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                {buckets.week.length + buckets.month.length + buckets.quarter.length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center">
                <History className="mr-2 h-4 w-4" /> Recently Celebrated
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{buckets.past.length}</div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
          <TabsList className="mb-4">
            <TabsTrigger value="week">This Week ({buckets.week.length})</TabsTrigger>
            <TabsTrigger value="month">Next 30 Days ({buckets.month.length})</TabsTrigger>
            <TabsTrigger value="quarter">Next 90 Days ({buckets.quarter.length})</TabsTrigger>
            <TabsTrigger value="past">Recently Celebrated ({buckets.past.length})</TabsTrigger>
          </TabsList>

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Manager</TableHead>
                  <TableHead>Milestone</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeEntries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      No anniversaries in this window.
                    </TableCell>
                  </TableRow>
                ) : (
                  activeEntries.map((entry) => (
                    <TableRow key={entry.employee.id}>
                      <TableCell>
                        <Link
                          to="/staff/employees/$employeeId"
                          params={{ employeeId: entry.employee.id }}
                          className="font-medium text-primary hover:underline"
                        >
                          {entry.employee.preferredName}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {entry.employee.employeeNumber}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{entry.employee.department}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {entry.employee.lineManagerId
                          ? managerNameById.get(entry.employee.lineManagerId) || "Unknown"
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {entry.isMilestone ? (
                          <Badge className="bg-primary/10 text-primary border-primary/20">
                            {entry.yearsOfService} year{entry.yearsOfService === 1 ? "" : "s"}
                          </Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            {entry.yearsOfService} year{entry.yearsOfService === 1 ? "" : "s"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {format(new Date(entry.anniversaryDate), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        {daysLabel(entry.daysRemaining)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </Tabs>
      </div>
    </RequirePermission>
  );
}
