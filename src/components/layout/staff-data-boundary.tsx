import { useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useLocation } from "@tanstack/react-router";
import { useCurrentUser } from "@/lib/auth";
import { staffPageModules, type StaffModule } from "@/lib/data/staff-module-plan";
import { Button } from "@/components/ui/button";
import { ApplicationBootScreen } from "./application-boot-screen";

import { StaffDataContext } from "./staff-data-context";

export function StaffDataBoundary({
  modules,
  children,
}: {
  modules: readonly StaffModule[];
  children: ReactNode;
}) {
  const loader = useContext(StaffDataContext);
  if (!loader) throw new Error("Staff data must be loaded within a staff workspace.");
  const state = useSyncExternalStore(loader.subscribe, loader.getSnapshot, loader.getSnapshot);
  const moduleKey = modules.join("|");
  useEffect(() => {
    void loader
      .ensure(moduleKey ? (moduleKey.split("|") as StaffModule[]) : [])
      .catch(() => undefined);
  }, [loader, moduleKey]);
  const error = modules.map((module) => state[module]).find((item) => item?.status === "error");
  if (error)
    return (
      <div role="alert" className="rounded-xl border bg-card p-5 text-sm">
        <p>{error.error}</p>
        <Button
          className="mt-3"
          variant="outline"
          onClick={() => void loader.retry(modules).catch(() => undefined)}
        >
          Try again
        </Button>
      </div>
    );
  if (modules.some((module) => state[module]?.status !== "ready"))
    return <ApplicationBootScreen compact />;
  return <>{children}</>;
}

export function StaffPageBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { activeRole } = useCurrentUser();
  const section = new URLSearchParams(location.searchStr).get("section") ?? "";
  return (
    <StaffDataBoundary
      modules={staffPageModules(location.pathname, location.hash, section, activeRole)}
    >
      {children}
    </StaffDataBoundary>
  );
}
