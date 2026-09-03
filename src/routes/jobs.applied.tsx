import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { CheckCircle2, ArrowRight } from "lucide-react";
import * as z from "zod";

import {
  PublicCareersFooter,
  PublicCareersHeader,
  PublicCareersPage,
} from "@/components/public-careers-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/jobs/applied")({
  validateSearch: z.object({
    ref: z.string().optional(),
  }),
  head: () => ({
    meta: [{ title: "Application Received — VIA International" }],
  }),
  component: ApplicationReceived,
});

function ApplicationReceived() {
  const { ref } = Route.useSearch();

  const isDuplicate = ref === "DUPLICATE";

  return (
    <PublicCareersPage>
      <PublicCareersHeader compact />
      <main className="bg-[#f5f6f6] px-5 py-16 sm:py-24">
        <div className="mx-auto max-w-2xl">
          <Card className="rounded-none border-0 border-t-4 border-t-[#07558e] shadow-sm">
            <CardContent className="flex flex-col items-center px-6 py-12 text-center sm:px-12">
              <div className="mb-7 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
                <CheckCircle2 className="h-8 w-8 text-emerald-700" />
              </div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#0a5d9c]">
                Careers at VIA International
              </p>
              <h1 className="mt-3 text-4xl font-normal">Application received</h1>

              <p className="mb-7 mt-4 max-w-lg leading-7 text-slate-600">
                Thank you for your interest in VIA International. Our team will review your
                application and contact you if your experience matches the position.
              </p>

              {ref && !isDuplicate && (
                <div className="mb-8 w-full border border-slate-200 bg-[#f5f6f6] px-6 py-5">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Application reference
                  </p>
                  <p className="font-mono text-2xl font-semibold tracking-widest text-slate-950">
                    {ref}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    Keep this reference for any correspondence about your application.
                  </p>
                </div>
              )}

              <Button
                asChild
                size="lg"
                className="w-full rounded-none bg-[#07558e] hover:bg-[#064875] sm:w-auto"
              >
                <Link to="/">
                  View open positions <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
      <PublicCareersFooter />
    </PublicCareersPage>
  );
}
