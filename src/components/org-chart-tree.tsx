import { useState } from "react";
import { ChevronDown, ChevronUp, Crown, MapPin, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export interface OrgChartPerson {
  id: string;
  preferredName: string;
  legalName: string;
  position: string;
  department: string;
  location: string;
}
export function OrgChartTree({
  person,
  childrenByManager,
  headId,
  expandAll = true,
  matches,
  onOpen,
  depth = 0,
}: {
  person: OrgChartPerson;
  childrenByManager: Map<string, OrgChartPerson[]>;
  headId: string | null;
  expandAll?: boolean;
  matches: Set<string>;
  onOpen?: (id: string) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(expandAll);
  const children = childrenByManager.get(person.id) ?? [];
  const name = person.preferredName || person.legalName;
  const isHead = person.id === headId;
  return (
    <div className="flex flex-col items-center" role="group" aria-label={name}>
      <article
        data-company-head={isHead}
        className={cn(
          "relative w-56 shrink-0 rounded-xl border bg-card p-4 text-center shadow-sm",
          isHead ? "border-primary border-t-4" : "border-t-4 border-t-primary/30",
          matches.has(person.id) && "ring-2 ring-amber-400",
        )}
      >
        {isHead && (
          <div className="mb-3 flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-primary">
            <Crown className="h-3 w-3" />
            Company head
          </div>
        )}
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          {name
            .split(" ")
            .map((part) => part[0])
            .slice(0, 2)
            .join("")}
        </div>
        {onOpen ? (
          <button
            type="button"
            className="font-semibold leading-snug hover:text-primary hover:underline"
            onClick={() => onOpen(person.id)}
          >
            {name}
          </button>
        ) : (
          <p className="font-semibold leading-snug">{name}</p>
        )}
        <p className="mt-1 text-sm text-primary">{person.position || "Position not set"}</p>
        <p className="mt-1 text-xs text-muted-foreground">{person.department}</p>
        {person.location && (
          <p className="mt-2 flex items-center justify-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3" />
            {person.location}
          </p>
        )}
        {children.length > 0 && depth < 100 && (
          <button
            type="button"
            className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-muted/50 text-xs hover:bg-muted"
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${name}'s team`}
            onClick={() => setExpanded(!expanded)}
          >
            <Users className="h-3.5 w-3.5" />
            {children.length} {children.length === 1 ? "report" : "reports"}
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </article>
      {expanded && children.length > 0 && depth < 100 && (
        <>
          <div aria-hidden="true" className="h-6 border-l-2 border-primary/25" />
          <div className="flex items-start">
            {children.map((child, index) => (
              <div key={child.id} className="relative flex flex-col items-center px-3">
                {children.length > 1 && (
                  <div
                    aria-hidden="true"
                    className={cn(
                      "absolute top-0 border-t-2 border-primary/25",
                      index === 0
                        ? "left-1/2 right-0"
                        : index === children.length - 1
                          ? "left-0 right-1/2"
                          : "inset-x-0",
                    )}
                  />
                )}
                <div aria-hidden="true" className="h-6 border-l-2 border-primary/25" />
                <OrgChartTree
                  person={child}
                  childrenByManager={childrenByManager}
                  headId={headId}
                  expandAll={expandAll}
                  matches={matches}
                  {...(onOpen ? { onOpen } : {})}
                  depth={depth + 1}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
