import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { CalendarCheck, CalendarClock, Loader2, Trophy, ArrowRight, Video } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScoreBadge } from "@/components/score-badge";
import { candidates, interviewCriteria } from "@/lib/hr-data";

export const Route = createFileRoute("/staff/interviews")({
  head: () => ({
    meta: [
      { title: "Interviews — VIA International Staff Portal" },
      {
        name: "description",
        content: "Auto-schedule interviews to Google Calendar and capture panel scorecards.",
      },
      { property: "og:title", content: "Interviews — VIA International Staff Portal" },
      { property: "og:description", content: "Calendar scheduling and structured interview scorecards." },
    ],
  }),
  component: Interviews,
});

const shortlisted = candidates.slice(0, 5);

function Interviews() {
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);
  const [active, setActive] = useState(shortlisted[0]!.id);
  const [scores, setScores] = useState<Record<string, number[]>>(
    Object.fromEntries(shortlisted.map((c) => [c.id, interviewCriteria.map(() => 3)])),
  );
  const [hrPick, setHrPick] = useState<string | null>(null);

  const avg = (id: string) => {
    const list = scores[id] ?? [];
    return list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
  };
  const ranked = [...shortlisted].sort((a, b) => avg(b.id) - avg(a.id));
  const systemPick = ranked[0]!;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Interviews</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Logistics Operations Lead · 5 shortlisted candidates
          </p>
        </div>
        <Button
          onClick={() => {
            setSyncing(true);
            setTimeout(() => {
              setSyncing(false);
              setSynced(true);
              toast.success("Invites sent", {
                description: "Slots booked on the panel's Google Calendar with Meet links.",
              });
            }, 1400);
          }}
          disabled={syncing}
        >
          {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarCheck className="mr-2 h-4 w-4" />}
          {syncing ? "Booking slots…" : "Auto-schedule with Google Calendar"}
        </Button>
      </div>

      <Tabs defaultValue="schedule">
        <TabsList>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="scorecards">Scorecards</TabsTrigger>
          <TabsTrigger value="decision">Decision</TabsTrigger>
        </TabsList>

        <TabsContent value="schedule" className="mt-4 space-y-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Week of 24 August</CardTitle>
              <CardDescription>
                Slots are matched against panel availability in Google Calendar
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {shortlisted.map((c, i) => {
                const slot = c.interview ?? {
                  date: ["Tue 25 Aug", "Tue 25 Aug", "Wed 26 Aug"][i - 2] ?? "Wed 26 Aug",
                  time: ["09:30", "11:00", "15:00"][i - 2] ?? "15:00",
                  panel: "R. Nair",
                  calendar: synced ? ("Scheduled" as const) : ("Pending" as const),
                };
                const status = synced ? "Scheduled" : slot.calendar;
                return (
                  <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.title}</p>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <CalendarClock className="h-4 w-4 text-muted-foreground" />
                      {slot.date} · {slot.time}
                    </div>
                    <span className="hidden text-xs text-muted-foreground md:inline">Panel: {slot.panel}</span>
                    <Badge variant={status === "Scheduled" ? "default" : "secondary"}>{status}</Badge>
                    <Button variant="ghost" size="sm">
                      <Video className="mr-1 h-4 w-4" /> Meet
                    </Button>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="scorecards" className="mt-4 grid gap-4 lg:grid-cols-[240px_1fr]">
          <Card className="h-fit">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Candidates</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {shortlisted.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActive(c.id)}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${
                    active === c.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                  }`}
                >
                  <span className="truncate">{c.name}</span>
                  <span className="tabular-nums">{avg(c.id).toFixed(1)}</span>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Panel scorecard — {shortlisted.find((c) => c.id === active)?.name}
              </CardTitle>
              <CardDescription>Interview held offline; scores captured here</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {interviewCriteria.map((criterion, idx) => (
                <div key={criterion} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>{criterion}</Label>
                    <span className="font-display text-sm tabular-nums">
                      {scores[active]?.[idx] ?? 3} / 5
                    </span>
                  </div>
                  <Slider
                    min={1}
                    max={5}
                    step={1}
                    value={[scores[active]?.[idx] ?? 3]}
                    onValueChange={(v) =>
                      setScores((s) => {
                        const next = [...(s[active] ?? [])];
                        next[idx] = v[0] ?? 3;
                        return { ...s, [active]: next };
                      })
                    }
                  />
                </div>
              ))}
              <div className="space-y-2">
                <Label htmlFor="feedback">Panel notes</Label>
                <Textarea id="feedback" rows={4} placeholder="Strengths, concerns, recommendation…" />
              </div>
              <Button onClick={() => toast.success("Scorecard saved")}>Save scorecard</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="decision" className="mt-4 space-y-4">
          <Card className="border-primary/40">
            <CardHeader className="flex-row items-center gap-3 space-y-0">
              <Trophy className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="text-base">System recommendation: {systemPick.name}</CardTitle>
                <CardDescription>
                  Highest combined AI match ({systemPick.score}/100) and panel average (
                  {avg(systemPick.id).toFixed(1)}/5)
                </CardDescription>
              </div>
            </CardHeader>
          </Card>

          <div className="space-y-3">
            {ranked.map((c) => (
              <Card key={c.id} className={hrPick === c.id ? "border-success/50" : undefined}>
                <CardContent className="flex flex-wrap items-center gap-4 p-5">
                  <div className="min-w-0 flex-1">
                    <p className="font-display font-semibold">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.title}</p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p>Panel avg</p>
                    <p className="font-display text-base text-foreground tabular-nums">
                      {avg(c.id).toFixed(1)}/5
                    </p>
                  </div>
                  <ScoreBadge score={c.score} />
                  <Button
                    variant={hrPick === c.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setHrPick(c.id);
                      toast.success(`${c.name} selected for offer`, {
                        description:
                          c.id === systemPick.id
                            ? "Matches the system recommendation."
                            : "HR override recorded with reason required.",
                      });
                    }}
                  >
                    {hrPick === c.id ? "Selected" : "Select for offer"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex justify-end">
            <Button asChild variant="outline" disabled={!hrPick}>
              <Link to="/staff/onboarding">
                Start onboarding <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
