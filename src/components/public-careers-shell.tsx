import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
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
  return (
    <footer className="bg-[#07558e] text-white">
      <div className="mx-auto grid max-w-[1480px] gap-10 px-5 py-12 sm:px-8 md:grid-cols-[1fr_auto] lg:px-10 lg:py-16">
        <div>
          <BrandLogo invert className="h-14" />
          <p className="mt-6 max-w-xl text-sm leading-6 text-blue-50/80">
            Civil engineering solutions for roads, bridges, water, geotechnics and the built
            environment.
          </p>
        </div>
        <div className="grid gap-8 text-sm sm:grid-cols-2 sm:gap-14">
          <div>
            <p className="font-semibold uppercase tracking-[0.12em] text-blue-100">VIA online</p>
            <div className="mt-4 flex flex-col items-start gap-3 text-blue-50/85">
              <a href="https://www.via-int.com/" className="hover:text-white">
                Corporate website
              </a>
              <Link to="/" className="hover:text-white">
                Careers
              </Link>
            </div>
          </div>
          <div>
            <p className="font-semibold uppercase tracking-[0.12em] text-blue-100">Contact</p>
            <a
              href="https://www.via-int.com/#contact"
              className="mt-4 inline-flex items-center gap-2 text-blue-50/85 hover:text-white"
            >
              Our offices and contacts <ArrowUpRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>
      <div className="border-t border-white/15">
        <div className="mx-auto flex max-w-[1480px] flex-col gap-2 px-5 py-5 text-xs text-blue-100/70 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10">
          <p>VIA International. Engineering consultancy.</p>
          <p>Italy · Oman · Uganda · United Arab Emirates</p>
        </div>
      </div>
    </footer>
  );
}

export function PublicCareersPage({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-white text-slate-950">{children}</div>;
}
