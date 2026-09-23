import { lazy, Suspense } from "react";

const WorkforceCharts = lazy(() => import("./workforce-charts"));
export interface DashboardChartsProps {
  scope: "self" | "hr";
  employeeId?: string;
  profileId?: string;
}
export function DashboardCharts(props: DashboardChartsProps) {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-4 text-sm text-muted-foreground">
          Loading charts…
        </p>
      }
    >
      <WorkforceCharts {...props} />
    </Suspense>
  );
}
