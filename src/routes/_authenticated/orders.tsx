import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { Loader2, RefreshCw, Eye, MessageSquare, Undo2 } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PaginationBar } from "@/components/pagination-bar";
import {
  listWebsites, fetchOrders, updateOrderStatus, fetchOrder, addOrderNote, refundOrder,
} from "@/lib/websites.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/orders")({
  head: () => ({ meta: [{ title: "Orders — WP Control Hub" }] }),
  component: OrdersPage,
});

const STATUSES = ["pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed"] as const;

function OrdersPage() {
  const listFn = useServerFn(listWebsites);
  const { data: sites = [] } = useQuery({ queryKey: ["websites"], queryFn: () => listFn() });
  const stores = sites.filter((s) => (s.meta as { woocommerce?: boolean })?.woocommerce);
  const [siteId, setSiteId] = useState<string>("");
  const active = siteId || stores[0]?.id || "";

  return (
    <div className="space-y-6">
      <PageHeader title="Orders" description="Manage WooCommerce orders across your sites." />

      {stores.length === 0 ? (
        <EmptyState title="No WooCommerce stores connected" description="Connect a site with WooCommerce active to manage orders." />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {stores.map((s) => (
              <Button key={s.id} size="sm" variant={active === s.id ? "default" : "outline"} onClick={() => setSiteId(s.id)}>
                {s.name}
              </Button>
            ))}
          </div>
          {active ? <OrdersTable websiteId={active} /> : null}
        </>
      )}
    </div>
  );
}

function OrdersTable({ websiteId }: { websiteId: string }) {
  const fn = useServerFn(fetchOrders);
  const update = useServerFn(updateOrderStatus);
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(q); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => { setPage(1); }, [status, perPage, websiteId]);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["orders", websiteId, page, perPage, search, status],
    queryFn: () => fn({ data: {
      website_id: websiteId, page, per_page: perPage,
      search: search || undefined,
      status: status === "all" ? undefined : status,
    } }),
  });

  const orders = data?.ok ? data.orders : [];
  const paging = data?.paging ?? { total: 0, totalPages: 0, page, perPage };

  const changeStatus = async (orderId: number, newStatus: string) => {
    setUpdatingId(orderId);
    try {
      await update({ data: { website_id: websiteId, order_id: orderId, status: newStatus as typeof STATUSES[number] } });
      toast.success(`Order #${orderId} → ${newStatus}`);
      qc.invalidateQueries({ queryKey: ["orders", websiteId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Orders</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 w-44" />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-1 h-3 w-3 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-24 animate-pulse rounded bg-muted" />
        ) : !data?.ok ? (
          <p className="text-sm text-destructive">{data?.error ?? "Failed to load"}</p>
        ) : orders.length === 0 ? (
          <EmptyState title="No matching orders" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-mono text-xs">#{o.number}</TableCell>
                  <TableCell>
                    <div className="font-medium">{o.billing.first_name} {o.billing.last_name}</div>
                    <div className="text-xs text-muted-foreground">{o.billing.email}</div>
                  </TableCell>
                  <TableCell className="font-medium">{o.currency} {o.total}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(o.date_created).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{o.status}</Badge>
                      <Select value={o.status} onValueChange={(v) => changeStatus(o.id, v)} disabled={updatingId === o.id}>
                        <SelectTrigger className="h-7 w-32 text-xs">
                          {updatingId === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <SelectValue />}
                        </SelectTrigger>
                        <SelectContent>
                          {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <PaginationBar
          page={paging.page}
          totalPages={paging.totalPages}
          total={paging.total}
          perPage={paging.perPage}
          onPageChange={setPage}
          onPerPageChange={setPerPage}
          disabled={isFetching}
        />
      </CardContent>
    </Card>
  );
}
