import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/staff/payroll/")({
  beforeLoad: () => {
    throw redirect({
      to: "/staff/payroll/periods",
    });
  },
});
