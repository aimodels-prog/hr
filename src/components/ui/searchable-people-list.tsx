import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { matchesSearch } from "@/lib/search-options";
import type { SearchOption } from "@/components/ui/searchable-select";

export function SearchablePeopleList({
  options,
  selected,
  onToggle,
  label = "Search interviewers",
}: {
  options: SearchOption[];
  selected: string[];
  onToggle: (id: string, checked: boolean) => void;
  label?: string;
}) {
  const [query, setQuery] = useState("");
  const visible = options.filter((option) =>
    matchesSearch(query, option.label, ...(option.keywords ?? [])),
  );
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"
        />
        <Input
          type="search"
          className="pl-9"
          aria-label={label}
          placeholder={label}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <p role="status" className="text-xs text-muted-foreground">
        {selected.length} selected · {visible.length} found
      </p>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1" aria-label="Selected interviewers">
          {options
            .filter((option) => selected.includes(option.value))
            .map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={option.disabled}
                onClick={() => onToggle(option.value, false)}
                aria-label={`Remove ${option.label}`}
                className="min-h-9 rounded-md border bg-muted px-2 py-1 text-left text-xs"
              >
                {option.label} <span aria-hidden="true">×</span>
              </button>
            ))}
        </div>
      )}
      <div className="max-h-48 divide-y overflow-y-auto overscroll-contain rounded-md border">
        {!visible.length && (
          <p className="p-3 text-sm text-muted-foreground">No matching people found.</p>
        )}
        {visible.map((option) => (
          <label
            key={option.value}
            className="flex min-h-11 cursor-pointer items-center gap-3 p-3 text-sm hover:bg-muted/50"
          >
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0 accent-primary"
              checked={selected.includes(option.value)}
              disabled={option.disabled}
              onChange={(event) => onToggle(option.value, event.target.checked)}
            />
            <span className="min-w-0 break-words">{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
