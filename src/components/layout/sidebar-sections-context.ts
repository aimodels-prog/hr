import { createContext, useContext } from "react";

export const SidebarSectionsContext = createContext<{
  target: HTMLDivElement | null;
  setTarget: (target: HTMLDivElement | null) => void;
  closeMobile: () => void;
} | null>(null);

export const useSidebarSections = () => useContext(SidebarSectionsContext);
