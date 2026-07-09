import { RequirePermission } from "@/components/require-permission";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Activity, ChevronRight, Search } from "lucide-react";
import { listAuditLogs, listWebsites } from "@/lib/websites.functions";

export const Route = createFileRoute("/_authenticated/activity")({
  head: () => ({ meta: [{ title: "Activity — WP Control Hub" }] }),
  component: () => (<RequirePermission permission="view_activity_logs"><ActivityPage /></RequirePermission>),
});

type Log = {
  id: string;
  action: string;
  details: unknown;
  website_id: string | null;
  user_id: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  old_value?: unknown;
  new_value?: unknown;
  status?: string | null;
  created_at: string;
};

// Human-friendly labels for common actions.
const ACTION_LABEL: Record<string, string> = {
  "website.connected": "Website connected",
  "website.updated": "Website updated",
  "website.deleted": "Website deleted",
  "website.refreshed": "Website refreshed",
  "website.member_added": "Team member added",
  "website.member_updated": "Team member updated",
  "website.member_removed": "Team member removed",
  "product.created": "Product created",
  "product.updated": "Product updated",
  "product.deleted": "Product deleted",
  "product.variation_updated": "Variation updated",
  "order.status_changed": "Order status changed",
  "order.note_added": "Order note added",
  "order.refunded": "Order refunded",
  "coupon.created": "Coupon created",
  "coupon.updated": "Coupon updated",
  "coupon.deleted": "Coupon deleted",
};

function categoryOf(action: string): "website" | "product" | "order" | "coupon" | "other" {
  if (action.startsWith("website.")) return "website";
  if (action.startsWith("product.")) return "product";
  if (action.startsWith("order.")) return "order";
  if (action.startsWith("coupon.")) return "coupon";
  return "other";
}

const CATEGORY_STYLES: Record<string, string> = {
  website: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  product: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  order: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  coupon: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  other: "bg-muted text-muted-foreground border-border",
};

function summarize(l: Log): string {
  const d = (l.details as Record<string, unknown> | null) ?? {};
  const nv = (l.new_value as Record<string, unknown> | null) ?? {};
  const merged = { ...d, ...nv };
  const parts: string[] = [];
  const push = (label: string, key: string) => {
    const v = merged[key];
    if (v !== undefined && v !== null && v !== "") parts.push(`${label}: ${String(v)}`);
  };
  push("Order", "order_id");
  push("Product", "product_id");
  push("Variation", "variation_id");
  push("Coupon", "code");
  push("New status", "new_status");
  push("Amount", "amount");
  push("Role", "role");
  push("Email", "email");
  push("Name", "name");
  push("URL", "url");
  return parts.slice(0, 3).join(" · ");
}

function ActivityPage() {
  const fn = useServerFn(listAuditLogs);
  const sitesFn = useServerFn(listWebsites);
  const { data: sites = [] } = useQuery({ queryKey: ["websites"], queryFn: () => sitesFn() });
  const { data = [], isLoading } = useQuery<Log[]>({
    queryKey: ["audit"],
    queryFn: () => fn() as Promise<Log[]>,
  });

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [siteId, setSiteId] = useState<string>("all");
  const [selected, setSelected] = useState<Log | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.filter((l) => {
      if (category !== "all" && categoryOf(l.action) !== category) return false;
      if (siteId !== "all" && l.website_id !== siteId) return false;
      if (!q) return true;
      const hay = `${l.action} ${JSON.stringify(l.details ?? {})} ${JSON.stringify(l.new_value ?? {})}`.toLowerCase();
      return hay.includes(q);
    });
  }, [data, query, category, siteId]);

  const siteName = (id: string | null) => sites.find((s) => s.id === id)?.name;

  return (
    <div className="space-y-6">
      <PageHeader title="Activity logs" description="Every action performed in the workspace. Click any entry to see the diff." />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search action, entity, status…" className="pl-8" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            <SelectItem value="website">Websites</SelectItem>
            <SelectItem value="product">Products</SelectItem>
            <SelectItem value="order">Orders</SelectItem>
            <SelectItem value="coupon">Coupons</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
        <Select value={siteId} onValueChange={setSiteId}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Website" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All websites</SelectItem>
            {sites.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded bg-muted" />)}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={<Activity className="h-6 w-6" />} title="No matching activity" description="Try adjusting filters or invite team activity." />
          ) : (
            <div className="divide-y">
              {filtered.map((l) => {
                const cat = categoryOf(l.action);
                return (
                  <button
                    key={l.id}
                    onClick={() => setSelected(l)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                  >
                    <Badge variant="outline" className={`shrink-0 font-normal ${CATEGORY_STYLES[cat]}`}>{cat}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {ACTION_LABEL[l.action] ?? l.action}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {summarize(l) || "—"}
                      </div>
                    </div>
                    <div className="hidden sm:flex shrink-0 items-center gap-2">
                      {l.status ? <Badge variant={l.status === "success" ? "default" : "destructive"} className="text-[10px]">{l.status}</Badge> : null}
                      {l.website_id ? (
                        <Badge variant="outline" className="text-[10px]">
                          {siteName(l.website_id) ?? l.website_id.slice(0, 8)}
                        </Badge>
                      ) : null}
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</span>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <LogDetailDialog log={selected} onClose={() => setSelected(null)} siteName={siteName} />
    </div>
  );
}

function LogDetailDialog({ log, onClose, siteName }: { log: Log | null; onClose: () => void; siteName: (id: string | null) => string | undefined }) {
  if (!log) return null;
  const hasDiff = log.old_value != null || log.new_value != null;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">{ACTION_LABEL[log.action] ?? log.action}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2 pt-1">
            <span>{new Date(log.created_at).toLocaleString()}</span>
            {log.website_id ? <Badge variant="outline">{siteName(log.website_id) ?? log.website_id.slice(0, 8)}</Badge> : null}
            {log.entity_type ? <Badge variant="outline">{log.entity_type}</Badge> : null}
            {log.status ? <Badge variant={log.status === "success" ? "default" : "destructive"}>{log.status}</Badge> : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {hasDiff ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Before</div>
                <pre className="rounded bg-muted p-3 text-xs overflow-x-auto max-h-56">{JSON.stringify(log.old_value ?? null, null, 2)}</pre>
              </div>
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">After</div>
                <pre className="rounded bg-muted p-3 text-xs overflow-x-auto max-h-56">{JSON.stringify(log.new_value ?? null, null, 2)}</pre>
              </div>
            </div>
          ) : null}

          <div>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Details</div>
            <pre className="rounded bg-muted p-3 text-xs overflow-x-auto max-h-56">{JSON.stringify(log.details ?? {}, null, 2)}</pre>
          </div>
        </div>

        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
