import { createContext } from "react";
import type { StaffModuleLoader } from "@/lib/data/staff-module-loader";

export const StaffDataContext = createContext<StaffModuleLoader | null>(null);
