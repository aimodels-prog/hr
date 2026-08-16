import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, MapPin, Clock, Building2, Search } from "lucide-react";
import { useState } from "react";

import heroImage from "@/assets/careers-hero.jpg";
import { BrandLogo } from "@/components/brand-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { jobs } from "@/lib/hr-data";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Careers at VIA International — Open Roles" },
      {
        name: "description",
        content:
          "Explore open roles in operations, compliance and finance at VIA International and apply in minutes.",
      },
      { property: "og:title", content: "Careers at VIA International — Open Roles" },
      {
        property: "og:description",
        content: "Open roles in operations, compliance and finance across the UAE and KSA.",
      },
    ],
  }),
  component: CareerPortal,
});

function CareerPortal() {
  const [query, setQuery] = useState("");
  const filtered = jobs.filter((job) =>
    `${job.title} ${job.department} ${job.location}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b bg-card/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <BrandLogo />
          <nav className="flex items-center gap-2">
            <a href="#openings" className="hidden rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground sm:inline">
              Open roles
            </a>
            <Button asChild variant="outline" size="sm">
              <Link to="/staff">Staff portal</Link>
            </Button>
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden border-b">
        <img
          src={heroImage}
          alt="VIA International operations team overlooking a container port"
          width={1600}
          height={1000}
          className="absolute inset-0 h-full w-full object-cover opacity-25"
        />
        <div className="absolute inset-0 brand-gradient opacity-90" />
        <div className="relative mx-auto max-w-6xl px-4 py-20 text-primary-foreground sm:py-28">
          <p className="font-display text-xs font-semibold uppercase tracking-[0.25em] opacity-80">
            Careers
          </p>
          <h1 className="mt-4 max-w-2xl text-4xl font-semibold sm:text-5xl">
            Move the world's cargo with a team that moves fast.
          </h1>
          <p className="mt-5 max-w-xl text-base opacity-85">
            VIA International runs freight, compliance and trade operations across the GCC and beyond.
            We hire people who take ownership from quote to delivery.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" variant="secondary">
              <a href="#openings">
                See {jobs.length} open roles <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>
      </section>

      <section id="openings" className="mx-auto max-w-6xl px-4 py-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold">Open positions</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Every application is reviewed by our people team within 5 working days.
            </p>
          </div>
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search role, team or city"
              className="pl-9"
            />
          </div>
        </div>

        <div className="mt-8 grid gap-4">
          {filtered.map((job) => (
            <Link
              key={job.id}
              to="/jobs/$jobId"
              params={{ jobId: job.id }}
              className="surface-panel group flex flex-wrap items-center gap-4 p-5 transition-colors hover:border-primary/40"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-lg font-semibold">{job.title}</h3>
                  <Badge variant="secondary">{job.department}</Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{job.summary}</p>
                <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" /> {job.location}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Building2 className="h-3.5 w-3.5" /> {job.type}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" /> Posted {job.posted}
                  </span>
                </div>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
            </Link>
          ))}
          {filtered.length === 0 && (
            <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
              No roles match "{query}". Try another search.
            </p>
          )}
        </div>
      </section>

      <footer className="border-t bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-xs text-muted-foreground">
          <BrandLogo className="h-7" />
          <p>© {new Date().getFullYear()} VIA International. Equal opportunity employer.</p>
        </div>
      </footer>
    </div>
  );
}
