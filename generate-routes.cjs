const fs = require("fs");
const path = require("path");

const routes = [
  {
    name: "directory",
    title: "Employee Directory",
    perm: "employee:view_directory",
    parent: "Core HR",
  },
  { name: "files", title: "Employee Files", perm: "employee:view_all", parent: "Core HR" },
  { name: "documents", title: "Document Expiry", perm: "document:view_all", parent: "Core HR" },
  {
    name: "tracker",
    title: "Contact Tracker",
    perm: "recruitment:manage_candidates",
    parent: "Recruitment",
  },
  {
    name: "recommendations",
    title: "Recommendations",
    perm: "recruitment:view_candidates",
    parent: "Recruitment",
  },
  { name: "offers", title: "Offers", perm: "recruitment:manage_candidates", parent: "Recruitment" },
  { name: "leave", title: "Leave", perm: "leave:view_self", parent: "Time & Travel" },
  { name: "timesheets", title: "Timesheets", perm: "timesheet:view_self", parent: "Time & Travel" },
  {
    name: "attendance",
    title: "Attendance",
    perm: "attendance:view_self",
    parent: "Time & Travel",
  },
  { name: "travel", title: "Travel", perm: "travel:view_self", parent: "Time & Travel" },
  { name: "onboarding", title: "Onboarding", perm: "onboarding:view_self", parent: "Core HR" },
  { name: "offboarding", title: "Offboarding", perm: "offboarding:manage_all", parent: "Core HR" },
  { name: "performance", title: "Performance", perm: "performance:view_self", parent: "Talent" },
  { name: "training", title: "Training", perm: "training:view_all", parent: "Talent" },
  { name: "reports", title: "Reports", perm: "system:audit_view", parent: "System" },
  { name: "audit", title: "Audit History", perm: "system:audit_view", parent: "System" },
  { name: "settings", title: "Settings", perm: "system:settings_manage", parent: "System" },
];

routes.forEach((route) => {
  const content = `import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/placeholder-page";
import { RequirePermission } from "@/lib/auth";

export const Route = createFileRoute("/staff/${route.name}")({
  component: ${route.name.charAt(0).toUpperCase() + route.name.slice(1)}Route,
});

function ${route.name.charAt(0).toUpperCase() + route.name.slice(1)}Route() {
  return (
    <RequirePermission permission="${route.perm}" resourceName="${route.title}">
      <PlaceholderPage
        title="${route.title}"
        breadcrumbs={[{ label: "${route.parent}" }, { label: "${route.title}" }]}
      />
    </RequirePermission>
  );
}
`;

  fs.writeFileSync(path.join(__dirname, "src", "routes", "staff", `${route.name}.tsx`), content);
});

console.log("Created 17 placeholder routes.");
