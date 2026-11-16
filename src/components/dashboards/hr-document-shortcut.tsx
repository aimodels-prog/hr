import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, FileUp, Search } from "lucide-react";
import type { Employee } from "@/lib/data/types";
import { Input } from "@/components/ui/input";

export function HrDocumentShortcut({ employees }: { employees: Employee[] }) {
  const [search, setSearch] = useState("");
  const matches = search.trim()
    ? employees
        .filter(
          (employee) =>
            employee.status !== "Inactive" &&
            employee.status !== "Archived" &&
            `${employee.preferredName ?? ""} ${employee.legalName} ${employee.workEmail}`
              .toLowerCase()
              .includes(search.trim().toLowerCase()),
        )
        .slice(0, 8)
    : [];

  return (
    <section
      id="upload-document"
      className="rounded-2xl border border-primary/20 bg-card p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
          <FileUp className="size-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-base font-semibold">Upload a staff document</h2>
          <p className="text-sm text-muted-foreground">
            Find the employee, then add the file directly.
          </p>
        </div>
      </div>
      <div className="relative mt-4 max-w-xl">
        <Search
          className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-11 pl-9"
          placeholder="Search employee name or email"
          aria-label="Find an employee to upload a document"
        />
      </div>
      {search.trim() && (
        <div className="mt-2 max-h-72 max-w-xl overflow-y-auto rounded-xl border bg-background">
          {matches.length ? (
            matches.map((employee) => (
              <Link
                key={employee.id}
                to="/staff/employees/$employeeId"
                params={{ employeeId: employee.id }}
                hash="section=documents&upload=new"
                className="flex min-h-12 items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {employee.preferredName || employee.legalName}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {employee.workEmail}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">
                  Upload <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </span>
              </Link>
            ))
          ) : (
            <p className="p-3 text-sm text-muted-foreground">No employee found.</p>
          )}
        </div>
      )}
    </section>
  );
}
