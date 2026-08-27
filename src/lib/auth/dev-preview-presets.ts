import type { Role } from "../data/types.ts";

export interface DevPreviewPreset {
  key: "employee" | "manager" | "hr" | "accounts" | "admin";
  roleName: Role;
  userId: string;
  employeeName: string;
  jobTitle: string;
  description: string;
}

export const PRESET_IDENTITIES: DevPreviewPreset[] = [
  {
    key: "employee",
    roleName: "Employee",
    userId: "user-omar",
    employeeName: "Omar Rahman",
    jobTitle: "Project Engineer",
    description: "Standard employee access; sees only self data.",
  },
  {
    key: "manager",
    roleName: "Line Manager",
    userId: "user-layla",
    employeeName: "Layla Al Harthy",
    jobTitle: "Operations Director",
    description: "Line manager; sees self plus direct reports (Omar, Tariq).",
  },
  {
    key: "hr",
    roleName: "HR",
    userId: "user-rana",
    employeeName: "Rana Nair",
    jobTitle: "HR Manager",
    description: "HR operations; full employee/recruitment access, no payroll prep.",
  },
  {
    key: "accounts",
    roleName: "Accounts",
    userId: "user-mariam",
    employeeName: "Mariam Said",
    jobTitle: "Senior Accountant",
    description: "Finance & payroll; sees payroll/travel finance, no private HR notes.",
  },
  {
    key: "admin",
    roleName: "Super Admin",
    userId: "user-super-admin",
    employeeName: "Yusuf Al Balushi",
    jobTitle: "Managing Director",
    description: "Complete system access to all internal modules and settings.",
  },
];
