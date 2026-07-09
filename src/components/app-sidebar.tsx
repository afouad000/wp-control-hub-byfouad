import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Globe, Plus, Users, Activity, Settings,
  ShoppingBag, ShoppingCart, Package, UserRound, Tag,
  type LucideIcon,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
} from "@/components/ui/sidebar";
import { usePermissions } from "@/hooks/use-permissions";
import type { Permission } from "@/lib/server-guards";

type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  /** Permission needed to see this item. Omit for items always visible. */
  permission?: Permission;
  /** Show only when the user owns/manages at least one website. */
  requiresAnySite?: boolean;
};

const overview: NavItem[] = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Stores overview", url: "/stores", icon: ShoppingBag, requiresAnySite: true },
];
const manage: NavItem[] = [
  { title: "Websites", url: "/websites", icon: Globe },
  { title: "Add website", url: "/websites/new", icon: Plus },
  { title: "Orders", url: "/orders", icon: ShoppingCart, permission: "view_orders" },
  { title: "Products", url: "/products", icon: Package, permission: "view_products" },
  { title: "Coupons", url: "/coupons", icon: Tag, permission: "view_coupons" },
  { title: "Customers", url: "/customers", icon: UserRound, permission: "view_customers" },
];
const account: NavItem[] = [
  { title: "Users & roles", url: "/users", icon: Users, permission: "manage_team" },
  { title: "Activity logs", url: "/activity", icon: Activity, permission: "view_activity_logs" },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (url: string) => (url === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(url));
  const { can, summary, isLoading } = usePermissions();

  const visible = (item: NavItem) => {
    if (isLoading) return !item.permission && !item.requiresAnySite;
    if (summary.isSuperAdmin) return true;
    if (item.requiresAnySite && summary.websiteCount === 0) return false;
    if (item.permission && !can(item.permission)) return false;
    return true;
  };

  const renderGroup = (label: string, items: NavItem[]) => {
    const shown = items.filter(visible);
    if (shown.length === 0) return null;
    return (
      <SidebarGroup>
        <SidebarGroupLabel>{label}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {shown.map((item) => (
              <SidebarMenuItem key={item.url}>
                <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                  <Link to={item.url}>
                    <item.icon className="h-4 w-4" />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b">
        <div className="flex items-center gap-2 px-2 py-3">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground font-mono text-xs font-bold">
            WP
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <div className="truncate text-sm font-semibold">WP Control Hub</div>
            <div className="truncate text-[11px] text-muted-foreground">Manage your sites</div>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {renderGroup("Overview", overview)}
        {renderGroup("Manage", manage)}
        {renderGroup("Account", account)}
      </SidebarContent>

      <SidebarFooter className="border-t">
        <div className="px-2 py-2 text-[11px] text-muted-foreground group-data-[collapsible=icon]:hidden">
          Powered by{" "}
          <a
            href="https://madebyfouad.com/"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            madebyfouad.com
          </a>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
