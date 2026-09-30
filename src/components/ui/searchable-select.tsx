import * as React from "react";
import { Check, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { matchesSearch } from "@/lib/search-options";

export type SearchOption = {
  value: string;
  label: string;
  keywords?: string[];
  disabled?: boolean;
};

type Props = Omit<
  React.ComponentPropsWithoutRef<typeof Button>,
  "value" | "defaultValue" | "onChange"
> & {
  options: SearchOption[];
  value?: string;
  defaultValue?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
};

/** Searches only the caller's authorised options. Selection always uses the stable ID, not the name. */
export const SearchableSelect = React.forwardRef<HTMLButtonElement, Props>(
  function SearchableSelect(
    {
      options,
      value,
      defaultValue = "",
      onValueChange,
      placeholder = "Search and select…",
      searchPlaceholder = "Type a name to search…",
      emptyMessage = "No matches found.",
      className,
      disabled,
      ...props
    },
    ref,
  ) {
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState("");
    const [internalValue, setInternalValue] = React.useState(defaultValue);
    const selectedValue = value ?? internalValue;
    const selected = options.find((option) => option.value === selectedValue);
    const results = options.filter((option) =>
      matchesSearch(query, option.label, ...(option.keywords ?? [])),
    );
    const input = React.useRef<HTMLInputElement>(null);
    const changeOpen = (next: boolean) => {
      setQuery("");
      setOpen(next);
    };
    return (
      <Popover open={open && !disabled} onOpenChange={changeOpen}>
        <PopoverTrigger asChild>
          <Button
            {...props}
            ref={ref}
            type="button"
            variant="outline"
            disabled={disabled}
            role="combobox"
            aria-expanded={open && !disabled}
            aria-label={
              props["aria-label"] ??
              (props.id || props["aria-labelledby"] ? undefined : placeholder)
            }
            className={cn(
              "h-auto min-h-10 w-full justify-between gap-2 text-left font-normal",
              className,
            )}
          >
            <span className={cn("min-w-0 truncate", !selected && "text-muted-foreground")}>
              {selected?.label ?? placeholder}
            </span>
            <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            input.current?.focus();
          }}
        >
          <Command shouldFilter={false}>
            <CommandInput
              ref={input}
              aria-label={searchPlaceholder}
              placeholder={searchPlaceholder}
              value={query}
              onValueChange={setQuery}
            />
            <CommandList className="max-h-[min(18rem,40dvh)] overscroll-contain">
              <CommandEmpty>{emptyMessage}</CommandEmpty>
              {results.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value || "__empty_selection__"}
                  disabled={option.disabled ?? false}
                  className="min-h-11 cursor-pointer whitespace-normal break-words py-2"
                  onSelect={() => {
                    setInternalValue(option.value);
                    onValueChange(option.value);
                    changeOpen(false);
                  }}
                >
                  <Check
                    aria-hidden="true"
                    className={cn(
                      "h-4 w-4 shrink-0",
                      selectedValue === option.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span>{option.label}</span>
                  {selectedValue === option.value && <span className="sr-only">Selected</span>}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );
  },
);
