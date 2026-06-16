import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShoppingCart, Package, Users as UsersIcon, DollarSign } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { listWebsites } from "@/lib/websites.functions";

export const Route = createFileRoute("/_authenticated/stores")({
  head: () => ({ meta: [{ title: "Stores — WP Control Hub" }] }),
  component: Stores,
});

function Stores() {
  const fn = useServerFn(listWebsites);
  const { data: sites = [] } = useQuery({ queryKey: ["websites"], queryFn: () => fn() });

  const stores = sites.filter((s) => (s.meta as { woocommerce?: boolean })?.woocommerce);
  const totals = stores.reduce(
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
    <div className="space-y-6">
      <PageHeader title="Multi-store overview" description="Combined metrics across every WooCommerce store you manage." />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total revenue" value={`$${totals.revenue.toFixed(2)}`} icon={<DollarSign className="h-4 w-4" />} />
        <StatCard label="Total orders" value={totals.orders} icon={<ShoppingCart className="h-4 w-4" />} />
        <StatCard label="Total products" value={totals.products} icon={<Package className="h-4 w-4" />} />
        <StatCard label="Total customers" value={totals.customers} icon={<UsersIcon className="h-4 w-4" />} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">By store</CardTitle></CardHeader>
        <CardContent>
          {stores.length === 0 ? (
            <EmptyState title="No WooCommerce stores yet" description="Connect a site with WooCommerce active." />
          ) : (
            <div className="divide-y">
              {stores.map((s) => {
                const m = (s.meta ?? {}) as { orders?: number; revenue?: number; products?: number };
                return (
                  <div key={s.id} className="grid grid-cols-2 gap-2 py-3 sm:grid-cols-5">
                    <div className="col-span-2 min-w-0">
                      <div className="truncate text-sm font-medium">{s.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{s.url}</div>
                    </div>
                    <Metric label="Revenue" value={`$${(m.revenue ?? 0).toFixed(2)}`} />
                    <Metric label="Orders" value={String(m.orders ?? 0)} />
                    <Metric label="Products" value={String(m.products ?? 0)} />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Numbers reflect the last probe of each store.{" "}
        <Badge variant="outline">Refresh sites individually to update</Badge>
      </p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}
