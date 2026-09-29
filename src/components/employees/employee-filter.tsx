import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { EmployeeService } from "@/lib/data/employee-service";
import { useCurrentUser } from "@/lib/auth";
import { getMasterDataRepository } from "@/lib/data/master-data";

export function employeeSearch(search: Record<string, unknown>): {
  employeeId?: string | undefined;
  days?: 7 | 30 | undefined;
  from?: string | undefined;
  until?: string | undefined;
  location?: string | undefined;
  department?: string | undefined;
} {
  const date = (value: unknown) =>
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
  return {
    employeeId: typeof search["employeeId"] === "string" ? search["employeeId"] : undefined,
    days: Number(search["days"]) === 7 ? 7 : Number(search["days"]) === 30 ? 30 : undefined,
    from: date(search["from"]),
    until: date(search["until"]),
    location: typeof search["location"] === "string" ? search["location"] : undefined,
    department: typeof search["department"] === "string" ? search["department"] : undefined,
  };
}

/** Filters already permission-scoped records; never grants access to additional records. */
export function useEmployeeFilter(defaultLocation?: string) {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useCurrentUser();
  const service = useMemo(() => new EmployeeService(), []);
  const [term, setTerm] = useState("");
  const {
    employeeId,
    location: chosenLocation,
    department = "all",
  } = employeeSearch(location.search);
  const office = chosenLocation ?? (employeeId ? "all" : defaultLocation) ?? "all";
  const employees = service.getDirectoryEmployees(user.getActorContext());
  const selected = employees.find((person) => person.id === employeeId);
  const dimensionMatches = (person: (typeof employees)[number]) =>
    (office === "all" || person.location === office) &&
    (department === "all" || person.department === department);
  const matches = employees.filter(
    (person) =>
      dimensionMatches(person) &&
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
      <div className="grid gap-3 sm:grid-cols-2">
        {(["locations", "departments"] as const).map((collection) => (
          <label key={collection} className="text-sm font-medium">
            {collection === "locations" ? "Location" : "Department"}
            <select
              aria-label={collection === "locations" ? "Filter location" : "Filter department"}
              className="mt-1 h-11 w-full rounded-md border bg-background px-3"
              value={collection === "locations" ? office : department}
              onChange={(event) => {
                setTerm("");
                void navigate({
                  to: ".",
                  search: (previous) => ({
                    ...previous,
                    employeeId: undefined,
                    [collection === "locations" ? "location" : "department"]: event.target.value,
                  }),
                  replace: true,
                });
              }}
            >
              <option value="all">
                {collection === "locations" ? "All locations" : "All departments"}
              </option>
              {[
                ...new Set([
                  ...getMasterDataRepository(collection)
                    .list()
                    .filter((item) => item.isActive)
                    .map((item) => item.name),
                  ...employees.map((person) =>
                    collection === "locations" ? person.location : person.department,
                  ),
                ]),
              ]
                .filter(Boolean)
                .sort()
                .map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
            </select>
          </label>
        ))}
      </div>
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
  return {
    employeeId,
    control,
    matchesEmployee: (id: string) => {
      if (employeeId && id !== employeeId) return false;
      if (office === "all" && department === "all") return true;
      const person = employees.find((item) => item.id === id || item.databaseId === id);
      return !!person && dimensionMatches(person);
    },
  };
}
