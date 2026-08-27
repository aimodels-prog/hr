import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { CheckCircle2, ArrowRight } from "lucide-react";
import * as z from "zod";

import { BrandLogo } from "@/components/brand-logo";
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
    <div className="min-h-screen bg-muted/20">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <BrandLogo />
        </div>
      </header>

      <div className="mx-auto max-w-xl px-4 py-20">
        <Card className="border-primary/20 shadow-md">
          <CardContent className="pt-10 pb-10 flex flex-col items-center text-center">
            <div className="h-16 w-16 rounded-full bg-success/20 flex items-center justify-center mb-6">
              <CheckCircle2 className="h-8 w-8 text-success" />
            </div>
            <h1 className="text-3xl font-semibold mb-3">Application Received</h1>
            
            <p className="text-muted-foreground mb-6">
              Thank you for applying to VIA International. Our people team will review your application and get back to you within 5 working days.
            </p>

            {ref && !isDuplicate && (
              <div className="bg-muted px-6 py-4 rounded-lg w-full mb-8">
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-1">Your Application Reference</p>
                <p className="text-2xl font-mono font-semibold text-foreground tracking-widest">{ref}</p>
                <p className="text-xs text-muted-foreground mt-2">Please quote this reference in any correspondence.</p>
              </div>
            )}

            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link to="/">
                Explore more roles <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
