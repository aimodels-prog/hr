import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronDown, ExternalLink, Search, X } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
import { useSidebarSections } from "@/components/layout/sidebar-sections-context";
import { useCurrentUser } from "@/lib/auth";
import {
  activeNavigationUrl,
  searchNavigation,
  staffNavigation,
} from "@/lib/navigation/staff-navigation";

export function HrSidebar() {
  const { state, isMobile, openMobile, setOpen, setOpenMobile } = useSidebar();
  const href = useRouterState({ select: (r) => r.location.href });
  const { displayName, activeRole, can: checkCan, currentEmployee } = useCurrentUser();
  const sections = useSidebarSections();
  const id = useId();
  const activeLink = useRef<HTMLAnchorElement>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => staffNavigation(activeRole, checkCan), [activeRole, checkCan]);
  const activeUrl = activeNavigationUrl(groups, href);
  const activeGroup = groups.find((group) =>
    group.items.some((item) => item.url === activeUrl),
  )?.label;
  const visibleGroups = searchNavigation(groups, query);
  useEffect(() => {
    if (activeGroup) setExpanded((previous) => ({ ...previous, [activeGroup]: true }));
  }, [activeGroup, activeUrl]);
  useEffect(() => {
    if (query) return;
    const frame = requestAnimationFrame(() =>
      activeLink.current?.scrollIntoView({ block: "nearest" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [activeUrl, query, openMobile, state]);
  const closeMenu = () => {
    setQuery("");
    setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border/70 px-3 py-3 group-data-[collapsible=icon]:px-2">
        <Link
          to="/staff"
          aria-label="VIA HR System dashboard"
          onClick={closeMenu}
          className="flex h-10 items-center overflow-hidden"
        >
          <BrandLogo className="h-10 min-w-[108px] dark:brightness-0 dark:invert group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:min-w-[86px]" />
        </Link>
        {state === "collapsed" && !isMobile ? (
          <button
            type="button"
            aria-label="Search menu"
            className="flex h-10 items-center justify-center rounded-lg hover:bg-sidebar-accent"
            onClick={() => {
              setOpen(true);
              requestAnimationFrame(() => document.getElementById(id + "-search")?.focus());
            }}
          >
            <Search className="h-4 w-4" />
          </button>
        ) : (
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              id={id + "-search"}
              aria-label="Search menu"
              placeholder="Search menu"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setQuery("");
                  event.stopPropagation();
                }
              }}
              className="h-10 rounded-lg pl-9 pr-8"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear menu search"
                onClick={() => setQuery("")}
                className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </SidebarHeader>
      <SidebarContent className="px-1 py-2">
        <nav aria-label="Main navigation">
          {visibleGroups.map((group, index) => {
            const standalone = group.label === "Home" || group.label === "Reports";
            const open =
              standalone ||
              Boolean(query.trim()) ||
              (state === "collapsed" && !isMobile) ||
              expanded[group.label] === true;
            const sectionId = id + "-group-" + index;
            return (
              <SidebarGroup key={group.label} className="py-1">
                {!standalone && (
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={sectionId}
                    onClick={() =>
                      setExpanded((previous) => ({ ...previous, [group.label]: !open }))
                    }
                    className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-2.5 text-left text-xs font-semibold text-sidebar-foreground/75 hover:bg-sidebar-accent focus-visible:outline-primary group-data-[collapsible=icon]:hidden"
                  >
                    <span>{group.label}</span>
                    <ChevronDown
                      className={open ? "h-3.5 w-3.5 shrink-0" : "h-3.5 w-3.5 shrink-0 -rotate-90"}
                    />
                  </button>
                )}
                <SidebarGroupContent id={sectionId} hidden={!open}>
                  <SidebarMenu>
                    {group.items.map((item) => (
                      <SidebarMenuItem key={item.url}>
                        <SidebarMenuButton
                          asChild
                          isActive={activeUrl === item.url}
                          tooltip={item.title}
                          className="h-11 rounded-lg px-2.5 text-[13px] text-sidebar-foreground/80 data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold data-[active=true]:text-sidebar-accent-foreground"
                        >
                          <Link
                            ref={activeUrl === item.url ? activeLink : undefined}
                            to={item.url}
                            onClick={closeMenu}
                            aria-current={activeUrl === item.url ? "page" : undefined}
                          >
                            <item.icon />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                        {activeUrl === item.url && (
                          <div
                            ref={sections?.setTarget}
                            data-sidebar-page-sections
                            className="ml-4 border-l border-sidebar-border pl-1 group-data-[collapsible=icon]:hidden [&:empty]:hidden"
                          />
                        )}
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            );
          })}
          {visibleGroups.length === 0 && (
            <p role="status" className="px-4 py-6 text-sm text-muted-foreground">
              No matching pages.
            </p>
          )}
        </nav>
        {!query && (
          <SidebarGroup>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip="Career portal"
                  className="h-11 rounded-lg px-2.5 text-[13px] text-sidebar-foreground/70"
                >
                  <a href="https://careers.via-int.com">
                    <ExternalLink />
                    <span>Career portal</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border/70 px-4 py-3 text-xs group-data-[collapsible=icon]:hidden">
        <p className="truncate font-semibold text-sidebar-foreground">{displayName}</p>
        <p className="truncate text-[11px]">
          {activeRole} · {currentEmployee?.position || "Staff"}
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
