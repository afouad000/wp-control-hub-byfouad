import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PaginationBar } from "@/components/pagination-bar";
import { listWebsites, fetchCustomers } from "@/lib/websites.functions";

export const Route = createFileRoute("/_authenticated/customers")({
  head: () => ({ meta: [{ title: "Customers — WP Control Hub" }] }),
  component: CustomersPage,
});

function CustomersPage() {
  const listFn = useServerFn(listWebsites);
  const { data: sites = [] } = useQuery({ queryKey: ["websites"], queryFn: () => listFn() });
  const stores = sites.filter((s) => (s.meta as { woocommerce?: boolean })?.woocommerce);
  const [siteId, setSiteId] = useState<string>("");
  const active = siteId || stores[0]?.id || "";

  return (
    <div className="space-y-6">
      <PageHeader title="Customers" description="View WooCommerce customers across your stores." />
      {stores.length === 0 ? (
        <EmptyState title="No WooCommerce stores connected" />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {stores.map((s) => (
              <Button key={s.id} size="sm" variant={active === s.id ? "default" : "outline"} onClick={() => setSiteId(s.id)}>
                {s.name}
              </Button>
            ))}
          </div>
          {active ? <CustomersTable websiteId={active} /> : null}
        </>
      )}
    </div>
  );
}

function CustomersTable({ websiteId }: { websiteId: string }) {
  const fn = useServerFn(fetchCustomers);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(q); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => { setPage(1); }, [perPage, websiteId]);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["customers", websiteId, page, perPage, search],
    queryFn: () => fn({ data: {
      website_id: websiteId, page, per_page: perPage,
      search: search || undefined,
    } }),
  });

  const customers = data?.ok ? data.customers : [];
  const paging = data?.paging ?? { total: 0, totalPages: 0, page, perPage };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Customers</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder="Search name or email…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 w-52" />
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
        ) : customers.length === 0 ? (
          <EmptyState title="No customers found" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Orders</TableHead>
                <TableHead>Total spent</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.first_name} {c.last_name}</TableCell>
                  <TableCell className="text-xs">{c.email}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.username || "—"}</TableCell>
                  <TableCell>{c.orders_count ?? 0}</TableCell>
                  <TableCell>${c.total_spent ?? "0.00"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {c.date_created ? new Date(c.date_created).toLocaleDateString() : "—"}
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
