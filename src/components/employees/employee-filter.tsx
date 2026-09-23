import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { EmployeeService } from "@/lib/data/employee-service";
import { useCurrentUser } from "@/lib/auth";

export function employeeSearch(search: Record<string, unknown>): {
  employeeId?: string | undefined;
  days?: 7 | 30 | undefined;
  from?: string | undefined;
  until?: string | undefined;
} {
  const date = (value: unknown) =>
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
  return {
    employeeId: typeof search["employeeId"] === "string" ? search["employeeId"] : undefined,
    days: Number(search["days"]) === 7 ? 7 : Number(search["days"]) === 30 ? 30 : undefined,
    from: date(search["from"]),
    until: date(search["until"]),
  };
}

/** Filters already permission-scoped records; never grants access to additional records. */
export function useEmployeeFilter() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useCurrentUser();
  const service = useMemo(() => new EmployeeService(), []);
  const [term, setTerm] = useState("");
  const { employeeId } = employeeSearch(location.search);
  const employees = service.getDirectoryEmployees(user.getActorContext());
  const selected = employees.find((person) => person.id === employeeId);
  const matches = employees.filter((person) =>
    `${person.legalName} ${person.preferredName} ${person.workEmail}`
      .toLowerCase()
      .includes(term.trim().toLowerCase()),
  );
  const select = (id?: string) => {
    setTerm("");
    void navigate({
      to: ".",
      search: (previous) => ({ ...previous, employeeId: id }),
      replace: true,
    });
  };
  const control = (
    <section className="space-y-2 rounded-lg border bg-card p-3" aria-label="Filter by employee">
      <label className="block text-sm font-medium">
        Employee name or VIA email
        <input
          type="search"
          className="mt-1 h-11 w-full rounded-md border bg-background px-3"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search employee"
        />
      </label>
      {term.trim() && (
        <ul className="max-h-52 overflow-y-auto">
          {matches.map((person) => (
            <li key={person.id}>
              <button
                className="w-full p-2 text-left text-sm hover:bg-muted"
                onClick={() => select(person.id)}
              >
                {person.preferredName || person.legalName} — {person.workEmail}
              </button>
            </li>
          ))}
          {!matches.length && <li>No matching employees.</li>}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>
          {employeeId
            ? `Viewing: ${selected?.preferredName || selected?.legalName || "Unavailable employee"}`
            : "Viewing: All employees"}
        </span>
        {employeeId && (
          <button className="min-h-11 underline" onClick={() => select()}>
            Clear employee filter
          </button>
        )}
      </div>
    </section>
  );
  return { employeeId, control, matchesEmployee: (id: string) => !employeeId || id === employeeId };
}
