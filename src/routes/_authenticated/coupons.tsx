import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Loader2, Plus, Pencil, Trash2, RefreshCw, Tag } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PaginationBar } from "@/components/pagination-bar";
import { listWebsites, fetchCoupons, saveCoupon, deleteCoupon } from "@/lib/websites.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/coupons")({
  head: () => ({ meta: [{ title: "Coupons — WP Control Hub" }] }),
  component: CouponsPage,
});

type Coupon = {
  id: number; code: string; amount: string; discount_type: string;
  date_expires: string | null; usage_count: number; usage_limit: number | null;
  description: string; free_shipping: boolean;
};

function CouponsPage() {
  const listFn = useServerFn(listWebsites);
  const { data: sites = [] } = useQuery({ queryKey: ["websites"], queryFn: () => listFn() });
  const stores = sites.filter((s) => (s.meta as { woocommerce?: boolean })?.woocommerce);
  const [siteId, setSiteId] = useState("");
  const active = siteId || stores[0]?.id || "";

  return (
    <div className="space-y-6">
      <PageHeader title="Coupons" description="Create and manage WooCommerce discount codes." />
      {stores.length === 0 ? (
        <EmptyState icon={<Tag className="h-6 w-6" />} title="No WooCommerce stores connected" />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {stores.map((s) => (
              <Button key={s.id} size="sm" variant={active === s.id ? "default" : "outline"} onClick={() => setSiteId(s.id)}>
                {s.name}
              </Button>
            ))}
          </div>
          {active ? <CouponsTable websiteId={active} /> : null}
        </>
      )}
    </div>
  );
}

function CouponsTable({ websiteId }: { websiteId: string }) {
  const fn = useServerFn(fetchCoupons);
  const del = useServerFn(deleteCoupon);
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [editing, setEditing] = useState<Coupon | "new" | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(q); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => { setPage(1); }, [perPage, websiteId]);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["coupons", websiteId, page, perPage, search],
    queryFn: () => fn({ data: { website_id: websiteId, page, per_page: perPage, search: search || undefined } }),
  });
  const coupons = data?.ok ? data.coupons : [];
  const paging = data?.paging ?? { total: 0, totalPages: 0, page, perPage };

  const remove = async (c: Coupon) => {
    if (!confirm(`Delete coupon "${c.code}"?`)) return;
    try {
      await del({ data: { website_id: websiteId, id: c.id } });
      toast.success("Coupon deleted");
      qc.invalidateQueries({ queryKey: ["coupons", websiteId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Coupons</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Input placeholder="Search code…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 w-44" />
            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`mr-1 h-3 w-3 ${isFetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus className="mr-1 h-3 w-3" /> New coupon
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-24 animate-pulse rounded bg-muted" />
          ) : !data?.ok ? (
            <p className="text-sm text-destructive">{data?.error ?? "Failed to load"}</p>
          ) : coupons.length === 0 ? (
            <EmptyState title="No coupons" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Usage</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {coupons.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs font-medium">{c.code}</TableCell>
                    <TableCell><Badge variant="outline">{c.discount_type}</Badge></TableCell>
                    <TableCell>
                      {c.discount_type === "percent" ? `${c.amount}%` : `$${c.amount}`}
                      {c.free_shipping ? <Badge variant="secondary" className="ml-2 text-[10px]">+ shipping</Badge> : null}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {c.usage_count}{c.usage_limit ? ` / ${c.usage_limit}` : ""}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {c.date_expires ? new Date(c.date_expires).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(c)}><Pencil className="h-3 w-3" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(c)} className="text-destructive">
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <PaginationBar page={paging.page} totalPages={paging.totalPages} total={paging.total} perPage={paging.perPage}
            onPageChange={setPage} onPerPageChange={setPerPage} disabled={isFetching} />
        </CardContent>
      </Card>
      <CouponDialog websiteId={websiteId} value={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function CouponDialog({ websiteId, value, onClose }: { websiteId: string; value: Coupon | "new" | null; onClose: () => void }) {
  const save = useServerFn(saveCoupon);
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [type, setType] = useState<"percent" | "fixed_cart" | "fixed_product">("percent");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [expires, setExpires] = useState("");
  const [usage, setUsage] = useState("");
  const [shipping, setShipping] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (value && value !== "new") {
      setCode(value.code); setType(value.discount_type as typeof type); setAmount(value.amount);
      setDesc(value.description ?? ""); setExpires(value.date_expires?.slice(0, 10) ?? "");
      setUsage(value.usage_limit?.toString() ?? ""); setShipping(value.free_shipping);
    } else if (value === "new") {
      setCode(""); setType("percent"); setAmount(""); setDesc(""); setExpires(""); setUsage(""); setShipping(false);
    }
  }, [value]);

  if (!value) return null;
  const isEdit = value !== "new";

  const submit = async () => {
    setSaving(true);
    try {
      await save({
        data: {
          website_id: websiteId,
          id: isEdit ? (value as Coupon).id : undefined,
          code, discount_type: type, amount,
          description: desc || undefined,
          date_expires: expires ? expires : null,
          usage_limit: usage ? Number(usage) : null,
          free_shipping: shipping,
        },
      });
      toast.success(isEdit ? "Coupon updated" : "Coupon created");
      qc.invalidateQueries({ queryKey: ["coupons", websiteId] });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{isEdit ? "Edit coupon" : "New coupon"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2"><Label>Code</Label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="SUMMER25" /></div>
          <div className="space-y-1.5">
            <Label>Discount type</Label>
            <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="percent">Percent</SelectItem>
                <SelectItem value="fixed_cart">Fixed cart</SelectItem>
                <SelectItem value="fixed_product">Fixed product</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Amount</Label><Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="25" /></div>
          <div className="space-y-1.5"><Label>Expires</Label><Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Usage limit</Label><Input type="number" value={usage} onChange={(e) => setUsage(e.target.value)} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label>Description</Label><Input value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={shipping} onChange={(e) => setShipping(e.target.checked)} />
            Grant free shipping
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !code || !amount}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {isEdit ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
