import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Building2, Clock3, MapPin, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import bridgeImage from "@/assets/via-mughsayl-bridge.jpg";
import workImage from "@/assets/via-work-with-us.jpg";
import {
  PublicCareersFooter,
  PublicCareersHeader,
  PublicCareersPage,
} from "@/components/public-careers-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Vacancy } from "@/lib/data/types";
import { VacancyService } from "@/lib/data/vacancy-service";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Careers | VIA International" },
      {
        name: "description",
        content:
          "Explore careers at VIA International, an international civil engineering consultancy working across infrastructure, water, geotechnics and buildings.",
      },
      { property: "og:title", content: "Careers | VIA International" },
      {
        property: "og:description",
        content: "Join VIA International and contribute to engineering projects across the world.",
      },
    ],
  }),
  component: CareerPortal,
});

const expertise = [
  "Civil Infrastructure",
  "Water & Environment",
  "Geology & Geotechnics",
  "Buildings & Architecture",
];

function CareerPortal() {
  const vacancyService = useMemo(() => new VacancyService(), []);
  const [openVacancies, setOpenVacancies] = useState<Vacancy[]>([]);
  const [vacanciesReady, setVacanciesReady] = useState(false);
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("all");
  const [location, setLocation] = useState("all");
  const [employmentType, setEmploymentType] = useState("all");

  useEffect(() => {
    let cancelled = false;
    vacancyService
      .hydrateCompatibilityCache()
      .then(() => {
        if (cancelled) return;
        setOpenVacancies(
          vacancyService
            .getVacancyRepository()
            .list()
            .filter((vacancy) => vacancy.status === "Open"),
        );
      })
      .catch(() => {
        if (!cancelled) setOpenVacancies([]);
      })
      .finally(() => {
        if (!cancelled) setVacanciesReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [vacancyService]);

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
      searchText.includes(query.trim().toLowerCase()) &&
      (department === "all" || job.department === department) &&
      (location === "all" || job.location === location) &&
      (employmentType === "all" || job.employmentType === employmentType)
    );
  });
  const hasActiveFilters =
    Boolean(query) || department !== "all" || location !== "all" || employmentType !== "all";
  const clearFilters = () => {
    setQuery("");
    setDepartment("all");
    setLocation("all");
    setEmploymentType("all");
  };

  return (
    <PublicCareersPage>
      <PublicCareersHeader />
      <main>
        <section className="relative isolate min-h-[620px] overflow-hidden bg-[#174c70] text-white lg:min-h-[720px]">
          <img
            src={bridgeImage}
            alt="Mughsayl Bridge, a VIA International infrastructure project in Oman"
            className="absolute inset-0 -z-20 h-full w-full object-cover"
          />
          <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(5,48,82,.84)_0%,rgba(8,69,111,.54)_48%,rgba(8,69,111,.12)_100%)]" />
          <div className="mx-auto flex min-h-[620px] max-w-[1480px] items-center px-5 py-20 sm:px-8 lg:min-h-[720px] lg:px-10">
            <div className="max-w-[830px]">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white/85">
                Careers at VIA International
              </p>
              <h1 className="mt-7 text-[3.6rem] font-normal leading-[0.96] tracking-[-0.045em] sm:text-7xl lg:text-[6.25rem]">
                Engineer the places people depend on.
              </h1>
              <p className="mt-8 max-w-2xl text-lg leading-8 text-white/88 sm:text-xl">
                Work with an international team designing roads, bridges, water systems and
                buildings that serve communities for generations.
              </p>
              <a
                href="#openings"
                className="mt-10 inline-flex min-h-12 items-center gap-3 bg-white px-6 py-3 text-sm font-semibold uppercase tracking-[0.08em] text-[#07558e] transition-colors hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
              >
                View open positions <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          </div>
        </section>

        <section id="life-at-via" className="bg-white py-20 sm:py-28">
          <div className="mx-auto grid max-w-[1480px] gap-12 px-5 sm:px-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-center lg:gap-20 lg:px-10">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.15em] text-[#0a5d9c]">
                Work with us
              </p>
              <h2 className="mt-5 max-w-2xl text-4xl font-normal leading-[1.05] tracking-[-0.035em] text-slate-950 sm:text-6xl">
                Make your experience part of something built to last.
              </h2>
              <div className="mt-8 max-w-2xl space-y-5 text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
                <p>
                  VIA International brings together engineers, designers, project managers and
                  technical specialists to solve complex civil engineering challenges.
                </p>
                <p>
                  Our teams contribute to projects across Europe, the Middle East and Africa,
                  combining local knowledge with international experience.
                </p>
              </div>
              <a
                href="https://www.via-int.com/#aboutus"
                className="mt-8 inline-flex items-center gap-3 border-b border-[#0a5d9c] pb-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#0a5d9c]"
              >
                Learn about VIA International <ArrowRight className="h-4 w-4" />
              </a>
            </div>
            <figure className="relative min-h-[390px] overflow-hidden bg-slate-100 sm:min-h-[520px]">
              <img
                src={workImage}
                alt="Road and infrastructure works delivered by VIA International"
                className="absolute inset-0 h-full w-full object-cover"
              />
            </figure>
          </div>
        </section>

        <section id="expertise" className="scroll-mt-16 bg-[#07558e] text-white">
          <div className="mx-auto max-w-[1480px] px-5 py-16 sm:px-8 lg:px-10 lg:py-20">
            <p className="text-sm font-semibold uppercase tracking-[0.15em] text-blue-100">
              Our expertise
            </p>
            <div className="mt-8 grid border-y border-white/25 sm:grid-cols-2 lg:grid-cols-4">
              {expertise.map((item, index) => (
                <div
                  key={item}
                  className="flex min-h-36 flex-col justify-between border-b border-white/20 py-6 sm:px-6 sm:first:pl-0 sm:[&:nth-child(odd)]:border-r lg:border-b-0 lg:border-r lg:last:border-r-0"
                >
                  <span className="text-xs tabular-nums text-blue-100/70">0{index + 1}</span>
                  <p className="mt-8 max-w-[14rem] text-xl leading-tight">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="openings" className="scroll-mt-16 bg-[#f5f6f6] py-20 sm:py-28">
          <div className="mx-auto max-w-[1280px] px-5 sm:px-8 lg:px-10">
            <div className="grid gap-8 lg:grid-cols-[1fr_360px] lg:items-end">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.15em] text-[#0a5d9c]">
                  Join VIA
                </p>
                <h2 className="mt-4 text-4xl font-normal tracking-[-0.035em] sm:text-6xl">
                  Open positions
                </h2>
                <p className="mt-4 text-slate-600" aria-live="polite">
                  {vacanciesReady
                    ? `${openVacancies.length} ${openVacancies.length === 1 ? "position" : "positions"} currently available`
                    : "Loading current positions"}
                </p>
              </div>
              {openVacancies.length > 0 && (
                <div className="relative">
                  <label htmlFor="career-search" className="sr-only">
                    Search open positions
                  </label>
                  <Search className="absolute left-0 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
                  <Input
                    id="career-search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search positions"
                    className="h-13 rounded-none border-0 border-b border-slate-400 bg-transparent pl-8 shadow-none focus-visible:ring-0"
                  />
                </div>
              )}
            </div>

            {openVacancies.length > 0 && (
              <div className="mt-12 grid gap-3 border-y border-slate-300 py-5 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto]">
                <Select value={department} onValueChange={setDepartment}>
                  <SelectTrigger aria-label="Filter by discipline" className="h-11 bg-white">
                    <SelectValue placeholder="Discipline" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All disciplines</SelectItem>
                    {departments.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={location} onValueChange={setLocation}>
                  <SelectTrigger aria-label="Filter by office" className="h-11 bg-white">
                    <SelectValue placeholder="Office" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All offices</SelectItem>
                    {locations.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={employmentType} onValueChange={setEmploymentType}>
                  <SelectTrigger aria-label="Filter by employment type" className="h-11 bg-white">
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
                  <Button
                    variant="ghost"
                    onClick={clearFilters}
                    className="justify-start lg:justify-center"
                  >
                    <X className="h-4 w-4" /> Clear
                  </Button>
                )}
              </div>
            )}

            <div className="mt-6 border-t border-slate-300">
              {filtered.length > 0 ? (
                filtered.map((job) => (
                  <article
                    key={job.id}
                    className="group relative border-b border-slate-300 bg-transparent"
                  >
                    <Link
                      to="/jobs/$jobId"
                      params={{ jobId: job.id }}
                      className="grid gap-5 py-7 transition-colors hover:bg-white focus-visible:bg-white sm:px-5 lg:grid-cols-[1fr_1fr_auto] lg:items-center"
                    >
                      <div>
                        <Badge className="mb-3 rounded-none bg-[#0a5d9c] text-white hover:bg-[#0a5d9c]">
                          {job.department}
                        </Badge>
                        <h3 className="text-2xl font-medium tracking-[-0.025em] group-hover:text-[#0a5d9c]">
                          {job.title}
                        </h3>
                      </div>
                      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
                        <span className="inline-flex items-center gap-2">
                          <MapPin className="h-4 w-4" /> {job.location}
                        </span>
                        <span className="inline-flex items-center gap-2">
                          <Building2 className="h-4 w-4" /> {job.employmentType}
                        </span>
                        {job.targetStartDate && (
                          <span className="inline-flex items-center gap-2">
                            <Clock3 className="h-4 w-4" /> Start {job.targetStartDate}
                          </span>
                        )}
                      </div>
                      <span className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.06em] text-[#0a5d9c]">
                        View position
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                      </span>
                    </Link>
                  </article>
                ))
              ) : (
                <div className="border-b border-slate-300 py-16">
                  <h3 className="text-2xl font-medium">
                    {hasActiveFilters
                      ? "No positions match your search."
                      : "There are no published positions at present."}
                  </h3>
                  <p className="mt-3 max-w-2xl leading-7 text-slate-600">
                    {hasActiveFilters
                      ? "Adjust the filters to see other opportunities."
                      : "New positions are published here as they become available. Please visit again soon."}
                  </p>
                  {hasActiveFilters && (
                    <Button variant="outline" onClick={clearFilters} className="mt-6 rounded-none">
                      Clear all filters
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
      <PublicCareersFooter />
    </PublicCareersPage>
  );
}
