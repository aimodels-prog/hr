import { createFileRoute, Link } from "@tanstack/react-router";
import { Users, CalendarClock, ClipboardCheck, Sparkles, ArrowRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScoreBadge } from "@/components/score-badge";
import { candidates, jobs } from "@/lib/hr-data";

export const Route = createFileRoute("/staff/")({
  head: () => ({
    meta: [
      { title: "HR Dashboard — VIA International Staff Portal" },
      {
        name: "description",
        content: "Track vacancies, candidate scoring, interviews and onboarding in one place.",
      },
      { property: "og:title", content: "HR Dashboard — VIA International Staff Portal" },
      { property: "og:description", content: "Vacancies, shortlists, interviews and onboarding at a glance." },
    ],
  }),
  component: Dashboard,
});

const stages = ["Sourced", "Screened", "Shortlisted", "Interview", "Offer", "Onboarding"] as const;

function Dashboard() {
  const top = [...candidates].sort((a, b) => b.score - a.score).slice(0, 4);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Hiring overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            4 open vacancies · 614 applications · 12 interviews this month
          </p>
        </div>
        <Button asChild>
          <Link to="/staff/vacancy">
            <Sparkles className="mr-2 h-4 w-4" /> New vacancy
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Open vacancies", value: "4", note: "2 with active shortlists" },
          { label: "AI-scored candidates", value: "614", note: "Top 10 surfaced per role" },
          { label: "Interviews scheduled", value: "6", note: "Synced to Google Calendar" },
          { label: "In onboarding", value: "3", note: "1 starting Monday" },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardHeader className="pb-2">
              <CardDescription>{kpi.label}</CardDescription>
              <CardTitle className="font-display text-3xl">{kpi.value}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">{kpi.note}</CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pipeline — Logistics Operations Lead</CardTitle>
          <CardDescription>Candidates by stage</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {stages.map((stage) => {
            const count = candidates.filter((c) => c.stage === stage).length;
            return (
              <div key={stage} className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{stage}</p>
                <p className="mt-1 font-display text-2xl font-semibold">{count}</p>
                <Progress value={count * 20} className="mt-2 h-1.5" />
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Top AI matches</CardTitle>
              <CardDescription>Scored from the talent database and email inbox</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/staff/candidates">
                View all <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {top.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{c.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.title} · {c.location}
                  </p>
                </div>
                <Badge variant="outline" className="hidden sm:inline-flex">
                  {c.source}
                </Badge>
                <ScoreBadge score={c.score} />
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Next actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Link to="/staff/candidates" className="flex items-start gap-3 rounded-md p-2 hover:bg-muted">
                <Users className="mt-0.5 h-4 w-4 text-primary" />
                <span>Confirm the shortlist for Logistics Operations Lead</span>
              </Link>
              <Link to="/staff/interviews" className="flex items-start gap-3 rounded-md p-2 hover:bg-muted">
                <CalendarClock className="mt-0.5 h-4 w-4 text-primary" />
                <span>2 interview slots awaiting calendar confirmation</span>
              </Link>
              <Link to="/staff/onboarding" className="flex items-start gap-3 rounded-md p-2 hover:bg-muted">
                <ClipboardCheck className="mt-0.5 h-4 w-4 text-primary" />
                <span>Amira Haddad's onboarding forms are 60% complete</span>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Live vacancies</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {jobs.map((job) => (
                <div key={job.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                  <span className="truncate">{job.title}</span>
                  <Badge variant={job.status === "Interviewing" ? "default" : "secondary"}>
                    {job.applicants}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
