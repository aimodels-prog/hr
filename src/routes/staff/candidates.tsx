import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Database,
  Mail,
  Loader2,
  Sparkles,
  UserPlus,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScoreBadge } from "@/components/score-badge";
import { candidates as seed, scoringWeights, type Candidate } from "@/lib/hr-data";

export const Route = createFileRoute("/staff/candidates")({
  head: () => ({
    meta: [
      { title: "Candidate Scoring — VIA International Staff Portal" },
      {
        name: "description",
        content: "AI-scored candidates from the talent database and email inbox, with manual additions.",
      },
      { property: "og:title", content: "Candidate Scoring — VIA International Staff Portal" },
      { property: "og:description", content: "Scored shortlists with full HR override." },
    ],
  }),
  component: CandidatesPage,
});

function CandidatesPage() {
  const [pool, setPool] = useState<Candidate[]>(seed);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(true);
  const [shortlistSize, setShortlistSize] = useState([5]);
  const [selected, setSelected] = useState<string[]>(["c1", "c2", "c3", "c4", "c5"]);
  const [open, setOpen] = useState(false);

  const ranked = [...pool].sort((a, b) => b.score - a.score);
  const limit = shortlistSize[0] ?? 5;

  const runScan = () => {
    setScanning(true);
    setScanned(false);
    setTimeout(() => {
      setScanning(false);
      setScanned(true);
      toast.success("Scan complete", {
        description: "412 database profiles and 96 emailed CVs scored against the job description.",
      });
    }, 1500);
  };

  const applyTop = () => {
    setSelected(ranked.slice(0, limit).map((c) => c.id));
    toast.success(`Top ${limit} pre-selected`, { description: "You can add or remove anyone manually." });
  };

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const addManual = (candidate: Candidate) => {
    setPool((p) => [candidate, ...p]);
    setSelected((s) => [...s, candidate.id]);
    setOpen(false);
    toast.success(`${candidate.name} added to the shortlist`, {
      description: "Flagged as a manual referral for audit.",
    });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Candidate scoring</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Logistics Operations Lead · sources scanned: talent database, careers inbox, referrals
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={runScan} disabled={scanning}>
            {scanning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {scanning ? "Scanning…" : "Re-run AI scan"}
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="secondary">
                <UserPlus className="mr-2 h-4 w-4" /> Add manually
              </Button>
            </DialogTrigger>
            <ManualDialog onAdd={addManual} />
          </Dialog>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr]">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Database className="h-4 w-4" /> Talent database
            </CardDescription>
            <CardTitle className="font-display text-2xl">412 profiles</CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={scanned ? 100 : scanning ? 62 : 0} className="h-1.5" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Mail className="h-4 w-4" /> Careers inbox
            </CardDescription>
            <CardTitle className="font-display text-2xl">96 attachments</CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={scanned ? 100 : scanning ? 38 : 0} className="h-1.5" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Scoring model</CardDescription>
            <CardTitle className="text-base">Weighted against the JD</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            {scoringWeights.map((w) => (
              <div key={w.label} className="flex justify-between">
                <span>{w.label}</span>
                <span className="tabular-nums">{w.weight}%</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">Shortlist size</CardTitle>
            <CardDescription>HR decides how many advance</CardDescription>
          </div>
          <div className="flex w-full max-w-sm items-center gap-4">
            <Slider value={shortlistSize} onValueChange={setShortlistSize} min={1} max={10} step={1} />
            <span className="w-8 text-right font-display text-lg font-semibold tabular-nums">{limit}</span>
            <Button size="sm" onClick={applyTop}>
              Pre-select top {limit}
            </Button>
          </div>
        </CardHeader>
      </Card>

      <div className="space-y-3">
        {ranked.map((c, index) => {
          const isSelected = selected.includes(c.id);
          return (
            <Card key={c.id} className={isSelected ? "border-primary/45" : undefined}>
              <CardContent className="flex flex-wrap items-start gap-4 p-5">
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggle(c.id)}
                  className="mt-1"
                  aria-label={`Shortlist ${c.name}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-xs text-muted-foreground">#{index + 1}</span>
                    <h3 className="font-display text-base font-semibold">{c.name}</h3>
                    <Badge variant="outline">{c.source}</Badge>
                    {c.source === "Referral" && <Badge variant="secondary">Manual entry</Badge>}
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {c.title} · {c.location} · {c.years} yrs
                  </p>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-success">
                        Why they rank here
                      </p>
                      <ul className="mt-1.5 space-y-1 text-sm text-muted-foreground">
                        {c.reasons.map((r) => (
                          <li key={r} className="flex gap-2">
                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                            {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-signal">Watch-outs</p>
                      <ul className="mt-1.5 space-y-1 text-sm text-muted-foreground">
                        {c.risks.map((r) => (
                          <li key={r} className="flex gap-2">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal" />
                            {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {c.skills.map((s) => (
                      <Badge key={s} variant="secondary" className="font-normal">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <ScoreBadge score={c.score} />
                  <Badge variant="outline">{c.stage}</Badge>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="surface-panel sticky bottom-4 flex flex-wrap items-center gap-3 p-4">
        <p className="text-sm">
          <span className="font-display text-lg font-semibold">{selected.length}</span> candidates
          selected for interview
        </p>
        <Button
          className="ml-auto"
          onClick={() => toast.success("Shortlist confirmed", { description: "Moved to interview scheduling." })}
        >
          Confirm shortlist
        </Button>
        <Button asChild variant="outline">
          <Link to="/staff/interviews">
            Schedule interviews <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

function ManualDialog({ onAdd }: { onAdd: (c: Candidate) => void }) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add a recommended candidate</DialogTitle>
        <DialogDescription>
          Referrals join the same pipeline and are flagged as manual entries for audit.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="m-name">Full name</Label>
          <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Candidate name" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="m-title">Current title</Label>
          <Input id="m-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Operations Manager" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="m-note">Recommendation note</Label>
          <Textarea
            id="m-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Who recommended them and why"
          />
        </div>
      </div>
      <DialogFooter>
        <Button
          disabled={!name}
          onClick={() =>
            onAdd({
              id: `manual-${Date.now()}`,
              name,
              title: title || "Recommended candidate",
              location: "—",
              years: 0,
              source: "Referral",
              score: 80,
              stage: "Shortlisted",
              email: "—",
              skills: ["Referral"],
              reasons: [note || "Added manually by HR as an internal recommendation"],
              risks: ["Not yet AI-scored against the job description"],
            })
          }
        >
          Add to shortlist
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
