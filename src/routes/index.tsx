import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  Clock3,
  Globe2,
  MapPin,
  Search,
  Users2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import heroImage from "@/assets/careers-hero.jpg";
import { BrandLogo } from "@/components/brand-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { VacancyService } from "@/lib/data/vacancy-service";
import type { Vacancy } from "@/lib/data/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Careers at VIA International — Build what moves the world" },
      {
        name: "description",
        content:
          "Build your career at VIA International. Explore opportunities across freight, compliance, finance and operations in the GCC.",
      },
      { property: "og:title", content: "Careers at VIA International" },
      {
        property: "og:description",
        content: "Join the people behind reliable trade and logistics across the GCC and beyond.",
      },
    ],
  }),
  component: CareerPortal,
});

const principles = [
  {
    icon: CheckCircle2,
    title: "Own the outcome",
    description:
      "We trust people to make sound decisions, communicate clearly and finish what they start.",
  },
  {
    icon: Globe2,
    title: "Think across borders",
    description:
      "Our work connects customers, partners and teams across markets, cultures and time zones.",
  },
  {
    icon: Users2,
    title: "Move as one team",
    description:
      "The best logistics feels effortless because capable people coordinate behind the scenes.",
  },
];

function CareerPortal() {
  const vacancyService = useMemo(() => new VacancyService(), []);
  // Vacancy data lives in browser storage, which does not exist during server rendering (no
  // window, so the storage driver falls back to an empty in-memory store there). Reading it
  // synchronously in a useMemo meant the server render and the client's very first render pass
  // saw different data (empty vs. whatever is already seeded in this browser), which is exactly
  // what a hydration mismatch is. Starting from an empty array and only populating it after
  // mount, via this effect, guarantees the server render and the client's hydration-matching
  // render agree - the real data then arrives as a normal follow-up client update, not part of
  // the hydration pass itself.
  const [openVacancies, setOpenVacancies] = useState<Vacancy[]>([]);
  useEffect(() => {
    setOpenVacancies(
      vacancyService.getVacancyRepository().list().filter((vacancy) => vacancy.status === "Open"),
    );
  }, [vacancyService]);
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("all");
  const [location, setLocation] = useState("all");
  const [employmentType, setEmploymentType] = useState("all");

  const departments = useMemo(
    () => Array.from(new Set(openVacancies.map((vacancy) => vacancy.department))),
    [openVacancies],
  );
  const locations = useMemo(
    () => Array.from(new Set(openVacancies.map((vacancy) => vacancy.location))),
    [openVacancies],
  );
  const employmentTypes = useMemo(
    () => Array.from(new Set(openVacancies.map((vacancy) => vacancy.employmentType))),
    [openVacancies],
  );
  const filtered = openVacancies.filter((job) => {
    const searchText = `${job.title} ${job.department} ${job.location}`.toLowerCase();
    return (
      searchText.includes(query.toLowerCase()) &&
      (department === "all" || job.department === department) &&
      (location === "all" || job.location === location) &&
      (employmentType === "all" || job.employmentType === employmentType)
    );
  });
  const clearFilters = () => {
    setQuery("");
    setDepartment("all");
    setLocation("all");
    setEmploymentType("all");
  };
  const hasActiveFilters =
    Boolean(query) || department !== "all" || location !== "all" || employmentType !== "all";

  return (
    <div className="min-h-screen bg-white text-slate-950">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/92 backdrop-blur-xl">
        <div className="mx-auto flex h-[76px] max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link to="/" aria-label="VIA International careers home">
            <BrandLogo className="h-12" />
          </Link>
          <nav aria-label="Primary navigation" className="flex items-center gap-1 sm:gap-3">
            <a
              href="#life-at-via"
              className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 md:block"
            >
              Life at VIA
            </a>
            <a
              href="#openings"
              className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 sm:block"
            >
              Open roles
            </a>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="rounded-full border-slate-300 bg-white px-4"
            >
              <Link to="/staff">Staff portal</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main>
        <section className="relative isolate min-h-[660px] overflow-hidden bg-[#092f55] text-white sm:min-h-[700px]">
          <img
            src={heroImage}
            alt="Container terminal and international freight operations"
            width={1600}
            height={1000}
            className="absolute inset-0 -z-20 h-full w-full object-cover object-center"
          />
          <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(5,32,61,.97)_0%,rgba(7,47,84,.88)_45%,rgba(8,55,93,.3)_100%)]" />
          <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-[#092f55]/80 to-transparent" />
          <div className="relative mx-auto flex min-h-[660px] max-w-7xl items-center px-5 py-20 sm:min-h-[700px] sm:px-8">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-100/80">
                Careers at VIA International
              </p>
              <h1 className="mt-7 max-w-3xl font-display text-5xl font-bold leading-[0.98] tracking-[-0.055em] sm:text-6xl lg:text-[5.25rem]">
                Build the career that moves the world forward.
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-blue-50/82 sm:text-xl">
                Join the people making international trade feel simple, from the first customer
                conversation to the final delivery.
              </p>
              <div className="mt-10 flex flex-col gap-3 sm:flex-row">
                <Button
                  asChild
                  size="lg"
                  className="bg-white text-[#0b4f86] shadow-xl shadow-slate-950/20 hover:bg-blue-50"
                >
                  <a href="#openings">
                    Explore {openVacancies.length || "current"}{" "}
                    {openVacancies.length === 1 ? "opportunity" : "opportunities"}
                    <ArrowRight className="ml-1" />
                  </a>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="border-white/25 bg-white/5 text-white hover:bg-white/12 hover:text-white"
                >
                  <a href="#life-at-via">Discover life at VIA</a>
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section id="life-at-via" className="bg-slate-50 py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="grid gap-12 lg:grid-cols-[.85fr_1.15fr] lg:items-end">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0d639f]">
                  How we work
                </p>
                <h2 className="mt-4 font-display text-4xl font-bold leading-tight tracking-[-0.045em] text-slate-950 sm:text-5xl">
                  Ambitious people.
                  <br />
                  Practical impact.
                </h2>
              </div>
              <p className="max-w-2xl text-lg leading-8 text-slate-600">
                Logistics rewards clarity, care and momentum. At VIA, your judgement matters and
                your work is visible. We solve real operational problems with colleagues who value
                reliability as much as speed.
              </p>
            </div>
            <div className="mt-12 grid gap-5 md:grid-cols-3">
              {principles.map(({ icon: Icon, title, description }, index) => (
                <article
                  key={title}
                  className="rounded-2xl border border-slate-200 bg-white p-7 shadow-[0_20px_60px_-45px_rgba(15,50,90,.45)]"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-[#0d639f]">
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="text-xs font-bold tabular-nums text-slate-300">
                      0{index + 1}
                    </span>
                  </div>
                  <h3 className="mt-8 text-xl font-bold tracking-[-0.025em]">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="openings" className="scroll-mt-20 py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0d639f]">
                  Find your place
                </p>
                <h2 className="mt-3 font-display text-4xl font-bold tracking-[-0.045em] sm:text-5xl">
                  Open opportunities
                </h2>
                <p className="mt-3 text-slate-600">
                  {openVacancies.length} {openVacancies.length === 1 ? "role is" : "roles are"}{" "}
                  currently open.
                </p>
              </div>
              {openVacancies.length > 0 && (
                <div className="relative w-full lg:w-80">
                  <label htmlFor="career-search" className="sr-only">
                    Search open roles
                  </label>
                  <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="career-search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search by role, team or location"
                    className="h-12 rounded-xl border-slate-300 bg-white pl-11"
                  />
                </div>
              )}
            </div>
            {openVacancies.length > 0 && (
              <div className="mt-8 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:flex-row">
                <Select value={department} onValueChange={setDepartment}>
                  <SelectTrigger
                    aria-label="Filter by department"
                    className="h-11 bg-white sm:w-52"
                  >
                    <SelectValue placeholder="Department" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All departments</SelectItem>
                    {departments.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={location} onValueChange={setLocation}>
                  <SelectTrigger aria-label="Filter by location" className="h-11 bg-white sm:w-52">
                    <SelectValue placeholder="Location" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All locations</SelectItem>
                    {locations.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={employmentType} onValueChange={setEmploymentType}>
                  <SelectTrigger
                    aria-label="Filter by employment type"
                    className="h-11 bg-white sm:w-52"
                  >
                    <SelectValue placeholder="Employment type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All employment types</SelectItem>
                    {employmentTypes.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {hasActiveFilters && (
                  <Button variant="ghost" onClick={clearFilters}>
                    <X /> Clear filters
                  </Button>
                )}
              </div>
            )}
            <div className="mt-8 grid gap-4">
              {filtered.length > 0 ? (
                filtered.map((job) => (
                  <Card
                    key={job.id}
                    className="group relative overflow-hidden border-slate-200 bg-white transition-all duration-300 hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-[0_24px_70px_-45px_rgba(9,67,113,.55)]"
                  >
                    <CardContent className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
                      <div>
                        <Badge
                          variant="secondary"
                          className="mb-4 rounded-full bg-blue-50 px-3 text-[#0d639f]"
                        >
                          {job.department}
                        </Badge>
                        <h3 className="text-2xl font-bold tracking-[-0.03em] group-hover:text-[#0d639f]">
                          <Link
                            to="/jobs/$jobId"
                            params={{ jobId: job.id }}
                            className="before:absolute before:inset-0"
                          >
                            {job.title}
                          </Link>
                        </h3>
                        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-500">
                          <span className="inline-flex items-center gap-2">
                            <MapPin className="h-4 w-4" />
                            {job.location}
                          </span>
                          <span className="inline-flex items-center gap-2">
                            <Building2 className="h-4 w-4" />
                            {job.employmentType}
                          </span>
                          <span className="inline-flex items-center gap-2">
                            <Clock3 className="h-4 w-4" />
                            Target start {job.targetStartDate || "to be agreed"}
                          </span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 font-bold text-[#0d639f]">
                        View role{" "}
                        <ArrowRight className="transition-transform group-hover:translate-x-1" />
                      </div>
                    </CardContent>
                  </Card>
                ))
              ) : (
                <div className="overflow-hidden rounded-3xl border border-slate-200 bg-[#f7fafc]">
                  <div className="grid min-h-[360px] lg:grid-cols-[1.15fr_.85fr]">
                    <div className="flex flex-col justify-center p-8 sm:p-12">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100 text-[#0d639f]">
                        <BriefcaseBusiness />
                      </div>
                      <h3 className="mt-7 max-w-lg text-3xl font-bold tracking-[-0.035em]">
                        {hasActiveFilters
                          ? "No roles match those filters."
                          : "The next opportunity is taking shape."}
                      </h3>
                      <p className="mt-4 max-w-xl leading-7 text-slate-600">
                        {hasActiveFilters
                          ? "Try broadening your search or clearing the filters to see every available role."
                          : "We do not have a published vacancy today, but our teams continue to grow. Check back soon for opportunities across operations, compliance and corporate services."}
                      </p>
                      {hasActiveFilters && (
                        <div className="mt-7">
                          <Button variant="outline" onClick={clearFilters}>
                            Clear all filters
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="relative hidden overflow-hidden bg-[#0a3f70] lg:block">
                      <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full border-[48px] border-white/5" />
                      <div className="absolute -bottom-20 -left-16 h-72 w-72 rounded-full border-[52px] border-emerald-400/10" />
                      <div className="relative flex h-full items-end p-10 text-blue-50/80">
                        <p className="max-w-xs text-sm leading-6">
                          Good careers are built over time. We publish every approved opportunity
                          here so the process stays fair and transparent.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
      <footer className="bg-[#062d52] text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <BrandLogo invert className="h-11" />
          <div className="text-sm text-blue-100/65 sm:text-right">
            <p>VIA International · People who keep trade moving.</p>
            <p className="mt-1">Equal opportunity. Respectful hiring. Clear decisions.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
