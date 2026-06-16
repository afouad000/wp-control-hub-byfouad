import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity } from "lucide-react";
import { listAuditLogs } from "@/lib/websites.functions";

export const Route = createFileRoute("/_authenticated/activity")({
  head: () => ({ meta: [{ title: "Activity — WP Control Hub" }] }),
  component: ActivityPage,
});

function ActivityPage() {
  const fn = useServerFn(listAuditLogs);
  const { data = [], isLoading } = useQuery({ queryKey: ["audit"], queryFn: () => fn() });

  return (
    <div className="space-y-6">
      <PageHeader title="Activity logs" description="Every action performed in the workspace." />
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-muted" />)}
            </div>
          ) : data.length === 0 ? (
            <EmptyState icon={<Activity className="h-6 w-6" />} title="No activity yet" />
          ) : (
            <div className="divide-y">
              {data.map((l) => (
                <div key={l.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:flex sm:justify-between">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{l.action}</div>
                    <div className="truncate text-xs text-muted-foreground">{JSON.stringify(l.details)}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {l.website_id ? <Badge variant="outline" className="font-mono text-[10px]">{l.website_id.slice(0, 8)}</Badge> : null}
                    <span className="text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
