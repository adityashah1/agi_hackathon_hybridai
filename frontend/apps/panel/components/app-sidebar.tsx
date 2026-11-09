"use client";

import { ModeToggle } from "@repo/design-system/components/mode-toggle";
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
} from "@repo/design-system/components/ui/sidebar";
import {
  BookOpenIcon,
  FlaskConicalIcon,
  LayoutDashboardIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FLOW } from "@/lib/flow";

export const AppSidebar = () => {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <Sidebar variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <Link href="/">
                <div className="flex size-8 items-center justify-center rounded-md bg-primary font-mono text-primary-foreground text-xs">
                  hg
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold">hybrid-gate</span>
                  <span className="truncate text-muted-foreground text-xs">
                    local proposes · gate decides · Sai escalates
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isActive("/")}
                  tooltip="Overview"
                >
                  <Link href="/">
                    <LayoutDashboardIcon />
                    <span>Overview</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Flow</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {FLOW.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.href)}
                    tooltip={item.title}
                  >
                    <Link href={item.href}>
                      <item.icon />
                      <span className="flex-1">{item.title}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {item.step}
                      </span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Reference</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isActive("/methodology")}
                  tooltip="Methodology"
                >
                  <Link href="/methodology">
                    <BookOpenIcon />
                    <span>Methodology</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isActive("/benchmarks")}
                  tooltip="Benchmarks"
                >
                  <Link href="/benchmarks">
                    <FlaskConicalIcon />
                    <span>Benchmarks</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="pb-12">
        <div className="flex flex-col gap-2 px-2 py-1">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="inline-flex h-4 items-center rounded-full border border-measured bg-measured/10 px-1.5 font-medium text-measured uppercase tracking-wide">
              measured
            </span>
            <span className="inline-flex h-4 items-center rounded-full border border-modeled border-dashed px-1.5 font-medium text-modeled uppercase tracking-wide">
              modeled
            </span>
            <span>on every number</span>
          </div>
          <div className="flex items-center justify-end gap-2">
            <ModeToggle />
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
};
