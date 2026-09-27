import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useSidebar } from "@/components/ui/sidebar";
import { SidebarSectionsContext } from "./sidebar-sections-context";

/** Page navigation lives beneath the active destination in the main sidebar. */
export function SidebarSectionsProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const { setOpenMobile } = useSidebar();
  const closeMobile = useCallback(() => setOpenMobile(false), [setOpenMobile]);
  const value = useMemo(() => ({ target, setTarget, closeMobile }), [target, closeMobile]);
  return (
    <SidebarSectionsContext.Provider value={value}>{children}</SidebarSectionsContext.Provider>
  );
}
