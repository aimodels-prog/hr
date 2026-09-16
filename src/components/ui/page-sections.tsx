import * as React from "react";
import { ChevronDown, ChevronRight, List } from "lucide-react";
import { cn } from "@/lib/utils";

type SectionContext = {
  value: string;
  select: (value: string) => void;
  id: string;
  closeMenu: () => void;
};
const Context = React.createContext<SectionContext | null>(null);
function useSections() {
  const value = React.useContext(Context);
  if (!value) throw new Error("Page sections must be inside PageSections.");
  return value;
}

/** In-page navigation, deliberately separate from the application's main sidebar. */
export function PageSections({
  value,
  defaultValue = "",
  onValueChange,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "defaultValue"> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}) {
  const [selected, setSelected] = React.useState(defaultValue);
  const id = React.useId();
  const root = React.useRef<HTMLDivElement>(null);
  const select = React.useCallback(
    (next: string) => {
      setSelected(next);
      onValueChange?.(next);
    },
    [onValueChange],
  );
  const context = React.useMemo(
    () => ({
      value: value ?? selected,
      select,
      id,
      closeMenu: () => {
        const menu = root.current?.querySelector<HTMLDetailsElement>("details[data-section-menu]");
        if (menu) menu.open = false;
      },
    }),
    [value, selected, select, id],
  );
  return (
    <Context.Provider value={context}>
      <div
        ref={root}
        {...props}
        className={cn(
          className,
          "grid min-w-0 items-start gap-5 space-y-0 lg:grid-cols-[220px_minmax(0,1fr)] [&>[data-section-content]]:lg:col-start-2 [&>[data-section-content]]:lg:row-start-1",
        )}
      >
        {children}
      </div>
    </Context.Provider>
  );
}

function sectionItems(
  children: React.ReactNode,
): Array<{ value: string; label: React.ReactNode; disabled?: boolean | undefined }> {
  return React.Children.toArray(children).flatMap((child) => {
    if (
      !React.isValidElement<{ value?: string; children?: React.ReactNode; disabled?: boolean }>(
        child,
      )
    )
      return [];
    if (child.type === React.Fragment) return sectionItems(child.props.children);
    return child.props.value
      ? [{ value: child.props.value, label: child.props.children, disabled: child.props.disabled }]
      : [];
  });
}

export function SectionNavigation({ children, className, ...props }: React.ComponentProps<"div">) {
  const { value, select } = useSections();
  const items = sectionItems(children);
  const current = items.find((item) => item.value === value);
  const initial = React.useRef(value);
  // Respect existing controlled page state. Only apply a bookmarked section when it exists
  // in this user's permitted navigation; hidden sections never become selectable.
  const selectRef = React.useRef(select);
  selectRef.current = select;
  const available = items
    .filter((item) => !item.disabled)
    .map((item) => item.value)
    .join("|");
  React.useEffect(() => {
    const restore = () => {
      const requested = new URLSearchParams(window.location.hash.slice(1)).get("section");
      if (requested && available.split("|").includes(requested)) selectRef.current(requested);
      else if (!requested && available.split("|").includes(initial.current))
        selectRef.current(initial.current);
    };
    restore();
    window.addEventListener("hashchange", restore);
    return () => window.removeEventListener("hashchange", restore);
  }, [available]);
  React.useEffect(() => {
    if (!current && items[0]) select(items[0].value);
  }, [current, items, select]);
  return (
    <aside className="min-w-0 lg:sticky lg:top-20">
      <details data-section-menu className="group rounded-xl border bg-card lg:hidden">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <List className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 text-sm">
            <span className="block text-xs text-muted-foreground">Sections</span>
            <span className="font-semibold">{current?.label}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <nav aria-label="Page sections" className="space-y-1 border-t p-2">
          {children}
        </nav>
      </details>
      <div
        {...props}
        className={cn(
          className,
          "hidden h-auto w-full rounded-xl border bg-card p-2 shadow-sm lg:block",
        )}
      >
        <p className="px-3 pb-3 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          In this page
        </p>
        <nav
          aria-label="Page sections"
          className="flex max-h-[calc(100vh-12rem)] flex-col gap-1 overflow-y-auto"
        >
          {children}
        </nav>
      </div>
    </aside>
  );
}

export function SectionLink({
  value,
  children,
  className,
  disabled,
  ...props
}: Omit<React.ComponentProps<"a">, "href"> & { value: string; disabled?: boolean }) {
  const context = useSections();
  const active = context.value === value;
  return (
    <a
      {...props}
      href={disabled ? undefined : `#section=${encodeURIComponent(value)}`}
      aria-current={active ? "page" : undefined}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onClick={(event) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        context.select(value);
        context.closeMenu();
        // Preserve focus when collapsing the mobile menu.
        if (window.matchMedia("(max-width: 1023px)").matches)
          event.currentTarget.closest("details")?.querySelector("summary")?.focus();
        props.onClick?.(event);
      }}
      className={cn(
        className,
        "flex min-h-11 w-full items-center justify-start gap-2 whitespace-normal rounded-lg border-l-2 px-3 py-2.5 text-left text-sm leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-primary bg-primary/10 font-semibold text-primary"
          : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {active && <ChevronRight className="h-4 w-4 shrink-0" />}
    </a>
  );
}

export function SectionPanel({
  value,
  children,
  className,
  ...props
}: React.ComponentProps<"div"> & { value: string }) {
  const context = useSections();
  if (context.value !== value) return null;
  return (
    <section
      {...props}
      data-section-content
      aria-label={`${value.replaceAll("-", " ")} section`}
      className={cn(className, "mt-0 min-w-0")}
    >
      {children}
    </section>
  );
}
