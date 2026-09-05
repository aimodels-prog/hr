import type { ReactNode } from "react";

import {
  PublicCareersFooter,
  PublicCareersHeader,
  PublicCareersPage,
} from "@/components/public-careers-shell";

export function PublicInformationPage({
  eyebrow,
  title,
  introduction,
  children,
}: {
  eyebrow: string;
  title: string;
  introduction: string;
  children: ReactNode;
}) {
  return (
    <PublicCareersPage>
      <PublicCareersHeader compact />
      <main>
        <header className="bg-[#07558e] text-white">
          <div className="mx-auto max-w-[1120px] px-5 py-16 sm:px-8 sm:py-20 lg:px-10">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-100">
              {eyebrow}
            </p>
            <h1 className="mt-5 max-w-4xl text-4xl font-normal tracking-[-0.04em] sm:text-6xl">
              {title}
            </h1>
            <p className="mt-6 max-w-3xl text-base leading-8 text-blue-50/85 sm:text-lg">
              {introduction}
            </p>
          </div>
        </header>
        <div className="mx-auto max-w-[1120px] px-5 py-14 sm:px-8 sm:py-20 lg:px-10">
          <div className="max-w-3xl space-y-10 text-[15px] leading-7 text-slate-700 [&_a]:font-medium [&_a]:text-[#07558e] [&_a]:underline-offset-4 hover:[&_a]:underline [&_h2]:mb-4 [&_h2]:text-2xl [&_h2]:font-medium [&_h2]:tracking-[-0.025em] [&_h2]:text-slate-950 [&_li]:pl-1 [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-2">
            {children}
          </div>
        </div>
      </main>
      <PublicCareersFooter />
    </PublicCareersPage>
  );
}
