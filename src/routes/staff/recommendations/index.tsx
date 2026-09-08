import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowRight, Search, Users, CheckCircle2, TrendingUp, AlertCircle } from "lucide-react";
import { CandidateService } from "@/lib/data/candidate-service";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { VacancyService } from "@/lib/data/vacancy-service";
import { reviewEmployeeReferralFn } from "@/lib/server-functions/candidate.server";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import type { CandidateRecommendation } from "@/lib/data/types";
import { CandidatePoolService } from "@/lib/data/candidate-pool-service";

export const Route = createFileRoute("/staff/recommendations/")({
  component: RecommendationsIndexWrapper,
});

function RecommendationsIndexWrapper() {
  return (
    <RequirePermission
      permission="recruitment:view_candidates"
      resourceName="Recommendations & Sources"
    >
      <RecommendationsIndex />
    </RequirePermission>
  );
}

function RecommendationsIndex() {
  const currentUser = useCurrentUser();
  const [candidateService] = useState(() => new CandidateService());
  const [candidatePoolService] = useState(() => new CandidatePoolService());
  const [vacancyService] = useState(() => new VacancyService());
  const [refreshKey, setRefreshKey] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [reviewing, setReviewing] = useState<{
    recommendation: CandidateRecommendation;
    decision: "Approve" | "Decline";
  } | null>(null);
  const [reviewReason, setReviewReason] = useState("");
  const [savingReview, setSavingReview] = useState(false);

  useEffect(() => {
    void candidateService
      .hydrateCompatibilityCache(currentUser.getActorContext())
      .then(() => setRefreshKey((value) => value + 1))
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : "Recommendations could not load."),
      );
    // Identity changes recreate this protected page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateService]);

  const profiles = useMemo(() => {
    void refreshKey;
    return candidateService.getRecommenderProfiles(currentUser.getActorContext());
  }, [candidateService, currentUser, refreshKey]);
  const pendingReferrals = useMemo(() => {
    void refreshKey;
    return candidateService
      .getRecommendations(currentUser.getActorContext())
      .filter(
        (recommendation) =>
          recommendation.recommenderType === "Employee Referral" &&
          (recommendation.reviewStatus === "Pending HR Review" ||
            (!recommendation.reviewStatus && recommendation.sourceOutcome === "Submitted")),
      );
  }, [candidateService, currentUser, refreshKey]);
  const candidateById = useMemo(() => {
    void refreshKey;
    return new Map(
      candidateService
        .getCandidateRepository()
        .list()
        .map((item) => [item.id, item]),
    );
  }, [candidateService, refreshKey]);
  const cvByRecommendationId = useMemo(() => {
    void refreshKey;
    return new Map(
      candidatePoolService
        .getCvIntakes(currentUser.getActorContext())
        .filter((item) => item.recommendationId)
        .map((item) => [item.recommendationId!, item]),
    );
  }, [candidatePoolService, currentUser, refreshKey]);
  const vacancyById = useMemo(() => {
    void refreshKey;
    return new Map(
      vacancyService
        .getVacancyRepository()
        .list()
        .map((item) => [item.id, item]),
    );
  }, [vacancyService, refreshKey]);

  const submitReview = async () => {
    if (!reviewing || reviewReason.trim().length < 5) return;
    setSavingReview(true);
    try {
      await reviewEmployeeReferralFn({
        data: {
          actor: {
            actorId: currentUser.userId,
            ...(currentUser.workspaceEmail ? { actorEmail: currentUser.workspaceEmail } : {}),
            activeRole: currentUser.activeRole,
          },
          recommendationId: reviewing.recommendation.id,
          decision: reviewing.decision,
          reason: reviewReason.trim(),
        },
      });
      await candidateService.hydrateCompatibilityCache(currentUser.getActorContext());
      setRefreshKey((value) => value + 1);
      toast.success(
        reviewing.decision === "Approve"
          ? "Referral approved and added to interview consideration."
          : "Referral declined; the Candidate Pool record was retained.",
      );
      setReviewing(null);
      setReviewReason("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The referral could not be reviewed.");
    } finally {
      setSavingReview(false);
    }
  };

  const filtered = profiles.filter(
    (p) =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.phone && p.phone.includes(searchTerm)) ||
      (p.company && p.company.toLowerCase().includes(searchTerm.toLowerCase())),
  );

  const totalReferrals = profiles.reduce((sum, p) => sum + p.totalIntroduced, 0);
  const totalHired = profiles.reduce((sum, p) => sum + p.totalHired, 0);
  const overallSuccess = totalReferrals > 0 ? Math.round((totalHired / totalReferrals) * 100) : 0;

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold">Recommendations & Sources</h1>
          <p className="text-muted-foreground">
            Track historical performance of agencies, employees, and external referrers.
          </p>
        </div>
        <Button asChild>
          <Link to="/staff/candidates/recommend">Add Recommended Candidate</Link>
        </Button>
      </div>

      <Alert className="bg-muted/50 border-muted">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Factual Reporting Disclaimer</AlertTitle>
        <AlertDescription>
          These metrics report strictly on historical candidate outcomes. A high or low hire rate on
          past candidates does not guarantee the quality of future recommendations from a source.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Employee Referrals Awaiting HR Review</CardTitle>
              <CardDescription>
                Approval places the candidate in interview consideration. Declining retains the
                secure Candidate Pool record without placing it in an active recruitment list.
              </CardDescription>
            </div>
            <Badge variant={pendingReferrals.length > 0 ? "default" : "secondary"}>
              {pendingReferrals.length} pending
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {pendingReferrals.length === 0 ? (
            <p className="py-5 text-center text-sm text-muted-foreground">
              There are no employee referrals waiting for HR.
            </p>
          ) : (
            <div className="divide-y rounded-lg border">
              {pendingReferrals.map((recommendation) => {
                const candidate = candidateById.get(recommendation.candidateId);
                const vacancy = recommendation.vacancyId
                  ? vacancyById.get(recommendation.vacancyId)
                  : undefined;
                const cv = cvByRecommendationId.get(recommendation.id);
                const cvReady = cv?.processingStatus === "Ready";
                return (
                  <div
                    key={recommendation.id}
                    className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between"
                  >
                    <div>
                      <Link
                        to="/staff/candidates/$candidateId"
                        params={{ candidateId: recommendation.candidateId }}
                        className="font-semibold hover:underline"
                      >
                        {candidate ? `${candidate.firstName} ${candidate.lastName}` : "Candidate"}
                      </Link>
                      <p className="text-sm text-muted-foreground">
                        {vacancy?.title || "Future opportunity"} · recommended by{" "}
                        {recommendation.recommenderName}
                      </p>
                      <p className="mt-1 text-sm">{recommendation.notes}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        CV preparation: {cv?.processingStatus ?? "Waiting to start"}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setReviewing({ recommendation, decision: "Decline" });
                          setReviewReason("");
                        }}
                      >
                        Decline
                      </Button>
                      <Button
                        disabled={!recommendation.vacancyId || !cvReady}
                        title={
                          !recommendation.vacancyId
                            ? "Select a vacancy before approval."
                            : !cvReady
                              ? "Wait for CV preparation to finish."
                              : undefined
                        }
                        onClick={() => {
                          setReviewing({ recommendation, decision: "Approve" });
                          setReviewReason("");
                        }}
                      >
                        Approve for Interview
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Referrals</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalReferrals}</div>
            <p className="text-xs text-muted-foreground">Across {profiles.length} recommenders</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Hired</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalHired}</div>
            <p className="text-xs text-muted-foreground">Candidates hired</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Overall Success Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overallSuccess}%</div>
            <p className="text-xs text-muted-foreground">Average conversion to hire</p>
          </CardContent>
        </Card>
      </div>

      <Card className="flex-1">
        <CardHeader>
          <CardTitle>Recommender Directory</CardTitle>
          <CardDescription>
            All sources who have introduced candidates to the company.
          </CardDescription>
          <div className="pt-4 flex items-center gap-2 max-w-sm">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, contact or company..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recommender</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-center">Introduced</TableHead>
                <TableHead className="text-center">Active Process</TableHead>
                <TableHead className="text-center">Hired</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No recommenders found.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((profile) => (
                  <TableRow key={profile.key}>
                    <TableCell>
                      <div className="font-medium">{profile.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {profile.company || profile.email || profile.phone}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{profile.type}</Badge>
                    </TableCell>
                    <TableCell className="text-center font-medium">
                      {profile.totalIntroduced}
                    </TableCell>
                    <TableCell className="text-center">
                      {profile.activeProcess > 0 ? (
                        <Badge variant="outline" className="bg-amber-50 text-amber-700">
                          {profile.activeProcess}
                        </Badge>
                      ) : (
                        0
                      )}
                    </TableCell>
                    <TableCell className="text-center font-medium text-emerald-600">
                      {profile.totalHired}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link
                          to="/staff/recommendations/$email"
                          params={{ email: encodeURIComponent(profile.key) }}
                        >
                          View Profile <ArrowRight className="ml-2 h-4 w-4" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(reviewing)}
        onOpenChange={(open) => {
          if (!open && !savingReview) {
            setReviewing(null);
            setReviewReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reviewing?.decision === "Approve" ? "Approve Referral" : "Decline Referral"}
            </DialogTitle>
            <DialogDescription>
              {reviewing?.decision === "Approve"
                ? "The candidate will be ranked, pinned for screening and shown in the interview scheduling list."
                : "The candidate and CV remain securely stored, but will not appear in active interview consideration."}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reviewReason}
            onChange={(event) => setReviewReason(event.target.value)}
            placeholder="Record the reason for this HR decision"
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewing(null)} disabled={savingReview}>
              Cancel
            </Button>
            <Button
              variant={reviewing?.decision === "Decline" ? "destructive" : "default"}
              onClick={submitReview}
              disabled={savingReview || reviewReason.trim().length < 5}
            >
              {savingReview ? "Saving..." : `Confirm ${reviewing?.decision || "Decision"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
