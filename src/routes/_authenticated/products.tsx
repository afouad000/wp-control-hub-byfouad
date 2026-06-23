import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { Loader2, RefreshCw, Pencil, AlertTriangle, Layers, Plus, Trash2 } from "lucide-react";
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
  listWebsites, fetchProducts, updateProduct, fetchVariations, updateVariation,
  createProduct, deleteProduct,
} from "@/lib/websites.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/products")({
  head: () => ({ meta: [{ title: "Products — WP Control Hub" }] }),
  component: ProductsPage,
});

type Product = {
  id: number; name: string; type: string; status: string;
  price: string; regular_price: string; sale_price: string;
  stock_status: string; stock_quantity: number | null; sku: string;
  images: Array<{ src: string }>;
};

type Variation = {
  id: number; sku: string; price: string; regular_price: string; sale_price: string;
  stock_status: string; stock_quantity: number | null;
  attributes: Array<{ id: number; name: string; option: string }>;
  image?: { src: string } | null;
};

function ProductsPage() {
  const listFn = useServerFn(listWebsites);
  const { data: sites = [] } = useQuery({ queryKey: ["websites"], queryFn: () => listFn() });
  const stores = sites.filter((s) => (s.meta as { woocommerce?: boolean })?.woocommerce);
  const [siteId, setSiteId] = useState<string>("");
  const active = siteId || stores[0]?.id || "";

  return (
    <div className="space-y-6">
      <PageHeader title="Products" description="Edit prices, stock, and variations across your WooCommerce stores." />
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
          {active ? <ProductsTable websiteId={active} /> : null}
        </>
      )}
    </div>
  );
}

function ProductsTable({ websiteId }: { websiteId: string }) {
  const fn = useServerFn(fetchProducts);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState<"all" | "instock" | "outofstock" | "onbackorder">("all");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [editing, setEditing] = useState<Product | null>(null);
  const [variationsFor, setVariationsFor] = useState<Product | null>(null);

  // Debounce search input, reset to page 1 on changes.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(q); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => { setPage(1); }, [stockFilter, perPage, websiteId]);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["products", websiteId, page, perPage, search, stockFilter],
    queryFn: () => fn({ data: {
      website_id: websiteId, page, per_page: perPage,
      search: search || undefined,
      stock_status: stockFilter === "all" ? undefined : stockFilter,
    } }),
  });

  const products = data?.ok ? data.products : [];
  const paging = data?.paging ?? { total: 0, totalPages: 0, page, perPage };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Products</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Input placeholder="Search name or SKU…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 w-52" />
            <Select value={stockFilter} onValueChange={(v) => setStockFilter(v as typeof stockFilter)}>
              <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stock</SelectItem>
                <SelectItem value="instock">In stock</SelectItem>
                <SelectItem value="outofstock">Out of stock</SelectItem>
                <SelectItem value="onbackorder">On backorder</SelectItem>
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
          ) : products.length === 0 ? (
            <EmptyState title="No matching products" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => {
                  const low = (p.stock_quantity ?? 99) <= 5 && p.stock_status === "instock";
                  const isVariable = p.type === "variable";
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>
                        <Badge variant={isVariable ? "secondary" : "outline"} className="text-[10px]">{p.type}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{p.sku || "—"}</TableCell>
                      <TableCell>
                        {isVariable ? (
                          <span className="text-xs text-muted-foreground">per variation</span>
                        ) : (
                          <>
                            ${p.price || "—"}
                            {p.sale_price ? <span className="ml-1 text-xs text-muted-foreground line-through">${p.regular_price}</span> : null}
                          </>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge variant={p.stock_status === "instock" ? "outline" : "secondary"}>{p.stock_status}</Badge>
                          {!isVariable && p.stock_quantity !== null ? <span className="text-xs text-muted-foreground">{p.stock_quantity}</span> : null}
                          {!isVariable && low ? <AlertTriangle className="h-3 w-3 text-amber-500" /> : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        {isVariable ? (
                          <Button size="sm" variant="ghost" onClick={() => setVariationsFor(p)}>
                            <Layers className="mr-1 h-3 w-3" /> Variations
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
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

      <EditProductDialog websiteId={websiteId} product={editing} onClose={() => setEditing(null)} />
      <VariationsDialog websiteId={websiteId} product={variationsFor} onClose={() => setVariationsFor(null)} />
    </>
  );
}

function EditProductDialog({
  websiteId, product, onClose,
}: { websiteId: string; product: Product | null; onClose: () => void }) {
  const update = useServerFn(updateProduct);
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [regular, setRegular] = useState("");
  const [sale, setSale] = useState("");
  const [stock, setStock] = useState("");
  const [stockStatus, setStockStatus] = useState<"instock" | "outofstock" | "onbackorder">("instock");
  const [sku, setSku] = useState("");

  useEffect(() => {
    if (product) {
      setRegular(product.regular_price ?? "");
      setSale(product.sale_price ?? "");
      setStock(product.stock_quantity?.toString() ?? "");
      setStockStatus((product.stock_status as "instock" | "outofstock" | "onbackorder") ?? "instock");
      setSku(product.sku ?? "");
    }
  }, [product]);

  if (!product) return null;

  const save = async () => {
    setSaving(true);
    try {
      await update({
        data: {
          website_id: websiteId,
          product_id: product.id,
          regular_price: regular || undefined,
          sale_price: sale || undefined,
          stock_quantity: stock === "" ? null : Number(stock),
          stock_status: stockStatus,
          sku: sku || undefined,
        },
      });
      toast.success("Product updated");
      qc.invalidateQueries({ queryKey: ["products", websiteId] });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!product} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{product.name}</DialogTitle>
          <p className="text-xs text-muted-foreground">Editing simple product fields.</p>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Regular price</Label><Input value={regular} onChange={(e) => setRegular(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Sale price</Label><Input value={sale} onChange={(e) => setSale(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Stock quantity</Label><Input value={stock} onChange={(e) => setStock(e.target.value)} type="number" /></div>
          <div className="space-y-1.5">
            <Label>Stock status</Label>
            <Select value={stockStatus} onValueChange={(v) => setStockStatus(v as typeof stockStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="instock">In stock</SelectItem>
                <SelectItem value="outofstock">Out of stock</SelectItem>
                <SelectItem value="onbackorder">On backorder</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2"><Label>SKU</Label><Input value={sku} onChange={(e) => setSku(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VariationsDialog({
  websiteId, product, onClose,
}: { websiteId: string; product: Product | null; onClose: () => void }) {
  const fn = useServerFn(fetchVariations);
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Variation | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    enabled: !!product,
    queryKey: ["variations", websiteId, product?.id],
    queryFn: () => fn({ data: { website_id: websiteId, product_id: product!.id, per_page: 100 } }),
  });

  if (!product) return null;

  return (
    <Dialog open={!!product} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{product.name} — variations</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Editing a variation only updates that variation — not the parent product.
          </p>
        </DialogHeader>
        {isLoading ? (
          <div className="h-24 animate-pulse rounded bg-muted" />
        ) : !data?.ok ? (
          <p className="text-sm text-destructive">{data?.error ?? "Failed to load"}</p>
        ) : data.variations.length === 0 ? (
          <EmptyState title="No variations" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Attributes</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Regular</TableHead>
                <TableHead>Sale</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.variations.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="text-xs">
                    {v.attributes.map((a) => `${a.name}: ${a.option}`).join(" · ") || `#${v.id}`}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{v.sku || "—"}</TableCell>
                  <TableCell>${v.regular_price || "—"}</TableCell>
                  <TableCell>${v.sale_price || "—"}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant={v.stock_status === "instock" ? "outline" : "secondary"}>{v.stock_status}</Badge>
                      {v.stock_quantity !== null ? <span className="text-xs text-muted-foreground">{v.stock_quantity}</span> : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(v)}><Pencil className="h-3 w-3" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-1 h-3 w-3 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
      <EditVariationDialog
        websiteId={websiteId}
        productId={product.id}
        variation={editing}
        onClose={() => setEditing(null)}
        onSaved={() => qc.invalidateQueries({ queryKey: ["variations", websiteId, product.id] })}
      />
    </Dialog>
  );
}

function EditVariationDialog({
  websiteId, productId, variation, onClose, onSaved,
}: { websiteId: string; productId: number; variation: Variation | null; onClose: () => void; onSaved: () => void }) {
  const update = useServerFn(updateVariation);
  const [saving, setSaving] = useState(false);
  const [regular, setRegular] = useState("");
  const [sale, setSale] = useState("");
  const [stock, setStock] = useState("");
  const [stockStatus, setStockStatus] = useState<"instock" | "outofstock" | "onbackorder">("instock");
  const [sku, setSku] = useState("");

  useEffect(() => {
    if (variation) {
      setRegular(variation.regular_price ?? "");
      setSale(variation.sale_price ?? "");
      setStock(variation.stock_quantity?.toString() ?? "");
      setStockStatus((variation.stock_status as "instock" | "outofstock" | "onbackorder") ?? "instock");
      setSku(variation.sku ?? "");
    }
  }, [variation]);

  if (!variation) return null;

  const save = async () => {
    setSaving(true);
    try {
      await update({
        data: {
          website_id: websiteId,
          product_id: productId,
          variation_id: variation.id,
          regular_price: regular || undefined,
          sale_price: sale || undefined,
          stock_quantity: stock === "" ? null : Number(stock),
          stock_status: stockStatus,
          sku: sku || undefined,
        },
      });
      toast.success("Variation updated");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!variation} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Variation #{variation.id}</DialogTitle>
          <p className="text-xs text-muted-foreground">
            {variation.attributes.map((a) => `${a.name}: ${a.option}`).join(" · ")}
          </p>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Regular price</Label><Input value={regular} onChange={(e) => setRegular(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Sale price</Label><Input value={sale} onChange={(e) => setSale(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Stock quantity</Label><Input value={stock} onChange={(e) => setStock(e.target.value)} type="number" /></div>
          <div className="space-y-1.5">
            <Label>Stock status</Label>
            <Select value={stockStatus} onValueChange={(v) => setStockStatus(v as typeof stockStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="instock">In stock</SelectItem>
                <SelectItem value="outofstock">Out of stock</SelectItem>
                <SelectItem value="onbackorder">On backorder</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2"><Label>SKU</Label><Input value={sku} onChange={(e) => setSku(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save variation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
