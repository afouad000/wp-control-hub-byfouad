import { sanitizedHtmlProps } from "@/lib/sanitize";
import { createFileRoute, Link, useParams, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  ArrowLeft, ExternalLink, RefreshCw, Trash2, Globe, ShoppingCart, Package, Users as UsersIcon,
  KeyRound, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatCard } from "@/components/stat-card";
import { PageHeader, EmptyState } from "@/components/page-header";
import { ConnectionBadge } from "@/components/connection-badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  getWebsite, refreshWebsite, deleteWebsite, reconnectWebsite,
  fetchPosts, fetchProducts, fetchOrders,
} from "@/lib/websites.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/websites/$id")({
  head: () => ({ meta: [{ title: "Website — WP Control Hub" }] }),
  component: WebsiteDetail,
});

function WebsiteDetail() {
  const { id } = useParams({ from: "/_authenticated/websites/$id" });
  const get = useServerFn(getWebsite);
  const refresh = useServerFn(refreshWebsite);
  const remove = useServerFn(deleteWebsite);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: site, isLoading } = useQuery({
    queryKey: ["website", id],
    queryFn: () => get({ data: { id } }),
  });

  const onRefresh = async () => {
    const t = toast.loading("Pinging site…");
    try {
      const r = await refresh({ data: { id } });
      toast.dismiss(t);
      qc.invalidateQueries({ queryKey: ["website", id] });
      qc.invalidateQueries({ queryKey: ["websites"] });
      if (r.ok) toast.success("Site is reachable");
      else toast.error(`Probe failed: ${r.error ?? "unknown"}`);
    } catch (e) {
      toast.dismiss(t);
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const onDelete = async () => {
    if (!confirm("Disconnect this site? Credentials will be deleted.")) return;
    await remove({ data: { id } });
    qc.invalidateQueries({ queryKey: ["websites"] });
    toast.success("Disconnected");
    navigate({ to: "/websites" });
  };

  if (isLoading) return <div className="h-32 animate-pulse rounded-lg bg-muted" />;
  if (!site) return <EmptyState title="Not found" description="This website doesn't exist or you don't have access." />;

  const m = (site.meta ?? {}) as {
    woocommerce?: boolean; theme?: string; plugins_count?: number;
    orders?: number; products?: number; customers?: number; revenue?: number;
  };

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link to="/websites"><ArrowLeft className="mr-2 h-4 w-4" /> All websites</Link>
      </Button>

      <PageHeader
        title={site.name}
        description={site.url}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <a href={site.url} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" /> Visit</a>
            </Button>
            <Button variant="outline" size="sm" onClick={onRefresh}><RefreshCw className="mr-2 h-4 w-4" /> Refresh</Button>
            <ReconnectButton site={site} />
            <Button variant="outline" size="sm" onClick={onDelete} className="text-destructive">
              <Trash2 className="mr-2 h-4 w-4" /> Disconnect
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <ConnectionBadge status={site.connection_status ?? site.status} />
        {m.woocommerce ? <Badge variant="secondary">WooCommerce active</Badge> : null}
        {m.theme ? <Badge variant="outline">Theme: {m.theme}</Badge> : null}
        {m.plugins_count !== undefined ? <Badge variant="outline">{m.plugins_count} plugins</Badge> : null}
        {site.last_error ? (
          <Badge variant="outline" className="border-destructive/40 text-destructive max-w-md truncate" title={site.last_error}>
            {site.last_error}
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Revenue" value={`$${(m.revenue ?? 0).toFixed(2)}`} icon={<ShoppingCart className="h-4 w-4" />} />
        <StatCard label="Orders" value={m.orders ?? "—"} icon={<Package className="h-4 w-4" />} />
        <StatCard label="Products" value={m.products ?? "—"} icon={<Globe className="h-4 w-4" />} />
        <StatCard label="Customers" value={m.customers ?? "—"} icon={<UsersIcon className="h-4 w-4" />} />
      </div>

      <Tabs defaultValue="wordpress">
        <TabsList>
          <TabsTrigger value="wordpress">WordPress</TabsTrigger>
          <TabsTrigger value="woocommerce" disabled={!m.woocommerce}>WooCommerce</TabsTrigger>
          <TabsTrigger value="health">Health</TabsTrigger>
        </TabsList>

        <TabsContent value="wordpress" className="mt-4 space-y-4">
          <PostsPanel websiteId={id} />
        </TabsContent>

        <TabsContent value="woocommerce" className="mt-4 space-y-4">
          {m.woocommerce ? (
            <>
              <ProductsPanel websiteId={id} />
              <OrdersPanel websiteId={id} />
            </>
          ) : (
            <EmptyState title="WooCommerce not detected" description="Install and activate WooCommerce on your site." />
          )}
        </TabsContent>

        <TabsContent value="health" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Site health</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Last checked" value={site.last_checked_at ? new Date(site.last_checked_at).toLocaleString() : "Never"} />
              <Row label="Status" value={site.status} />
              <Row label="Plugins detected" value={m.plugins_count ?? "—"} />
              <Row label="Active theme" value={m.theme ?? "—"} />
              <Row label="WooCommerce" value={m.woocommerce ? "Active" : "Not installed"} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b py-2 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function ReconnectButton({ site }: { site: { id: string; url: string } }) {
  const reconnect = useServerFn(reconnectWebsite);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [url, setUrl] = useState(site.url);
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [ck, setCk] = useState("");
  const [cs, setCs] = useState("");

  const submit = async () => {
    setSaving(true);
    try {
      await reconnect({
        data: { id: site.id, url, wp_username: user, wp_app_password: pass, wc_consumer_key: ck || null, wc_consumer_secret: cs || null },
      });
      toast.success("Credentials updated");
      qc.invalidateQueries({ queryKey: ["website", site.id] });
      qc.invalidateQueries({ queryKey: ["websites"] });
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <KeyRound className="mr-2 h-4 w-4" /> Reconnect
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update credentials</DialogTitle>
          <DialogDescription>We'll test the new credentials before saving. Invalid keys won't overwrite the current ones.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2"><Label>WordPress URL</Label><Input value={url} onChange={(e) => setUrl(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>WP username</Label><Input value={user} onChange={(e) => setUser(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Application password</Label><Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>WC Consumer key</Label><Input value={ck} onChange={(e) => setCk(e.target.value)} placeholder="ck_…" /></div>
          <div className="space-y-1.5"><Label>WC Consumer secret</Label><Input type="password" value={cs} onChange={(e) => setCs(e.target.value)} placeholder="cs_…" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !url || !user || !pass}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Test & save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PostsPanel({ websiteId }: { websiteId: string }) {
  const fn = useServerFn(fetchPosts);
  const { data, isLoading } = useQuery({
    queryKey: ["posts", websiteId],
    queryFn: () => fn({ data: { website_id: websiteId } }),
  });
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Latest posts</CardTitle></CardHeader>
      <CardContent>
        {isLoading ? <div className="h-24 animate-pulse rounded bg-muted" /> :
          !data?.ok ? <p className="text-sm text-destructive">{data?.error ?? "Failed to load"}</p> :
          data.posts.length === 0 ? <EmptyState title="No posts" /> :
          <Table>
            <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.posts.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium" {...sanitizedHtmlProps(p.title.rendered)} />
                  <TableCell><Badge variant="outline">{p.status}</Badge></TableCell>
                  <TableCell className="text-muted-foreground text-xs">{new Date(p.date).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        }
      </CardContent>
    </Card>
  );
}

function ProductsPanel({ websiteId }: { websiteId: string }) {
  const fn = useServerFn(fetchProducts);
  const { data, isLoading } = useQuery({
    queryKey: ["products", websiteId],
    queryFn: () => fn({ data: { website_id: websiteId } }),
  });
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Products</CardTitle></CardHeader>
      <CardContent>
        {isLoading ? <div className="h-24 animate-pulse rounded bg-muted" /> :
          !data?.ok ? <p className="text-sm text-destructive">{data?.error ?? "Failed to load"}</p> :
          data.products.length === 0 ? <EmptyState title="No products" /> :
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>SKU</TableHead><TableHead>Price</TableHead><TableHead>Stock</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.products.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.sku || "—"}</TableCell>
                  <TableCell>${p.price || "—"}</TableCell>
                  <TableCell><Badge variant={p.stock_status === "instock" ? "outline" : "secondary"}>{p.stock_status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        }
      </CardContent>
    </Card>
  );
}

function OrdersPanel({ websiteId }: { websiteId: string }) {
  const fn = useServerFn(fetchOrders);
  const { data, isLoading } = useQuery({
    queryKey: ["orders", websiteId],
    queryFn: () => fn({ data: { website_id: websiteId } }),
  });
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Recent orders</CardTitle></CardHeader>
      <CardContent>
        {isLoading ? <div className="h-24 animate-pulse rounded bg-muted" /> :
          !data?.ok ? <p className="text-sm text-destructive">{data?.error ?? "Failed to load"}</p> :
          data.orders.length === 0 ? <EmptyState title="No orders yet" /> :
          <Table>
            <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Customer</TableHead><TableHead>Status</TableHead><TableHead>Total</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.orders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-mono text-xs">#{o.number}</TableCell>
                  <TableCell>{o.billing.first_name} {o.billing.last_name}</TableCell>
                  <TableCell><Badge variant="outline">{o.status}</Badge></TableCell>
                  <TableCell className="font-medium">{o.currency} {o.total}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(o.date_created).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        }
      </CardContent>
    </Card>
  );
}
