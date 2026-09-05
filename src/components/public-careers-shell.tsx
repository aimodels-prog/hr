import { Link } from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight, Linkedin, Mail, MapPin } from "lucide-react";
import type { ReactNode } from "react";

import { BrandLogo } from "@/components/brand-logo";

const careersLinks = [
  { label: "Life at VIA", hash: "life-at-via" },
  { label: "Our expertise", hash: "expertise" },
  { label: "Open positions", hash: "openings" },
] as const;

export function PublicCareersHeader({ compact = false }: { compact?: boolean }) {
  return (
    <header className="relative z-40 border-b border-slate-200 bg-white">
      <div
        className={`mx-auto flex max-w-[1480px] items-center justify-between px-5 sm:px-8 lg:px-10 ${
          compact ? "h-[82px]" : "h-[98px]"
        }`}
      >
        <div className="flex shrink-0 items-center gap-4 sm:gap-5">
          <Link to="/" aria-label="VIA International careers home">
            <BrandLogo className={compact ? "h-12" : "h-14 sm:h-16"} />
          </Link>
          <span className="hidden border-l border-slate-300 pl-4 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600 sm:inline">
            Careers
          </span>
        </div>

        <nav aria-label="Careers" className="hidden items-center gap-8 lg:flex">
          {careersLinks.map((item) => (
            <Link
              key={item.label}
              to="/"
              hash={item.hash}
              className="text-[13px] font-semibold uppercase tracking-[0.035em] text-slate-950 transition-colors hover:text-[#0a5d9c]"
            >
              {item.label}
            </Link>
          ))}
          <a
            href="https://www.via-int.com/"
            className="inline-flex items-center gap-2 border-l border-slate-300 pl-8 text-[13px] font-semibold uppercase tracking-[0.035em] text-[#0a5d9c] transition-colors hover:text-[#074777]"
          >
            VIA International <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </nav>

        <div className="flex items-center gap-4 lg:hidden">
          <Link
            to="/"
            hash="openings"
            className="text-xs font-semibold uppercase tracking-[0.08em] text-[#0a5d9c]"
          >
            Open roles
          </Link>
        </div>
      </div>
    </header>
  );
}

export function PublicCareersFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-[#07558e] text-white">
      <div className="border-b border-white/15">
        <div className="mx-auto flex max-w-[1480px] flex-col gap-7 px-5 py-10 sm:px-8 md:flex-row md:items-center md:justify-between lg:px-10">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-100">
              Your next chapter
            </p>
            <p className="mt-3 max-w-2xl text-2xl font-normal tracking-[-0.025em] sm:text-3xl">
              Bring your experience to work that matters.
            </p>
          </div>
          <Link
            to="/"
            hash="openings"
            className="inline-flex min-h-12 w-fit items-center gap-3 bg-white px-6 py-3 text-sm font-semibold uppercase tracking-[0.08em] text-[#07558e] transition-colors hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            View open positions <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1480px] gap-12 px-5 py-12 sm:px-8 md:grid-cols-2 lg:grid-cols-[1.35fr_.75fr_.85fr_1fr] lg:px-10 lg:py-16">
        <div>
          <a href="https://www.via-int.com/" aria-label="Visit the VIA International website">
            <BrandLogo invert className="h-14" />
          </a>
          <p className="mt-6 max-w-md text-sm leading-6 text-blue-50/80">
            International civil engineering consultancy delivering transport, water, geotechnical
            and building projects across established regional offices.
          </p>
          <a
            href="https://www.linkedin.com/company/via-international-llc"
            className="mt-7 inline-flex items-center gap-2 text-sm font-medium text-blue-50/90 hover:text-white"
            aria-label="Follow VIA International on LinkedIn"
          >
            <Linkedin className="h-4 w-4" aria-hidden="true" /> LinkedIn
          </a>
        </div>

        <div className="text-sm">
          <p className="font-semibold uppercase tracking-[0.12em] text-blue-100">Careers</p>
          <nav
            aria-label="Careers footer"
            className="mt-4 flex flex-col items-start gap-3 text-blue-50/85"
          >
            {careersLinks.map((item) => (
              <Link key={item.label} to="/" hash={item.hash} className="hover:text-white">
                {item.label}
              </Link>
            ))}
            <Link to="/candidate-privacy" className="hover:text-white">
              Candidate privacy
            </Link>
          </nav>
        </div>

        <div className="text-sm">
          <p className="font-semibold uppercase tracking-[0.12em] text-blue-100">VIA online</p>
          <div className="mt-4 flex flex-col items-start gap-3 text-blue-50/85">
            <a
              href="https://www.via-int.com/"
              className="inline-flex items-center gap-2 hover:text-white"
            >
              Corporate website <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </a>
            <a
              href="https://www.via-int.com/projects/"
              className="inline-flex items-center gap-2 hover:text-white"
            >
              Projects <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </a>
            <a
              href="https://www.via-int.com/#theteam"
              className="inline-flex items-center gap-2 hover:text-white"
            >
              Our team <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        </div>

        <div className="text-sm">
          <p className="font-semibold uppercase tracking-[0.12em] text-blue-100">Contact</p>
          <div className="mt-4 flex flex-col items-start gap-4 text-blue-50/85">
            <a
              href="mailto:hr@via-int.com"
              className="inline-flex items-center gap-2 hover:text-white"
            >
              <Mail className="h-4 w-4" aria-hidden="true" /> hr@via-int.com
            </a>
            <a
              href="https://www.via-int.com/#contact"
              className="inline-flex items-start gap-2 hover:text-white"
            >
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Palermo · Muscat · Kampala · Dubai · Riyadh</span>
            </a>
          </div>
        </div>
      </div>

      <div className="border-t border-white/15">
        <div className="mx-auto flex max-w-[1480px] flex-col gap-4 px-5 py-5 text-xs text-blue-100/70 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-10">
          <p>© {currentYear} VIA International. All rights reserved.</p>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2">
            <Link to="/privacy" className="hover:text-white">
              Privacy
            </Link>
            <Link to="/terms" className="hover:text-white">
              Terms
            </Link>
            <Link to="/accessibility" className="hover:text-white">
              Accessibility
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}

export function PublicCareersPage({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-white text-slate-950">{children}</div>;
}
