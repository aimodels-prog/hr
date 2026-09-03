import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { ArrowLeft, Building2, Mail, Phone, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { RequirePermission, useCurrentUser } from "@/lib/auth";

export const Route = createFileRoute("/staff/recommendations/$email")({
  component: RecommenderProfileWrapper,
});

function RecommenderProfileWrapper() {
  return (
    <RequirePermission permission="recruitment:view_candidates" resourceName="Recommender Profile">
      <RecommenderProfile />
    </RequirePermission>
  );
}

function RecommenderProfile() {
  const { email } = Route.useParams();
  const currentUser = useCurrentUser();
  const candidateService = useMemo(() => new CandidateService(), []);
  const vacancyService = useMemo(() => new VacancyService(), []);
  const context = currentUser.getActorContext();
  const recommenderKey = decodeURIComponent(email).toLowerCase();
  const profile = candidateService
    .getRecommenderProfiles(context)
    .find((item) => item.key === recommenderKey);
  const candidates = candidateService.getDetailedCandidates(context);
  const vacancies = vacancyService.getVacancyRepository().list();

  if (!profile) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Recommendation source not found</CardTitle>
            <CardDescription>
              This recommendation source may have been archived or the link may be out of date.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/staff/recommendations">Return to recommendations</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  const canViewCommercialTerms = ["HR", "Accounts", "Super Admin"].includes(currentUser.activeRole);

  const successRate =
    profile.totalIntroduced > 0
      ? Math.round((profile.totalHired / profile.totalIntroduced) * 100)
      : 0;

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary">
            {profile.name.charAt(0)}
          </div>
          <div>
            <h1 className="font-display text-3xl font-semibold flex items-center gap-2">
              {profile.name}
              <Badge variant="outline" className="ml-2">
                {profile.type}
              </Badge>
            </h1>
            <p className="text-lg text-muted-foreground flex items-center gap-2">
              {profile.company && (
                <>
                  <Building2 className="h-4 w-4" /> {profile.company}
                </>
              )}
            </p>
          </div>
        </div>
        <Button asChild variant="ghost" size="icon">
          <Link to="/staff/recommendations">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[350px_1fr] gap-6">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Contact Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {profile.email && (
                <div className="flex items-center gap-3 text-sm">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <a
                    href={`mailto:${profile.email}`}
                    className="text-primary hover:underline font-medium"
                  >
                    {profile.email}
                  </a>
                </div>
              )}
              {profile.phone && (
                <div className="flex items-center gap-3 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <a
                    href={`tel:${profile.phone}`}
                    className="text-primary hover:underline font-medium"
                  >
                    {profile.phone}
                  </a>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Performance Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Introduced</p>
                  <p className="text-2xl font-bold">{profile.totalIntroduced}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Hired</p>
                  <p className="text-2xl font-bold text-emerald-600">{profile.totalHired}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Active Process</p>
                  <p className="text-2xl font-bold text-amber-600">{profile.activeProcess}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Success Rate</p>
                  <p className="text-2xl font-bold text-blue-600">{successRate}%</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Recommended Candidates</CardTitle>
              <CardDescription>
                A history of all candidates introduced by this source.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Candidate</TableHead>
                    <TableHead>Vacancy</TableHead>
                    <TableHead>Outcome/Stage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profile.recommendations.map((rec) => {
                    const candidate = candidates.find((c) => c.id === rec.candidateId);
                    const vacancy = rec.vacancyId
                      ? vacancies.find((vacancy) => vacancy.id === rec.vacancyId)
                      : null;
                    if (!candidate) return null;

                    return (
                      <TableRow key={rec.id}>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {new Date(rec.date).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <Link
                            to="/staff/candidates/$candidateId"
                            params={{ candidateId: candidate.id }}
                            className="font-medium text-primary hover:underline flex items-center gap-1"
                          >
                            {candidate.firstName} {candidate.lastName}{" "}
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                          {rec.relationship && (
                            <div className="text-xs text-muted-foreground">
                              Rel: {rec.relationship}
                            </div>
                          )}
                          {rec.employeeId && (
                            <Link
                              to="/staff/employees/$employeeId"
                              params={{ employeeId: rec.employeeId }}
                              className="mt-1 block text-xs font-medium text-emerald-700 hover:underline"
                            >
                              Open linked employee record
                            </Link>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {vacancy ? (
                            <Link
                              to="/staff/vacancies/$vacancyId"
                              params={{ vacancyId: vacancy.id }}
                              className="hover:underline"
                            >
                              {vacancy.title}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground italic">General</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              candidate.stage === "Hired"
                                ? "default"
                                : candidate.stage === "Not Selected" ||
                                    candidate.stage === "Withdrawn"
                                  ? "secondary"
                                  : "outline"
                            }
                          >
                            {candidate.stage}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {canViewCommercialTerms && profile.recommendations.some((r) => r.commercialTerms) && (
            <Card className="border-amber-500/20 bg-amber-500/5">
              <CardHeader>
                <CardTitle className="text-amber-700">Commercial Terms & Agreements</CardTitle>
                <CardDescription className="text-amber-900/70">
                  Restricted to HR, Accounts, and Super Admin. Includes fees, structure, and terms
                  captured during recommendation.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {profile.recommendations
                  .filter((r) => r.commercialTerms)
                  .map((rec) => (
                    <div
                      key={rec.id}
                      className="text-sm p-4 bg-white/50 rounded-md border border-amber-500/10"
                    >
                      <div className="font-semibold text-amber-800 mb-2">
                        Recorded on {new Date(rec.date).toLocaleDateString()}
                      </div>
                      <p className="whitespace-pre-wrap text-amber-900/80">{rec.commercialTerms}</p>
                    </div>
                  ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
