import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Sparkles, Wand2, Loader2, ArrowRight } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/staff/vacancy")({
  head: () => ({
    meta: [
      { title: "New Vacancy — VIA International Staff Portal" },
      {
        name: "description",
        content: "Create a vacancy and draft the job description with AI assistance.",
      },
      { property: "og:title", content: "New Vacancy — VIA International Staff Portal" },
      { property: "og:description", content: "Create a vacancy and draft the job description with AI." },
    ],
  }),
  component: NewVacancy;
});

const draft = `Role summary
VIA International is hiring a Logistics Operations Lead to own end-to-end freight execution across sea, air and land corridors from our Dubai hub. You will keep service levels high, cost per shipment low, and a team of eight coordinators performing at their best.

Key responsibilities
• Lead the import and export desks, covering rosters, escalations and daily performance reviews
• Own carrier relationships and quarterly rate negotiations across all active lanes
• Drive on-time-in-full delivery above 97% and reduce cost per shipment quarter over quarter
• Partner with compliance on customs documentation quality and audit readiness
• Report lane-level performance to the commercial leadership team

Requirements
• 6+ years in freight forwarding, 3PL or contract logistics operations
• 3+ years leading operational teams in a multi-site environment
• Hands-on experience with CargoWise or a comparable TMS
• Strong commercial judgement on rates, margins and carrier mix
• Fluent English; Arabic is an advantage

What we offer
Competitive salary, annual bonus tied to lane performance, medical cover for you and your dependants, and a clear path into regional operations leadership.`;

function NewVacancy() {
  const [generating, setGenerating] = useState(false);
  const [text, setText] = useState("");

  const generate = () => {
    setGenerating(true);
    setTimeout(() => {
      setText(draft);
      setGenerating(false);
      toast.success("Draft ready", { description: "Review and edit before publishing." });
    }, 1200);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New vacancy</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Give the basics, let AI draft the description, then publish to the career portal.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Role basics</CardTitle>
            <CardDescription>These feed the AI draft</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Job title</Label>
              <Input id="title" defaultValue="Logistics Operations Lead" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Department</Label>
                <Select defaultValue="operations">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="operations">Operations</SelectItem>
                    <SelectItem value="compliance">Compliance</SelectItem>
                    <SelectItem value="finance">Finance</SelectItem>
                    <SelectItem value="commercial">Commercial</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Employment type</Label>
                <Select defaultValue="full">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">Full-time</SelectItem>
                    <SelectItem value="contract">Contract</SelectItem>
                    <SelectItem value="part">Part-time</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="loc">Location</Label>
                <Input id="loc" defaultValue="Dubai, UAE" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="seniority">Seniority</Label>
                <Input id="seniority" defaultValue="Manager / Lead" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes for the AI</Label>
              <Textarea
                id="notes"
                rows={4}
                defaultValue="Team of 8. CargoWise essential. OTIF target 97%. Arabic a plus."
              />
            </div>
            <Button onClick={generate} disabled={generating} className="w-full">
              {generating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Drafting…
                </>
              ) : (
                <>
                  <Wand2 className="mr-2 h-4 w-4" /> Draft with AI
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Job description</CardTitle>
              <CardDescription>Fully editable before publishing</CardDescription>
            </div>
            {text && (
              <Badge variant="secondary">
                <Sparkles className="mr-1 h-3 w-3" /> AI draft
              </Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={22}
              placeholder="Your AI-drafted job description will appear here…"
              className="font-sans text-sm leading-relaxed"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => toast.success("Vacancy published to the career portal")}
                disabled={!text}
              >
                Publish vacancy
              </Button>
              <Button variant="outline" onClick={() => toast("Saved as draft")} disabled={!text}>
                Save draft
              </Button>
              <Button asChild variant="ghost" className="ml-auto">
                <Link to="/staff/candidates">
                  Scan for candidates <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
