import { lazy, Suspense, type ReactNode } from "react";
import { ApplicationBootScreen } from "@/components/layout/application-boot-screen";

const WorkforceCharts = lazy(() => import("./workforce-charts"));
export interface DashboardChartsProps {
  scope: "self" | "hr";
  employeeId?: string;
  profileId?: string;
  toolbar?: ReactNode;
}
export function DashboardCharts(props: DashboardChartsProps) {
  return (
    <Suspense fallback={<ApplicationBootScreen compact />}>
      <WorkforceCharts {...props} />
    </Suspense>
  );
}
