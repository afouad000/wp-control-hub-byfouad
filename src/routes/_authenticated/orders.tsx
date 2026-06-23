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
  const [detailId, setDetailId] = useState<number | null>(null);

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
                <TableHead></TableHead>
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
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => setDetailId(o.id)}>
                      <Eye className="h-3 w-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <PaginationBar
          page={paging.page} totalPages={paging.totalPages} total={paging.total} perPage={paging.perPage}
          onPageChange={setPage} onPerPageChange={setPerPage} disabled={isFetching}
        />
      </CardContent>
      <OrderDetailDialog websiteId={websiteId} orderId={detailId} onClose={() => setDetailId(null)} />
    </Card>
  );
}

type OrderDetail = {
  id: number; number: string; status: string; total: string; currency: string;
  date_created: string; payment_method_title?: string;
  billing: { first_name: string; last_name: string; email: string; phone?: string; address_1?: string; city?: string; country?: string };
  shipping?: { address_1?: string; city?: string; country?: string };
  line_items: Array<{ id: number; name: string; quantity: number; total: string; sku?: string }>;
};
type OrderNote = { id: number; author: string; date_created: string; note: string; customer_note: boolean };

function OrderDetailDialog({ websiteId, orderId, onClose }: { websiteId: string; orderId: number | null; onClose: () => void }) {
  const getFn = useServerFn(fetchOrder);
  const noteFn = useServerFn(addOrderNote);
  const refundFn = useServerFn(refundOrder);
  const qc = useQueryClient();
  const [tab, setTab] = useState<"summary" | "notes" | "refund">("summary");
  const [noteText, setNoteText] = useState("");
  const [customerNote, setCustomerNote] = useState(false);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    enabled: !!orderId,
    queryKey: ["order", websiteId, orderId],
    queryFn: () => getFn({ data: { website_id: websiteId, order_id: orderId! } }),
  });

  if (!orderId) return null;
  const order = data?.ok ? (data.order as OrderDetail) : null;
  const notes = data?.ok ? (data.notes as OrderNote[]) : [];

  const sendNote = async () => {
    if (!noteText) return;
    setBusy(true);
    try {
      await noteFn({ data: { website_id: websiteId, order_id: orderId, note: noteText, customer_note: customerNote } });
      setNoteText(""); setCustomerNote(false);
      toast.success("Note added");
      refetch();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };

  const refund = async () => {
    if (!refundAmount) return;
    if (!confirm(`Refund ${refundAmount}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await refundFn({ data: { website_id: websiteId, order_id: orderId, amount: refundAmount, reason: refundReason || undefined } });
      toast.success("Refund issued");
      setRefundAmount(""); setRefundReason("");
      refetch();
      qc.invalidateQueries({ queryKey: ["orders", websiteId] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Refund failed"); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{order ? `Order #${order.number}` : "Order"}</DialogTitle>
        </DialogHeader>
        {isLoading || !order ? (
          <div className="h-32 animate-pulse rounded bg-muted" />
        ) : (
          <>
            <div className="flex gap-2">
              {(["summary", "notes", "refund"] as const).map((t) => (
                <Button key={t} size="sm" variant={tab === t ? "default" : "outline"} onClick={() => setTab(t)}>
                  {t === "notes" ? <MessageSquare className="mr-1 h-3 w-3" /> : t === "refund" ? <Undo2 className="mr-1 h-3 w-3" /> : null}
                  {t[0].toUpperCase() + t.slice(1)}
                </Button>
              ))}
            </div>

            {tab === "summary" && (
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{order.status}</Badge>
                  <span className="text-muted-foreground">{new Date(order.date_created).toLocaleString()}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Card><CardHeader className="pb-2"><CardTitle className="text-xs">Billing</CardTitle></CardHeader>
                    <CardContent className="space-y-0.5 text-xs">
                      <div className="font-medium">{order.billing.first_name} {order.billing.last_name}</div>
                      <div>{order.billing.email}</div>
                      <div>{order.billing.phone}</div>
                      <div className="text-muted-foreground">{order.billing.address_1}, {order.billing.city}, {order.billing.country}</div>
                    </CardContent>
                  </Card>
                  <Card><CardHeader className="pb-2"><CardTitle className="text-xs">Shipping</CardTitle></CardHeader>
                    <CardContent className="space-y-0.5 text-xs text-muted-foreground">
                      <div>{order.shipping?.address_1}</div>
                      <div>{order.shipping?.city}, {order.shipping?.country}</div>
                    </CardContent>
                  </Card>
                </div>
                <Table>
                  <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Qty</TableHead><TableHead>Total</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {order.line_items.map((li) => (
                      <TableRow key={li.id}>
                        <TableCell>
                          <div className="font-medium">{li.name}</div>
                          {li.sku ? <div className="text-xs text-muted-foreground">{li.sku}</div> : null}
                        </TableCell>
                        <TableCell>{li.quantity}</TableCell>
                        <TableCell>{order.currency} {li.total}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex justify-end text-base font-semibold">Total: {order.currency} {order.total}</div>
                {order.payment_method_title ? <div className="text-xs text-muted-foreground">Paid via {order.payment_method_title}</div> : null}
              </div>
            )}

            {tab === "notes" && (
              <div className="space-y-3">
                <div className="space-y-2 max-h-72 overflow-y-auto rounded border p-2">
                  {notes.length === 0 ? <p className="text-xs text-muted-foreground">No notes yet.</p> :
                    notes.map((n) => (
                      <div key={n.id} className="rounded bg-muted/40 p-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{n.author} {n.customer_note ? <Badge variant="secondary" className="ml-1 text-[10px]">to customer</Badge> : null}</span>
                          <span className="text-muted-foreground">{new Date(n.date_created).toLocaleString()}</span>
                        </div>
                        <div className="mt-1 whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: n.note }} />
                      </div>
                    ))}
                </div>
                <Textarea placeholder="Add internal note…" value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={3} />
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={customerNote} onChange={(e) => setCustomerNote(e.target.checked)} />
                  Email this note to the customer
                </label>
                <div className="flex justify-end">
                  <Button onClick={sendNote} disabled={busy || !noteText}>
                    {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Add note
                  </Button>
                </div>
              </div>
            )}

            {tab === "refund" && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Issue a refund through the store's payment gateway when supported, otherwise the order is marked refunded.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label>Amount ({order.currency})</Label><Input value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} placeholder={order.total} /></div>
                  <div className="space-y-1.5"><Label>Reason</Label><Input value={refundReason} onChange={(e) => setRefundReason(e.target.value)} /></div>
                </div>
                <div className="flex justify-end">
                  <Button variant="destructive" onClick={refund} disabled={busy || !refundAmount}>
                    {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Undo2 className="mr-2 h-4 w-4" />}
                    Refund {refundAmount ? `${order.currency} ${refundAmount}` : ""}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
