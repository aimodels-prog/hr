import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/staff/timesheets")({
  beforeLoad: () => {
    throw redirect({
      to: "/staff/me/timesheets",
    });
  },
});
