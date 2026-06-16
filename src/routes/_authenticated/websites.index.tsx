import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Globe, Plus, Search, ExternalLink, AlertCircle, CheckCircle2 } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { listWebsites } from "@/lib/websites.functions";

export const Route = createFileRoute("/_authenticated/websites/")({
  head: () => ({ meta: [{ title: "Websites — WP Control Hub" }] }),
  component: WebsitesList,
});

function WebsitesList() {
  const fn = useServerFn(listWebsites);
  const [q, setQ] = useState("");
  const { data: sites = [], isLoading } = useQuery({ queryKey: ["websites"], queryFn: () => fn() });

  const filtered = sites.filter(
    (s) =>
      s.name.toLowerCase().includes(q.toLowerCase()) ||
      s.url.toLowerCase().includes(q.toLowerCase()) ||
      (s.client_name ?? "").toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Websites"
        description="All WordPress sites you've connected."
        actions={
          <Button asChild size="sm">
            <Link to="/websites/new"><Plus className="mr-2 h-4 w-4" /> Add website</Link>
          </Button>
        }
      />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, URL or client…" className="pl-9" />
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-32 animate-pulse rounded-lg bg-muted" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Globe className="h-6 w-6" />}
          title={sites.length === 0 ? "No websites yet" : "No matching sites"}
          description={sites.length === 0 ? "Connect your first WordPress site." : "Try a different search."}
          action={
            sites.length === 0 ? (
              <Button asChild size="sm"><Link to="/websites/new"><Plus className="mr-2 h-4 w-4" /> Add website</Link></Button>
            ) : null
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => {
            const m = (s.meta ?? {}) as { woocommerce?: boolean; theme?: string; plugins_count?: number };
            return (
              <Link key={s.id} to="/websites/$id" params={{ id: s.id }}>
                <Card className="group h-full p-4 transition hover:border-foreground/30">
                  <div className="flex items-start justify-between">
                    <div className="grid h-9 w-9 place-items-center rounded-md border bg-muted/40">
                      <Globe className="h-4 w-4" />
                    </div>
                    {s.status === "connected" ? (
                      <Badge variant="outline" className="border-success/40 text-success">
                        <CheckCircle2 className="mr-1 h-3 w-3" /> Live
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-destructive/40 text-destructive">
                        <AlertCircle className="mr-1 h-3 w-3" /> {s.status}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-3 truncate font-medium">{s.name}</div>
                  <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                    {s.url} <ExternalLink className="h-3 w-3" />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
                    {m.woocommerce ? <Badge variant="secondary">WooCommerce</Badge> : null}
                    {m.theme ? <Badge variant="outline">{m.theme}</Badge> : null}
                    {m.plugins_count !== undefined ? <Badge variant="outline">{m.plugins_count} plugins</Badge> : null}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
