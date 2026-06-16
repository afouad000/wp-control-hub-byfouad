import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Globe, ShoppingCart, Package, Users as UsersIcon, Activity as ActivityIcon, Plus, AlertCircle, CheckCircle2 } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { listWebsites } from "@/lib/websites.functions";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Dashboard — WP Control Hub" }] }),
  component: Dashboard,
});

function Dashboard() {
  const fn = useServerFn(listWebsites);
  const { data: sites = [], isLoading } = useQuery({
    queryKey: ["websites"],
    queryFn: () => fn(),
  });

  const wooSites = sites.filter((s) => (s.meta as { woocommerce?: boolean })?.woocommerce);
  const totals = wooSites.reduce(
    (acc, s) => {
      const m = (s.meta ?? {}) as { orders?: number; products?: number; customers?: number; revenue?: number };
      acc.orders += m.orders ?? 0;
      acc.products += m.products ?? 0;
      acc.customers += m.customers ?? 0;
      acc.revenue += m.revenue ?? 0;
      return acc;
    },
    { orders: 0, products: 0, customers: 0, revenue: 0 },
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description="An overview of every site you manage."
        actions={
          <Button asChild size="sm">
            <Link to="/websites/new">
              <Plus className="mr-2 h-4 w-4" /> Add website
            </Link>
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Sites connected" value={sites.length} icon={<Globe className="h-4 w-4" />} hint={`${wooSites.length} with WooCommerce`} />
        <StatCard label="Total revenue" value={`$${totals.revenue.toFixed(2)}`} icon={<ShoppingCart className="h-4 w-4" />} hint="Across all stores" />
        <StatCard label="Orders" value={totals.orders} icon={<Package className="h-4 w-4" />} />
        <StatCard label="Customers" value={totals.customers} icon={<UsersIcon className="h-4 w-4" />} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connected sites</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : sites.length === 0 ? (
            <EmptyState
              icon={<Globe className="h-6 w-6" />}
              title="No websites yet"
              description="Connect your first WordPress site to start managing it."
              action={
                <Button asChild size="sm">
                  <Link to="/websites/new">
                    <Plus className="mr-2 h-4 w-4" /> Add website
                  </Link>
                </Button>
              }
            />
          ) : (
            <div className="divide-y">
              {sites.map((s) => {
                const m = (s.meta ?? {}) as { woocommerce?: boolean; theme?: string };
                return (
                  <Link
                    key={s.id}
                    to="/websites/$id"
                    params={{ id: s.id }}
                    className="flex items-center justify-between gap-3 py-3 hover:bg-muted/30"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border bg-muted/40">
                        <Globe className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{s.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{s.url}</div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {m.woocommerce ? <Badge variant="secondary">WooCommerce</Badge> : null}
                      {s.status === "connected" ? (
                        <Badge variant="outline" className="border-success/40 text-success">
                          <CheckCircle2 className="mr-1 h-3 w-3" /> Connected
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-destructive/40 text-destructive">
                          <AlertCircle className="mr-1 h-3 w-3" /> {s.status}
                        </Badge>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Recent activity</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link to="/activity"><ActivityIcon className="mr-2 h-4 w-4" /> View all</Link>
          </Button>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Audit events from your sites appear here.
        </CardContent>
      </Card>
    </div>
  );
}
