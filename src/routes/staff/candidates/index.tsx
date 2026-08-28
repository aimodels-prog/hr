import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import {
  Search,
  Download,
  Filter,
  User,
  AlertTriangle,
  ShieldAlert,
  Archive,
  Upload,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { CandidateService } from "@/lib/data/candidate-service";
import { VacancyService } from "@/lib/data/vacancy-service";
import { EmployeeService } from "@/lib/data/employee-service";
import { getProjectRepository } from "@/lib/data/master-data";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { toast } from "sonner";

function recommenderKey(recommendation: {
  recommenderEmail: string;
  recommenderPhone?: string | undefined;
  recommenderName: string;
}) {
  return (
    recommendation.recommenderEmail.trim().toLowerCase() ||
    recommendation.recommenderPhone?.replace(/\D/g, "") ||
    recommendation.recommenderName.trim().toLowerCase()
  );
}

export const Route = createFileRoute("/staff/candidates/")({
  component: CandidatesIndexWrapper,
});

function CandidatesIndexWrapper() {
  return (
    <RequirePermission permission="recruitment:view_candidates" resourceName="Candidate Database">
      <CandidatesIndex />
    </RequirePermission>
  );
}

function CandidatesIndex() {
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const [candidateService] = useState(() => new CandidateService());
  const [vacancyService] = useState(() => new VacancyService());
  const [empService] = useState(() => new EmployeeService());
  const [refreshKey, setRefreshKey] = useState(0);

  const candidatesWithApps = useMemo(
    () => candidateService.getDetailedCandidates(currentUser.getActorContext()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candidateService, currentUser, refreshKey],
  );
  const vacancies = useMemo(() => vacancyService.getVacancyRepository().list(), [vacancyService]);
  const projects = useMemo(() => getProjectRepository().list(), []);
  const projectNameById = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const userById = useMemo(
    () =>
      new Map(empService.getUsers(currentUser.getActorContext()).map((u) => [u.id, u.displayName])),
    [empService],
  );

  const locations = useMemo(
    () => Array.from(new Set(candidatesWithApps.map((c) => c.location).filter(Boolean))).sort(),
    [candidatesWithApps],
  );
  const sources = useMemo(
    () =>
      Array.from(
        new Set(candidatesWithApps.map((c) => c.source).filter(Boolean)),
      ).sort() as string[],
    [candidatesWithApps],
  );
  const positions = useMemo(
    () =>
      Array.from(
        new Set(candidatesWithApps.map((candidate) => candidate.currentTitle).filter(Boolean)),
      ).sort() as string[],
    [candidatesWithApps],
  );
  const talentPools = useMemo(
    () =>
      Array.from(
        new Set(candidatesWithApps.flatMap((candidate) => candidate.talentPools || [])),
      ).sort(),
    [candidatesWithApps],
  );
  const nationalities = useMemo(
    () =>
      Array.from(
        new Set(candidatesWithApps.map((candidate) => candidate.nationality).filter(Boolean)),
      ).sort() as string[],
    [candidatesWithApps],
  );
  const visaStatuses = useMemo(
    () =>
      Array.from(
        new Set(candidatesWithApps.map((candidate) => candidate.visaStatus).filter(Boolean)),
      ).sort() as string[],
    [candidatesWithApps],
  );
  const ownerIds = useMemo(
    () =>
      Array.from(
        new Set(candidatesWithApps.map((candidate) => candidate.hrOwnerId).filter(Boolean)),
      ).sort() as string[],
    [candidatesWithApps],
  );
  const recommenders = useMemo(() => {
    const values = new Map<string, string>();
    for (const candidate of candidatesWithApps) {
      for (const recommendation of candidate.recommendations) {
        values.set(
          recommenderKey(recommendation),
          `${recommendation.recommenderName}${recommendation.recommenderCompany ? ` — ${recommendation.recommenderCompany}` : ""}`,
        );
      }
    }
    return Array.from(values.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [candidatesWithApps]);

  const [searchQuery, setSearchQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [positionFilter, setPositionFilter] = useState("all");
  const [talentPoolFilter, setTalentPoolFilter] = useState("all");
  const [nationalityFilter, setNationalityFilter] = useState("all");
  const [visaFilter, setVisaFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [recommenderFilter, setRecommenderFilter] = useState("all");
  const [followUpFilter, setFollowUpFilter] = useState("all");
  const [lastContactFilter, setLastContactFilter] = useState("all");
  const [minimumExperience, setMinimumExperience] = useState("");
  const [maximumExperience, setMaximumExperience] = useState("");
  const [minimumScore, setMinimumScore] = useState("");
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [myCandidatesOnly, setMyCandidatesOnly] = useState(false);
  const [hideDoNotContact, setHideDoNotContact] = useState(false);

  const [archiveTarget, setArchiveTarget] = useState<{ id: string; name: string } | null>(null);

  const confirmArchiveCandidate = () => {
    if (!archiveTarget) return;
    try {
      candidateService.updateCandidateStage(
        archiveTarget.id,
        "Archived",
        currentUser.getActorContext(),
      );
      toast.success(`${archiveTarget.name} archived`);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to archive candidate");
    } finally {
      setArchiveTarget(null);
    }
  };

  const filteredCandidates = candidatesWithApps.filter((candidate) => {
    const matchesSearch =
      `${candidate.firstName} ${candidate.lastName} ${candidate.email} ${candidate.currentTitle || ""}`
        .toLowerCase()
        .includes(searchQuery.toLowerCase());

    const matchesStage = stageFilter === "all" || candidate.stage === stageFilter;
    const matchesLocation = locationFilter === "all" || candidate.location === locationFilter;
    const matchesProject = projectFilter === "all" || candidate.projectId === projectFilter;
    const matchesSource = sourceFilter === "all" || candidate.source === sourceFilter;
    const matchesPosition = positionFilter === "all" || candidate.currentTitle === positionFilter;
    const matchesTalentPool =
      talentPoolFilter === "all" || candidate.talentPools?.includes(talentPoolFilter);
    const matchesNationality =
      nationalityFilter === "all" || candidate.nationality === nationalityFilter;
    const matchesVisa = visaFilter === "all" || candidate.visaStatus === visaFilter;
    const matchesSelectedOwner =
      ownerFilter === "all"
        ? true
        : ownerFilter === "unassigned"
          ? !candidate.hrOwnerId
          : candidate.hrOwnerId === ownerFilter;
    const matchesOwner =
      matchesSelectedOwner && (!myCandidatesOnly || candidate.hrOwnerId === currentUser.userId);
    const matchesRecommender =
      recommenderFilter === "all" ||
      candidate.recommendations.some(
        (recommendation) => recommenderKey(recommendation) === recommenderFilter,
      );
    const minimumYears = minimumExperience === "" ? null : Number(minimumExperience);
    const maximumYears = maximumExperience === "" ? null : Number(maximumExperience);
    const matchesExperience =
      (minimumYears === null || candidate.yearsOfExperience >= minimumYears) &&
      (maximumYears === null || candidate.yearsOfExperience <= maximumYears);
    const parsedScore = Number.parseFloat(candidate.aiScoreRange || "");
    const matchesScore =
      minimumScore === "" || (Number.isFinite(parsedScore) && parsedScore >= Number(minimumScore));
    const latestContact = candidate.contacts[0];
    const followUpDate = latestContact?.nextFollowUpDate
      ? new Date(latestContact.nextFollowUpDate)
      : null;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const matchesFollowUp =
      followUpFilter === "all" ||
      (followUpFilter === "none" && !followUpDate) ||
      (followUpFilter === "overdue" && !!followUpDate && followUpDate < todayStart) ||
      (followUpFilter === "due" &&
        !!followUpDate &&
        followUpDate.toDateString() === todayStart.toDateString()) ||
      (followUpFilter === "upcoming" && !!followUpDate && followUpDate > todayStart);
    const lastContactTime = candidate.lastContactAt
      ? new Date(candidate.lastContactAt).getTime()
      : null;
    const lastContactDays = Number(lastContactFilter);
    const matchesLastContact =
      lastContactFilter === "all" ||
      (lastContactFilter === "never" && lastContactTime === null) ||
      (Number.isFinite(lastContactDays) &&
        lastContactTime !== null &&
        Date.now() - lastContactTime <= lastContactDays * 24 * 60 * 60 * 1000);
    const matchesDnc = !hideDoNotContact || !candidate.doNotContact;

    return (
      matchesSearch &&
      matchesStage &&
      matchesLocation &&
      matchesProject &&
      matchesSource &&
      matchesPosition &&
      matchesTalentPool &&
      matchesNationality &&
      matchesVisa &&
      matchesOwner &&
      matchesRecommender &&
      matchesExperience &&
      matchesScore &&
      matchesFollowUp &&
      matchesLastContact &&
      matchesDnc
    );
  });

  const exportCsv = () => {
    let csvContent: string;
    try {
      csvContent = candidateService.exportCandidates(
        filteredCandidates.map((c) => c.id),
        currentUser.getActorContext(),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to export candidates");
      return;
    }

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `candidates_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold">Candidate Pool</h1>
          <p className="text-sm text-muted-foreground">
            One profile for every candidate, with every CV, application and recruitment activity
            connected.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
          <Button variant="outline" asChild>
            <Link to="/staff/candidates/intake">
              <Upload className="mr-2 h-4 w-4" /> Add Direct CV
            </Link>
          </Button>
          <Button asChild>
            <Link to="/staff/candidates/recommend">Add Recommended Candidate</Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 rounded-xl border bg-card p-4 shadow-sm">
        <div className="relative flex-1 min-w-[250px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, title..."
            className="pl-9 bg-background"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="w-[180px] bg-background">
            <SelectValue placeholder="Stage" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stages</SelectItem>
            <SelectItem value="Sourced">Sourced</SelectItem>
            <SelectItem value="Applied">Applied</SelectItem>
            <SelectItem value="Screened">Screened</SelectItem>
            <SelectItem value="Shortlisted">Shortlisted</SelectItem>
            <SelectItem value="Interview">Interview</SelectItem>
            <SelectItem value="Offer">Offer</SelectItem>
            <SelectItem value="On Hold">On Hold</SelectItem>
            <SelectItem value="Not Selected">Not Selected</SelectItem>
            <SelectItem value="Withdrawn">Withdrawn</SelectItem>
            <SelectItem value="Hired">Hired</SelectItem>
            <SelectItem value="Archived">Archived</SelectItem>
          </SelectContent>
        </Select>

        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="w-[180px] bg-background">
            <SelectValue placeholder="Project" />
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

        <Select value={locationFilter} onValueChange={setLocationFilter}>
          <SelectTrigger className="w-[180px] bg-background">
            <SelectValue placeholder="Location" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Locations</SelectItem>
            {locations.map((loc) => (
              <SelectItem key={loc} value={loc}>
                {loc}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-[180px] bg-background">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            {sources.map((src) => (
              <SelectItem key={src} value={src}>
                {src}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          type="button"
          variant={showMoreFilters ? "secondary" : "outline"}
          onClick={() => setShowMoreFilters((value) => !value)}
        >
          <Filter className="mr-2 h-4 w-4" /> More filters
        </Button>

        <label className="flex items-center gap-2 rounded-md border bg-background px-3 text-sm">
          <Checkbox
            checked={myCandidatesOnly}
            onCheckedChange={(v) => setMyCandidatesOnly(v === true)}
          />
          My candidates
        </label>

        <label className="flex items-center gap-2 rounded-md border bg-background px-3 text-sm">
          <Checkbox
            checked={hideDoNotContact}
            onCheckedChange={(v) => setHideDoNotContact(v === true)}
          />
          Hide Do Not Contact
        </label>

        {showMoreFilters && (
          <div className="grid w-full grid-cols-1 gap-3 border-t pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <Select value={positionFilter} onValueChange={setPositionFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Position" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Positions</SelectItem>
                {positions.map((position) => (
                  <SelectItem key={position} value={position}>
                    {position}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={talentPoolFilter} onValueChange={setTalentPoolFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Talent pool" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Talent Pools</SelectItem>
                {talentPools.map((pool) => (
                  <SelectItem key={pool} value={pool}>
                    {pool}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={nationalityFilter} onValueChange={setNationalityFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Nationality" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Nationalities</SelectItem>
                {nationalities.map((nationality) => (
                  <SelectItem key={nationality} value={nationality}>
                    {nationality}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={visaFilter} onValueChange={setVisaFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Visa status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Visa Statuses</SelectItem>
                {visaStatuses.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={ownerFilter} onValueChange={setOwnerFilter}>
              <SelectTrigger>
                <SelectValue placeholder="HR owner" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All HR Owners</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {ownerIds.map((id) => (
                  <SelectItem key={id} value={id}>
                    {userById.get(id) || "Unknown user"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={recommenderFilter} onValueChange={setRecommenderFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Recommender" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Recommenders</SelectItem>
                {recommenders.map(([email, label]) => (
                  <SelectItem key={email} value={email}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={followUpFilter} onValueChange={setFollowUpFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Follow-up" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Follow-ups</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="due">Due Today</SelectItem>
                <SelectItem value="upcoming">Upcoming</SelectItem>
                <SelectItem value="none">No Follow-up</SelectItem>
              </SelectContent>
            </Select>
            <Select value={lastContactFilter} onValueChange={setLastContactFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Last contact" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any Last Contact</SelectItem>
                <SelectItem value="7">Within 7 Days</SelectItem>
                <SelectItem value="30">Within 30 Days</SelectItem>
                <SelectItem value="90">Within 90 Days</SelectItem>
                <SelectItem value="never">Never Contacted</SelectItem>
              </SelectContent>
            </Select>
            <div className="grid grid-cols-3 gap-2">
              <Input
                type="number"
                min={0}
                placeholder="Min years"
                value={minimumExperience}
                onChange={(event) => setMinimumExperience(event.target.value)}
              />
              <Input
                type="number"
                min={0}
                placeholder="Max years"
                value={maximumExperience}
                onChange={(event) => setMaximumExperience(event.target.value)}
              />
              <Input
                type="number"
                min={0}
                max={100}
                placeholder="Min score"
                value={minimumScore}
                onChange={(event) => setMinimumScore(event.target.value)}
              />
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Candidate Name</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Experience</TableHead>
              <TableHead>Active Applications</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCandidates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-32 text-center text-muted-foreground">
                  No candidates found matching your criteria.
                </TableCell>
              </TableRow>
            ) : (
              filteredCandidates.map((candidate) => {
                const recentApp = candidate.applications.sort((a, b) =>
                  b.createdAt.localeCompare(a.createdAt),
                )[0];
                const vacancy = recentApp
                  ? vacancies.find((v) => v.id === recentApp.vacancyId)
                  : null;

                return (
                  <TableRow
                    key={candidate.id}
                    className={`cursor-pointer hover:bg-muted/50 ${candidate.doNotContact ? "bg-red-500/5 hover:bg-red-500/10" : ""}`}
                    onClick={() => navigate({ to: `/staff/candidates/${candidate.id}` })}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">
                          {candidate.firstName[0]}
                          {candidate.lastName[0]}
                        </div>
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            {candidate.firstName} {candidate.lastName}
                            {candidate.doNotContact && (
                              <span title="Do Not Contact">
                                <ShieldAlert className="h-4 w-4 text-destructive" />
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {candidate.currentTitle || "No title provided"}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {candidate.projectId ? (
                        projectNameById.get(candidate.projectId) || "Unknown"
                      ) : (
                        <span className="text-muted-foreground">&mdash;</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          candidate.stage === "Hired"
                            ? "default"
                            : candidate.stage === "Applied"
                              ? "secondary"
                              : candidate.stage === "Archived"
                                ? "outline"
                                : "default"
                        }
                      >
                        {candidate.stage}
                      </Badge>
                    </TableCell>
                    <TableCell>{candidate.yearsOfExperience} yrs</TableCell>
                    <TableCell>
                      {candidate.applications.length > 0 ? (
                        <div className="flex flex-col text-sm">
                          <span className="font-medium">
                            {candidate.applications.length} application(s)
                          </span>
                          {vacancy && (
                            <span className="text-xs text-muted-foreground truncate max-w-[150px]">
                              {vacancy.title}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">None</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{candidate.location}</TableCell>
                    <TableCell className="text-sm">{candidate.source || "Unknown"}</TableCell>
                    <TableCell className="text-sm">
                      {candidate.hrOwnerId ? (
                        userById.get(candidate.hrOwnerId) || "Unknown"
                      ) : (
                        <span className="text-muted-foreground">Unassigned</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {candidate.stage !== "Archived" && candidate.stage !== "Hired" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setArchiveTarget({
                              id: candidate.id,
                              name: `${candidate.firstName} ${candidate.lastName}`,
                            });
                          }}
                        >
                          <Archive className="mr-1.5 h-3.5 w-3.5" /> Archive
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!archiveTarget} onOpenChange={(open) => !open && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {archiveTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They will be removed from active pipelines. This can be reversed later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmArchiveCandidate}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
