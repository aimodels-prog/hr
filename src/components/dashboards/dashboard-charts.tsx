import { lazy, Suspense } from "react";

const WorkforceCharts = lazy(() => import("./workforce-charts"));
export function DashboardCharts({ scope }: { scope: "self" | "hr" }) {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-4 text-sm text-muted-foreground">
          Loading charts…
        </p>
      }
    >
      <WorkforceCharts scope={scope} />
    </Suspense>
  );
}
