import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
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
  const profiles = candidateService.getRecommenderProfiles(currentUser.getActorContext());
  const [searchTerm, setSearchTerm] = useState("");

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
    </div>
  );
}
