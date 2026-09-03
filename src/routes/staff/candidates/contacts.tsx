import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import {
  Search,
  Calendar,
  PhoneCall,
  AlertTriangle,
  ShieldAlert,
  Clock,
  ArrowRight,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CandidateService } from "@/lib/data/candidate-service";
import { EmployeeService } from "@/lib/data/employee-service";
import { getProjectRepository } from "@/lib/data/master-data";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { RequirePermission, useCurrentUser } from "@/lib/auth";

export const Route = createFileRoute("/staff/candidates/contacts")({
  component: ContactsQueueWrapper,
});

function ContactsQueueWrapper() {
  return (
    <RequirePermission permission="recruitment:view_candidates" resourceName="Contact Queue">
      <ContactsQueue />
    </RequirePermission>
  );
}

// A follow-up landing on someone's desk right after another HR user already reached out is a
// real coordination risk (the candidate gets contacted twice, or a promised callback gets
// missed) - so anything contacted this recently is flagged regardless of which tab it's in.
const RECENT_CONTACT_CONFLICT_WINDOW_HOURS = 48;

function ContactsQueue() {
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const [candidateService] = useState(() => new CandidateService());
  const [empService] = useState(() => new EmployeeService());

  const queue = useMemo(
    () => candidateService.getContactQueue(currentUser.getActorContext()),
    [candidateService, currentUser],
  );
  const projects = useMemo(() => getProjectRepository().list(), []);
  const projectNameById = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const userById = useMemo(
    () =>
      new Map(empService.getUsers(currentUser.getActorContext()).map((u) => [u.id, u.displayName])),
    [empService, currentUser],
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("action-required");

  const filteredQueue = useMemo(() => {
    return queue.filter((item) => {
      const searchStr =
        `${item.firstName} ${item.lastName} ${item.email} ${item.phone} ${item.currentTitle || ""} ${item.currentCompany || ""} ${item.projectName || ""} ${item.projectType || ""} ${item.nationality || ""} ${item.trackerStatus || ""}`.toLowerCase();
      const matchesSearch = searchStr.includes(searchQuery.toLowerCase());
      const matchesProject = projectFilter === "all" || item.projectId === projectFilter;
      return matchesSearch && matchesProject;
    });
  }, [queue, searchQuery, projectFilter]);

  // Groupings
  const overdue = filteredQueue.filter((q) => q.queueStatus === "Overdue");
  const dueToday = filteredQueue.filter((q) => q.queueStatus === "Due Today");
  const upcoming = filteredQueue.filter((q) => q.queueStatus === "Upcoming");
  const recentlyContacted = filteredQueue.filter((q) => q.queueStatus === "Recently Contacted");
  const neverContacted = filteredQueue.filter((q) => q.queueStatus === "Never Contacted");
  const doNotContact = filteredQueue.filter((q) => q.queueStatus === "Do Not Contact");

  const actionRequired = [...overdue, ...dueToday];

  const renderTable = (items: typeof filteredQueue, emptyMsg: string) => (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Candidate</TableHead>
            <TableHead>Project</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>HR Owner</TableHead>
            <TableHead>Last Contact</TableHead>
            <TableHead>Next Follow-Up</TableHead>
            <TableHead>Contact Info</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                {emptyMsg}
              </TableCell>
            </TableRow>
          ) : (
            items.map((item) => (
              <TableRow key={item.id} className="hover:bg-muted/50">
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="h-9 w-9">
                      <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                        {item.firstName[0]}
                        {item.lastName[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        {item.firstName} {item.lastName}
                        {item.doNotContact && (
                          <div title="Do Not Contact">
                            <ShieldAlert className="h-4 w-4 text-destructive" />
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                        {item.currentTitle || "Candidate"}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {item.projectId || item.projectName ? (
                    <div>
                      <span className="text-sm">
                        {(item.projectId && projectNameById.get(item.projectId)) ||
                          item.projectName ||
                          "Unknown"}
                      </span>
                      {item.projectType && (
                        <span className="block text-xs text-muted-foreground">
                          {item.projectType}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-sm">&mdash;</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{item.stage}</Badge>
                  {item.trackerStatus && (
                    <div className="mt-1 text-xs text-muted-foreground">{item.trackerStatus}</div>
                  )}
                </TableCell>
                <TableCell>
                  {item.hrOwnerId ? (
                    <span className="text-sm">{userById.get(item.hrOwnerId) || "Unknown"}</span>
                  ) : (
                    <span className="text-muted-foreground text-sm">Unassigned</span>
                  )}
                </TableCell>
                <TableCell>
                  {item.latestContact ? (
                    <div className="flex flex-col text-sm">
                      <span className="flex items-center gap-1.5 font-medium">
                        {new Date(item.latestContact.date).toLocaleDateString()}
                        {Date.now() - new Date(item.latestContact.date).getTime() <
                          RECENT_CONTACT_CONFLICT_WINDOW_HOURS * 60 * 60 * 1000 && (
                          <span
                            title={`Contacted within the last ${RECENT_CONTACT_CONFLICT_WINDOW_HOURS} hours - check before reaching out again`}
                          >
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {item.latestContact.outcome}
                      </span>
                    </div>
                  ) : item.lastContactAt ? (
                    <span className="text-sm font-medium">{item.lastContactAt}</span>
                  ) : (
                    <span className="text-muted-foreground text-sm">Never</span>
                  )}
                </TableCell>
                <TableCell>
                  {item.pendingFollowUp ? (
                    <div className="flex items-center gap-2 text-sm">
                      <Calendar
                        className={`h-4 w-4 ${item.queueStatus === "Overdue" ? "text-destructive" : "text-primary"}`}
                      />
                      <span
                        className={`font-medium ${item.queueStatus === "Overdue" ? "text-destructive" : ""}`}
                      >
                        {new Date(item.pendingFollowUp.nextFollowUpDate!).toLocaleDateString()}
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-sm">None Scheduled</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="text-sm">
                    {item.phone && <div className="truncate max-w-[150px]">{item.phone}</div>}
                    {item.email && (
                      <div className="text-xs text-muted-foreground truncate max-w-[150px]">
                        {item.email}
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" asChild>
                    <Link
                      to="/staff/candidates/$candidateId"
                      params={{ candidateId: item.id }}
                      hash="contact"
                    >
                      View <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="flex h-full flex-col gap-6 p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold">Contact Queue</h1>
          <p className="text-sm text-muted-foreground">
            Track and manage upcoming candidate follow-ups.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-destructive/5 border-destructive/20">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-destructive">Overdue</p>
              <h3 className="text-2xl font-bold text-destructive">{overdue.length}</h3>
            </div>
            <AlertTriangle className="h-8 w-8 text-destructive/50" />
          </CardContent>
        </Card>
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-primary">Due Today</p>
              <h3 className="text-2xl font-bold text-primary">{dueToday.length}</h3>
            </div>
            <Clock className="h-8 w-8 text-primary/50" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Upcoming</p>
              <h3 className="text-2xl font-bold">{upcoming.length}</h3>
            </div>
            <Calendar className="h-8 w-8 text-muted-foreground/30" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Never Contacted</p>
              <h3 className="text-2xl font-bold">{neverContacted.length}</h3>
            </div>
            <PhoneCall className="h-8 w-8 text-muted-foreground/30" />
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search candidates..."
            className="pl-9 bg-background"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="w-[220px] bg-background">
            <SelectValue placeholder="All Projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
        <TabsList>
          <TabsTrigger value="action-required">
            Action Required{" "}
            <Badge variant="secondary" className="ml-2 bg-muted-foreground/20">
              {actionRequired.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
          <TabsTrigger value="recent">Recently Contacted</TabsTrigger>
          <TabsTrigger value="never">Never Contacted</TabsTrigger>
          <TabsTrigger value="dnc" className="text-destructive">
            Do Not Contact
          </TabsTrigger>
        </TabsList>

        <TabsContent value="action-required" className="mt-4">
          {renderTable(actionRequired, "No follow-ups due today or overdue.")}
        </TabsContent>

        <TabsContent value="upcoming" className="mt-4">
          {renderTable(upcoming, "No upcoming follow-ups scheduled.")}
        </TabsContent>

        <TabsContent value="recent" className="mt-4">
          {renderTable(recentlyContacted, "No recent contacts found.")}
        </TabsContent>

        <TabsContent value="never" className="mt-4">
          {renderTable(neverContacted, "All active candidates have been contacted.")}
        </TabsContent>

        <TabsContent value="dnc" className="mt-4">
          {renderTable(doNotContact, "No candidates marked as Do Not Contact.")}
        </TabsContent>
      </Tabs>
    </div>
  );
}
