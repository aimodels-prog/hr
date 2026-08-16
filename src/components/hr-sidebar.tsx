import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  FilePlus2,
  Users,
  CalendarClock,
  ClipboardCheck,
  Briefcase,
} from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const hiring = [
  { title: "Dashboard", url: "/staff", icon: LayoutDashboard },
  { title: "New vacancy", url: "/staff/vacancy", icon: FilePlus2 },
  { title: "Candidates", url: "/staff/candidates", icon: Users },
  { title: "Interviews", url: "/staff/interviews", icon: CalendarClock },
  { title: "Onboarding", url: "/staff/onboarding", icon: ClipboardCheck },
];

export function HrSidebar() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-4">
        <BrandLogo invert className="h-8" />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Hiring pipeline</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {hiring.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={pathname === item.url} tooltip={item.title}>
                    <Link to={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Public</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Career portal">
                  <Link to="/">
                    <Briefcase />
                    <span>Career portal</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="px-3 py-4 text-xs text-sidebar-foreground/60 group-data-[collapsible=icon]:hidden">
        Signed in as Rana Nair · HR Manager
      </SidebarFooter>
    </Sidebar>
  );
}
