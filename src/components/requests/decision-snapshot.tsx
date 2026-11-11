import type { RequestDecisionSnapshot } from "@/lib/data/request-decision-snapshot";

export function DecisionSnapshot({
  snapshot,
  unavailable,
}: {
  snapshot?: RequestDecisionSnapshot | undefined;
  unavailable?: boolean | undefined;
}) {
  if (!snapshot)
    return unavailable ? (
      <p className="mt-2 text-xs text-muted-foreground">
        Earlier details were not saved; the current request may differ.
      </p>
    ) : null;
  return (
    <details className="mt-2 rounded-lg border bg-muted/30 p-3 text-sm">
      <summary className="cursor-pointer font-medium text-primary">
        View details at this decision
      </summary>
      <div className="mt-3">
        <p className="font-medium">{snapshot.heading}</p>
        <dl className="mt-2 grid gap-2 sm:grid-cols-2">
          {snapshot.fields.map(({ label, value }) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        </dl>
        {snapshot.days?.length ? (
          <div className="mt-3 border-t pt-3">
            <p className="font-medium">Daily record</p>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              {snapshot.days.map((day) => (
                <li key={day.date} className="break-words text-xs">
                  <span className="font-medium">{day.date}</span> · {day.summary}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {snapshot.sections
          ?.filter((section) => section.count > 0)
          .map((section) => (
            <details key={section.heading} className="mt-3 border-t pt-3">
              <summary className="cursor-pointer font-medium">
                {section.heading} ({section.count})
              </summary>
              {section.rows.length ? (
                <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto pr-2">
                  {section.rows.map((row, index) => (
                    <li
                      key={`${section.heading}-${index}`}
                      className="rounded-md border bg-background p-2"
                    >
                      <p className="font-medium">{row.title}</p>
                      <p className="mt-1 break-words text-xs text-muted-foreground">{row.detail}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  No {section.heading.toLowerCase()} were saved with this decision.
                </p>
              )}
              {section.rows.length < section.count ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Showing {section.rows.length} of {section.count} saved entries.
                </p>
              ) : null}
            </details>
          ))}
        {snapshot.note ? (
          <p className="mt-3 text-xs text-muted-foreground">{snapshot.note}</p>
        ) : null}
      </div>
    </details>
  );
}
