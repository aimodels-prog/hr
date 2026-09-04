import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/staff/documents")({
  beforeLoad: () => {
    throw redirect({ to: "/staff/files" });
  },
});
