import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, MapPin, Building2, Clock, Upload } from "lucide-react";
import { toast } from "sonner";

import { BrandLogo } from "@/components/brand-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { jobs } from "@/lib/hr-data";

export const Route = createFileRoute("/jobs/$jobId")({
  head: ({ params }) => {
    const job = jobs.find((j) => j.id === params.jobId);
    const title = job ? `${job.title} — Careers at VIA International` : "Role — VIA International";
    const description = job?.summary ?? "Open role at VIA International.";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
      ],
    };
  },
  loader: ({ params }) => {
    const job = jobs.find((j) => j.id === params.jobId);
    if (!job) throw notFound();
    return job;
  },
  component: JobDetail,
});

function JobDetail() {
  const job = Route.useLoaderData();

  return (
    <div className="min-h-screen">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <BrandLogo />
          <Button asChild variant="ghost" size="sm">
            <Link to="/">
              <ArrowLeft className="mr-2 h-4 w-4" /> All roles
            </Link>
          </Button>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 lg:grid-cols-[1.6fr_1fr]">
        <article>
          <Badge variant="secondary">{job.department}</Badge>
          <h1 className="mt-3 text-3xl font-semibold">{job.title}</h1>
          <div className="mt-3 flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-4 w-4" /> {job.location}
            </span>
            <span className="inline-flex items-center gap-1">
              <Building2 className="h-4 w-4" /> {job.type}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-4 w-4" /> Posted {job.posted}
            </span>
          </div>

          <p className="mt-6 text-base leading-relaxed">{job.summary}</p>

          <h2 className="mt-8 text-lg font-semibold">What you'll do</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {job.responsibilities.map((item) => (
              <li key={item} className="flex gap-3">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                {item}
              </li>
            ))}
          </ul>

          <h2 className="mt-8 text-lg font-semibold">What you'll bring</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {job.requirements.map((item) => (
              <li key={item} className="flex gap-3">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
                {item}
              </li>
            ))}
          </ul>
        </article>

        <aside className="surface-panel h-fit p-6 lg:sticky lg:top-6">
          <h2 className="font-display text-lg font-semibold">Apply for this role</h2>
          <form
            className="mt-5 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              toast.success("Application received", {
                description: "Our people team will get back to you within 5 working days.",
              });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="name">Full name</Label>
              <Input id="name" required placeholder="Your name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required placeholder="you@email.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" placeholder="+971 ..." />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cv">CV</Label>
              <label
                htmlFor="cv"
                className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground hover:border-primary/50"
              >
                <Upload className="h-4 w-4" /> Upload PDF or DOCX
              </label>
              <Input id="cv" type="file" className="sr-only" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="note">Why this role?</Label>
              <Textarea id="note" rows={4} placeholder="A short note about your fit" />
            </div>
            <Button type="submit" className="w-full">
              Submit application
            </Button>
          </form>
        </aside>
      </div>
    </div>
  );
}
