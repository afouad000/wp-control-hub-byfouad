import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PUBLIC_COLUMNS =
  "id, owner_id, name, url, client_name, logo_url, status, connection_status, last_checked_at, last_error, meta, created_at, updated_at, wp_username";

const ConnectInput = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().url().max(2048),
  client_name: z.string().trim().max(120).optional().nullable(),
  logo_url: z.string().trim().url().max(2048).optional().nullable(),
  wp_username: z.string().trim().min(1).max(120),
  wp_app_password: z.string().trim().min(1).max(512),
  wc_consumer_key: z.string().trim().max(512).optional().nullable(),
  wc_consumer_secret: z.string().trim().max(512).optional().nullable(),
});

const TestInput = z.object({
  url: z.string().trim().url().max(2048),
  wp_username: z.string().trim().min(1).max(120),
  wp_app_password: z.string().trim().min(1).max(512),
  wc_consumer_key: z.string().trim().max(512).optional().nullable(),
  wc_consumer_secret: z.string().trim().max(512).optional().nullable(),
});

const ReconnectInput = TestInput.extend({ id: z.string().uuid() });

const UpdateInput = ConnectInput.partial().extend({ id: z.string().uuid() });

const IdInput = z.object({ id: z.string().uuid() });

export const listWebsites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("websites")
      .select(PUBLIC_COLUMNS)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getWebsite = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("websites")
      .select(PUBLIC_COLUMNS)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });

/** Probe credentials without saving anything — powers the wizard's Test step. */
export const testConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => TestInput.parse(d))
  .handler(async ({ data }) => {
    return probeSite(data.url, data.wp_username, data.wp_app_password, data.wc_consumer_key, data.wc_consumer_secret);
  });

export const connectWebsite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ConnectInput.parse(d))
  .handler(async ({ data, context }) => {
    const probe = await probeSite(data.url, data.wp_username, data.wp_app_password, data.wc_consumer_key, data.wc_consumer_secret);
    if (!probe.ok) {
      // Refuse to save invalid credentials per spec
      throw new Error(probe.error ?? "Connection test failed — credentials not saved.");
    }

    const { data: inserted, error } = await context.supabase
      .from("websites")
      .insert({
        owner_id: context.userId,
        name: data.name,
        url: data.url.replace(/\/$/, ""),
        client_name: data.client_name ?? null,
        logo_url: data.logo_url ?? null,
        wp_username: data.wp_username,
        wp_app_password: data.wp_app_password,
        wc_consumer_key: data.wc_consumer_key ?? null,
        wc_consumer_secret: data.wc_consumer_secret ?? null,
        status: "connected",
        connection_status: probe.info.woocommerce ? "connected" : "connected_no_wc",
        last_checked_at: new Date().toISOString(),
        last_error: null,
        meta: probe.info,
      })
      .select(PUBLIC_COLUMNS)
      .single();
    if (error) throw new Error(error.message);

    await context.supabase.from("audit_logs").insert({
      user_id: context.userId,
      website_id: inserted.id,
      action: "website.connected",
      details: { url: data.url, woocommerce: probe.info.woocommerce ?? false },
    });

    return { website: inserted, probe };
  });

/** Update credentials for an existing site; re-tests before saving. */
export const reconnectWebsite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ReconnectInput.parse(d))
  .handler(async ({ data, context }) => {
    const probe = await probeSite(data.url, data.wp_username, data.wp_app_password, data.wc_consumer_key, data.wc_consumer_secret);
    if (!probe.ok) {
      // Mark error but don't overwrite stored creds
      await context.supabase
        .from("websites")
        .update({
          connection_status: "error",
          last_checked_at: new Date().toISOString(),
          last_error: probe.error ?? "Unknown error",
        })
        .eq("id", data.id);
      throw new Error(probe.error ?? "Test failed — credentials not updated.");
    }
    const { error } = await context.supabase
      .from("websites")
      .update({
        url: data.url.replace(/\/$/, ""),
        wp_username: data.wp_username,
        wp_app_password: data.wp_app_password,
        wc_consumer_key: data.wc_consumer_key ?? null,
        wc_consumer_secret: data.wc_consumer_secret ?? null,
        status: "connected",
        connection_status: probe.info.woocommerce ? "connected" : "connected_no_wc",
        last_checked_at: new Date().toISOString(),
        last_error: null,
        meta: probe.info,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_logs").insert({
      user_id: context.userId,
      website_id: data.id,
      action: "website.credentials_updated",
      details: { woocommerce: probe.info.woocommerce ?? false },
    });
    return probe;
  });

export const updateWebsite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => UpdateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) cleaned[k] = v;
    const { error } = await context.supabase.from("websites").update(cleaned as never).eq("id", id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_logs").insert({
      user_id: context.userId,
      website_id: id,
      action: "website.updated",
      details: { fields: Object.keys(cleaned) },
    });
    return { ok: true };
  });

export const deleteWebsite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("websites").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_logs").insert({
      user_id: context.userId,
      website_id: null,
      action: "website.disconnected",
      details: { id: data.id },
    });
    return { ok: true };
  });

export const refreshWebsite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: site, error } = await context.supabase
      .from("websites")
      .select("id, url, wp_username, wp_app_password, wc_consumer_key, wc_consumer_secret")
      .eq("id", data.id)
      .maybeSingle();
    if (error || !site) throw new Error(error?.message ?? "Site not found");
    const probe = await probeSite(
      site.url,
      site.wp_username ?? "",
      site.wp_app_password ?? "",
      site.wc_consumer_key,
      site.wc_consumer_secret,
    );
    await context.supabase
      .from("websites")
      .update({
        status: probe.ok ? "connected" : "error",
        connection_status: probe.ok ? (probe.info.woocommerce ? "connected" : "connected_no_wc") : "error",
        last_checked_at: new Date().toISOString(),
        last_error: probe.ok ? null : probe.error ?? "Unknown error",
        ...(probe.ok ? { meta: probe.info } : {}),
      })
      .eq("id", data.id);
    return probe;
  });

export const listAuditLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("audit_logs")
      .select("id, action, details, website_id, user_id, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ---------- WordPress / WooCommerce probes ----------

type Probe = {
  ok: boolean;
  error?: string;
  info: {
    wp_version?: string;
    theme?: string;
    plugins_count?: number;
    woocommerce?: boolean;
    orders?: number;
    products?: number;
    customers?: number;
    revenue?: number;
  };
};

async function probeSite(
  url: string,
  user: string,
  pass: string,
  ck?: string | null,
  cs?: string | null,
): Promise<Probe> {
  const base = url.replace(/\/$/, "");
  const wpAuth = "Basic " + btoa(`${user}:${pass}`);
  const info: Probe["info"] = {};
  try {
    const root = await fetch(`${base}/wp-json/`, { headers: { Authorization: wpAuth } });
    if (!root.ok) {
      const body = await root.text().catch(() => "");
      const hint =
        root.status === 401 || root.status === 403
          ? "WordPress rejected the Application Password. Generate a new one under Users → Profile."
          : root.status === 404
            ? "WordPress REST API not found. Check the URL and that permalinks are not 'Plain'."
            : body.slice(0, 200);
      return { ok: false, error: `WP REST ${root.status}: ${hint}`, info };
    }
    const rootJson = (await root.json()) as { description?: string; namespaces?: string[] };
    info.woocommerce = (rootJson.namespaces ?? []).includes("wc/v3");

    const plugins = await fetch(`${base}/wp-json/wp/v2/plugins`, { headers: { Authorization: wpAuth } });
    if (plugins.ok) {
      const pj = (await plugins.json()) as unknown[];
      info.plugins_count = Array.isArray(pj) ? pj.length : undefined;
    }

    const themes = await fetch(`${base}/wp-json/wp/v2/themes?status=active`, { headers: { Authorization: wpAuth } });
    if (themes.ok) {
      const tj = (await themes.json()) as Array<{ name?: { raw?: string } | string }>;
      const first = tj[0];
      const name = first?.name;
      info.theme = typeof name === "string" ? name : name?.raw;
    }

    if (info.woocommerce && ck && cs) {
      const wcAuth = "Basic " + btoa(`${ck}:${cs}`);
      const sanity = await fetch(`${base}/wp-json/wc/v3/system_status?_fields=settings`, {
        headers: { Authorization: wcAuth },
      });
      if (sanity.status === 401) {
        return { ok: false, error: "WooCommerce REST keys are invalid. Regenerate Consumer Key/Secret.", info };
      }
      const [orders, products, customers] = await Promise.all([
        fetch(`${base}/wp-json/wc/v3/orders?per_page=1`, { headers: { Authorization: wcAuth } }),
        fetch(`${base}/wp-json/wc/v3/products?per_page=1`, { headers: { Authorization: wcAuth } }),
        fetch(`${base}/wp-json/wc/v3/customers?per_page=1`, { headers: { Authorization: wcAuth } }),
      ]);
      info.orders = parseInt(orders.headers.get("x-wp-total") ?? "0", 10) || 0;
      info.products = parseInt(products.headers.get("x-wp-total") ?? "0", 10) || 0;
      info.customers = parseInt(customers.headers.get("x-wp-total") ?? "0", 10) || 0;

      const report = await fetch(`${base}/wp-json/wc/v3/reports/sales`, { headers: { Authorization: wcAuth } });
      if (report.ok) {
        const rj = (await report.json()) as Array<{ total_sales?: string }>;
        info.revenue = parseFloat(rj[0]?.total_sales ?? "0") || 0;
      }
    }

    return { ok: true, info };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error", info };
  }
}

// ---------- Live content APIs (all server-side; creds never leave the server) ----------

const SiteScoped = z.object({ website_id: z.string().uuid() });

type Creds = {
  url: string;
  wp_username: string | null;
  wp_app_password: string | null;
  wc_consumer_key: string | null;
  wc_consumer_secret: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getCreds(context: any, id: string): Promise<Creds> {
  const { data, error } = await context.supabase
    .from("websites")
    .select("url, wp_username, wp_app_password, wc_consumer_key, wc_consumer_secret")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "Not found");
  return data as Creds;
}

const wcAuthHeader = (c: Creds) =>
  "Basic " + btoa(`${c.wc_consumer_key}:${c.wc_consumer_secret}`);

export const fetchPosts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => SiteScoped.parse(d))
  .handler(async ({ data, context }) => {
    const c = await getCreds(context, data.website_id);
    try {
      const res = await fetch(`${c.url.replace(/\/$/, "")}/wp-json/wp/v2/posts?per_page=20&_embed`, {
        headers: { Authorization: "Basic " + btoa(`${c.wp_username}:${c.wp_app_password}`) },
      });
      if (!res.ok) return { ok: false as const, error: `HTTP ${res.status}`, posts: [] };
      return { ok: true as const, posts: (await res.json()) as Array<{ id: number; title: { rendered: string }; status: string; date: string; link: string }> };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Network error", posts: [] };
    }
  });

export const fetchProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => SiteScoped.parse(d))
  .handler(async ({ data, context }) => {
    const c = await getCreds(context, data.website_id);
    if (!c.wc_consumer_key || !c.wc_consumer_secret) return { ok: false as const, error: "WooCommerce keys missing", products: [] };
    try {
      const res = await fetch(`${c.url.replace(/\/$/, "")}/wp-json/wc/v3/products?per_page=50`, {
        headers: { Authorization: wcAuthHeader(c) },
      });
      if (!res.ok) return { ok: false as const, error: `HTTP ${res.status}`, products: [] };
      return {
        ok: true as const,
        products: (await res.json()) as Array<{
          id: number; name: string; price: string; regular_price: string; sale_price: string;
          stock_status: string; stock_quantity: number | null; sku: string; status: string;
          images: Array<{ src: string }>;
        }>,
      };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Network error", products: [] };
    }
  });

export const fetchOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => SiteScoped.parse(d))
  .handler(async ({ data, context }) => {
    const c = await getCreds(context, data.website_id);
    if (!c.wc_consumer_key || !c.wc_consumer_secret) return { ok: false as const, error: "WooCommerce keys missing", orders: [] };
    try {
      const res = await fetch(`${c.url.replace(/\/$/, "")}/wp-json/wc/v3/orders?per_page=50`, {
        headers: { Authorization: wcAuthHeader(c) },
      });
      if (!res.ok) return { ok: false as const, error: `HTTP ${res.status}`, orders: [] };
      return {
        ok: true as const,
        orders: (await res.json()) as Array<{
          id: number; number: string; status: string; total: string; currency: string;
          date_created: string; billing: { first_name: string; last_name: string; email: string };
        }>,
      };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Network error", orders: [] };
    }
  });

const UpdateOrderInput = z.object({
  website_id: z.string().uuid(),
  order_id: z.number().int().positive(),
  status: z.enum(["pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed"]),
});

export const updateOrderStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => UpdateOrderInput.parse(d))
  .handler(async ({ data, context }) => {
    const c = await getCreds(context, data.website_id);
    if (!c.wc_consumer_key || !c.wc_consumer_secret) throw new Error("WooCommerce keys missing");
    const res = await fetch(`${c.url.replace(/\/$/, "")}/wp-json/wc/v3/orders/${data.order_id}`, {
      method: "PUT",
      headers: { Authorization: wcAuthHeader(c), "Content-Type": "application/json" },
      body: JSON.stringify({ status: data.status }),
    });
    if (!res.ok) throw new Error(`Failed to update order: HTTP ${res.status}`);
    await context.supabase.from("audit_logs").insert({
      user_id: context.userId,
      website_id: data.website_id,
      action: "order.status_changed",
      details: { order_id: data.order_id, new_status: data.status },
    });
    return { ok: true };
  });

const UpdateProductInput = z.object({
  website_id: z.string().uuid(),
  product_id: z.number().int().positive(),
  regular_price: z.string().optional(),
  sale_price: z.string().optional(),
  stock_quantity: z.number().int().optional().nullable(),
  stock_status: z.enum(["instock", "outofstock", "onbackorder"]).optional(),
  sku: z.string().optional(),
});

export const updateProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => UpdateProductInput.parse(d))
  .handler(async ({ data, context }) => {
    const c = await getCreds(context, data.website_id);
    if (!c.wc_consumer_key || !c.wc_consumer_secret) throw new Error("WooCommerce keys missing");
    const { website_id, product_id, ...patch } = data;
    // strip undefined
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) body[k] = v;
    if (body.stock_quantity !== undefined && body.stock_quantity !== null) {
      body.manage_stock = true;
    }
    const res = await fetch(`${c.url.replace(/\/$/, "")}/wp-json/wc/v3/products/${product_id}`, {
      method: "PUT",
      headers: { Authorization: wcAuthHeader(c), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Failed to update product: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    await context.supabase.from("audit_logs").insert({
      user_id: context.userId,
      website_id,
      action: "product.updated",
      details: { product_id, fields: Object.keys(body) },
    });
    return { ok: true };
  });

export const fetchCustomers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => SiteScoped.parse(d))
  .handler(async ({ data, context }) => {
    const c = await getCreds(context, data.website_id);
    if (!c.wc_consumer_key || !c.wc_consumer_secret) return { ok: false as const, error: "WooCommerce keys missing", customers: [] };
    try {
      const res = await fetch(`${c.url.replace(/\/$/, "")}/wp-json/wc/v3/customers?per_page=50`, {
        headers: { Authorization: wcAuthHeader(c) },
      });
      if (!res.ok) return { ok: false as const, error: `HTTP ${res.status}`, customers: [] };
      return {
        ok: true as const,
        customers: (await res.json()) as Array<{
          id: number; email: string; first_name: string; last_name: string;
          username: string; orders_count?: number; total_spent?: string; date_created: string;
        }>,
      };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Network error", customers: [] };
    }
  });
