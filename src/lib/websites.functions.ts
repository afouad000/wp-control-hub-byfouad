import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAuthenticatedContext, friendlyDbError, requirePermission, type Permission } from "./server-guards";

const PUBLIC_COLUMNS =
  "id, owner_id, name, url, client_name, logo_url, status, connection_status, last_checked_at, last_error, meta, created_at, updated_at";

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

const UpdateInput = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  client_name: z.string().trim().max(120).optional().nullable(),
  logo_url: z.string().trim().url().max(2048).optional().nullable(),
});

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
    assertAuthenticatedContext(context);

    const probe = await probeSite(data.url, data.wp_username, data.wp_app_password, data.wc_consumer_key, data.wc_consumer_secret);
    if (!probe.ok) {
      throw new Error(probe.error ?? "Connection test failed — credentials not saved.");
    }

    const startedAt = new Date().toISOString();
    const { data: inserted, error } = await context.supabase
      .from("websites")
      .insert({
        owner_id: context.userId,
        name: data.name,
        url: data.url.replace(/\/$/, ""),
        client_name: data.client_name ?? null,
        logo_url: data.logo_url ?? null,
        status: "connected",
        connection_status: probe.info.woocommerce ? "connected" : "connected_no_wc",
        last_checked_at: startedAt,
        last_error: null,
        meta: probe.info,
      })
      .select(PUBLIC_COLUMNS)
      .single();

    if (error) {
      console.error("[connectWebsite] insert failed", {
        userId: context.userId,
        code: (error as { code?: string }).code,
        message: error.message,
        hint: (error as { hint?: string }).hint,
      });
      throw new Error(friendlyDbError(error, "Could not save the website. Please try again."));
    }

    // Persist credentials to private schema via service role RPC
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: credErr } = await supabaseAdmin.rpc("set_website_credentials_admin", {
      _website_id: inserted.id,
      _wp_username: data.wp_username,
      _wp_app_password: data.wp_app_password,
      _wc_consumer_key: data.wc_consumer_key ?? "",
      _wc_consumer_secret: data.wc_consumer_secret ?? "",
    });
    if (credErr) {
      console.error("[connectWebsite] credentials insert failed", { websiteId: inserted.id, message: credErr.message });
      throw new Error("Saved the website but could not store credentials securely. Please retry.");
    }

    const memberStartedAt = new Date().toISOString();
    const fullPerms = {
      view_dashboard: true, view_orders: true, edit_orders: true,
      view_products: true, edit_products: true,
      view_customers: true, edit_customers: true,
      view_coupons: true, manage_coupons: true,
      view_reports: true, manage_website_settings: true,
      manage_team: true, view_activity_logs: true,
    };
    const { error: memberError } = await context.supabase.from("website_members").insert({
      website_id: inserted.id,
      user_id: context.userId,
      permission: "owner",
      role: "owner",
      permissions: fullPerms,
      invitation_status: "accepted",
      accepted_at: memberStartedAt,
    });
    let alreadyExisted = false;
    if (memberError) {
      if (/duplicate|unique/i.test(memberError.message)) {
        alreadyExisted = true;
      } else {
        console.error("[connectWebsite] member insert failed", {
          websiteId: inserted.id,
          userId: context.userId,
          code: (memberError as { code?: string }).code,
          message: memberError.message,
        });
        throw new Error(friendlyDbError(memberError, "Saved the website but could not register ownership. Please retry."));
      }
    }

    await context.supabase.from("audit_logs").insert([
      {
        user_id: context.userId,
        website_id: inserted.id,
        action: "website.connected",
        details: {
          url: inserted.url,
          name: inserted.name,
          woocommerce: probe.info.woocommerce ?? false,
          theme: probe.info.theme ?? null,
          plugins_count: probe.info.plugins_count ?? null,
          started_at: startedAt,
          completed_at: new Date().toISOString(),
        },
      },
      {
        user_id: context.userId,
        website_id: inserted.id,
        action: "website.member_added",
        details: {
          member_user_id: context.userId,
          permission: "owner",
          auto_created: true,
          already_existed: alreadyExisted,
          started_at: memberStartedAt,
          completed_at: new Date().toISOString(),
        },
      },
    ]);

    return { website: inserted, probe };
  });

export const reconnectWebsite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ReconnectInput.parse(d))
  .handler(async ({ data, context }) => {
    const probe = await probeSite(data.url, data.wp_username, data.wp_app_password, data.wc_consumer_key, data.wc_consumer_secret);
    if (!probe.ok) {
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
    // First verify access via user-scoped client (RLS will block if not owner/no access)
    const { data: accessCheck, error: accessErr } = await context.supabase
      .from("websites")
      .select("id, owner_id")
      .eq("id", data.id)
      .maybeSingle();
    if (accessErr) throw new Error(accessErr.message);
    if (!accessCheck) throw new Error("Website not found or access denied.");

    // Update non-sensitive fields on public.websites
    const { error } = await context.supabase
      .from("websites")
      .update({
        url: data.url.replace(/\/$/, ""),
        status: "connected",
        connection_status: probe.info.woocommerce ? "connected" : "connected_no_wc",
        last_checked_at: new Date().toISOString(),
        last_error: null,
        meta: probe.info,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    // Update credentials in the private schema via service role
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: credErr } = await supabaseAdmin.rpc("set_website_credentials_admin", {
      _website_id: data.id,
      _wp_username: data.wp_username,
      _wp_app_password: data.wp_app_password,
      _wc_consumer_key: data.wc_consumer_key ?? "",
      _wc_consumer_secret: data.wc_consumer_secret ?? "",
    });
    if (credErr) throw new Error("Could not update credentials securely.");
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
    const c = await getCreds(context, data.id, "manage_website_settings");
    const probe = await probeSite(c.url, c.wp_username ?? "", c.wp_app_password ?? "", c.wc_consumer_key, c.wc_consumer_secret);
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

const AuditLogsInput = z.object({
  website_id: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(500).default(200),
}).optional();

export const listAuditLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => AuditLogsInput.parse(d) ?? { limit: 200 })
  .handler(async ({ data, context }) => {
    // If scoped to a website, require view_activity_logs. Otherwise RLS on
    // audit_logs will already filter to sites the user can see.
    if (data?.website_id) {
      await requirePermission(context, data.website_id, "view_activity_logs");
    }
    let q = context.supabase
      .from("audit_logs")
      .select("id, action, details, website_id, user_id, entity_type, entity_id, old_value, new_value, status, created_at")
      .order("created_at", { ascending: false })
      .limit(data?.limit ?? 200);
    if (data?.website_id) q = q.eq("website_id", data.website_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
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

// ---------- Live content APIs ----------
// Credentials are read with the admin client AFTER verifying the user has
// access to the website via the user-scoped client (RLS enforced). Column
// SELECT on the credential columns is revoked from `authenticated`, so the
// admin path is the only way to retrieve them server-side.

const SiteScoped = z.object({ website_id: z.string().uuid() });

type Creds = {
  url: string;
  wp_username: string | null;
  wp_app_password: string | null;
  wc_consumer_key: string | null;
  wc_consumer_secret: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getCreds(context: any, websiteId: string, permission: Permission): Promise<Creds> {
  // 1) Verify access + specific module permission via SECURITY DEFINER RPC.
  await requirePermission(context, websiteId, permission);

  // 2) Read raw credentials via service-role RPC against the private schema.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: rows, error: e2 } = await supabaseAdmin.rpc("get_website_credentials_admin", {
    _website_id: websiteId,
  });
  if (e2) throw new Error(e2.message);
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) throw new Error("Credentials unavailable.");
  return row as Creds;
}

const wpAuthHeader = (c: Creds) =>
  "Basic " + btoa(`${c.wp_username ?? ""}:${c.wp_app_password ?? ""}`);
const wcAuthHeader = (c: Creds) =>
  "Basic " + btoa(`${c.wc_consumer_key ?? ""}:${c.wc_consumer_secret ?? ""}`);

function parsePaging(res: Response, perPage: number, page: number) {
  const total = parseInt(res.headers.get("x-wp-total") ?? "0", 10) || 0;
  const totalPages = parseInt(res.headers.get("x-wp-totalpages") ?? "0", 10) || 0;
  return { total, totalPages, page, perPage };
}

export const fetchPosts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => SiteScoped.parse(d))
  .handler(async ({ data, context }) => {
    const c = await getCreds(context, data.website_id, "view_dashboard");
    try {
      const res = await fetch(`${c.url.replace(/\/$/, "")}/wp-json/wp/v2/posts?per_page=20&_embed`, {
        headers: { Authorization: wpAuthHeader(c) },
      });
      if (!res.ok) return { ok: false as const, error: `HTTP ${res.status}`, posts: [] };
      return { ok: true as const, posts: (await res.json()) as Array<{ id: number; title: { rendered: string }; status: string; date: string; link: string }> };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Network error", posts: [] };
    }
  });

// ---------------- Products ----------------

const ProductsInput = z.object({
  website_id: z.string().uuid(),
  page: z.number().int().positive().default(1),
  per_page: z.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  stock_status: z.enum(["instock", "outofstock", "onbackorder"]).optional(),
  status: z.enum(["any", "publish", "draft", "pending", "private"]).optional(),
});

type WCProduct = {
  id: number; name: string; type: string; status: string;
  price: string; regular_price: string; sale_price: string;
  stock_status: string; stock_quantity: number | null; sku: string;
  images: Array<{ id?: number; src: string }>;
  short_description?: string; description?: string;
  categories?: Array<{ id: number; name: string }>;
  tags?: Array<{ id: number; name: string }>;
  variations?: number[];
};

export const fetchProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ProductsInput.parse(d))
  .handler(async ({ data, context }) => {
    const c = await getCreds(context, data.website_id, "view_products");
    if (!c.wc_consumer_key || !c.wc_consumer_secret) {
      return { ok: false as const, error: "WooCommerce keys missing", products: [] as WCProduct[], paging: { total: 0, totalPages: 0, page: 1, perPage: data.per_page } };
    }
    try {
      const params = new URLSearchParams({
        page: String(data.page),
        per_page: String(data.per_page),
      });
      if (data.search) params.set("search", data.search);
      if (data.stock_status) params.set("stock_status", data.stock_status);
      if (data.status && data.status !== "any") params.set("status", data.status);

      const res = await fetch(`${c.url.replace(/\/$/, "")}/wp-json/wc/v3/products?${params}`, {
        headers: { Authorization: wcAuthHeader(c) },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false as const, error: `HTTP ${res.status} ${text.slice(0, 160)}`, products: [] as WCProduct[], paging: { total: 0, totalPages: 0, page: data.page, perPage: data.per_page } };
      }
      return {
        ok: true as const,
        products: (await res.json()) as WCProduct[],
        paging: parsePaging(res, data.per_page, data.page),
      };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Network error", products: [] as WCProduct[], paging: { total: 0, totalPages: 0, page: data.page, perPage: data.per_page } };
    }
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
    const c = await getCreds(context, data.website_id, "edit_products");
    if (!c.wc_consumer_key || !c.wc_consumer_secret) throw new Error("WooCommerce keys missing");
    const { website_id, product_id, ...patch } = data;
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

// ---------- Variable products ----------

const VariationsInput = z.object({
  website_id: z.string().uuid(),
  product_id: z.number().int().positive(),
  page: z.number().int().positive().default(1),
  per_page: z.number().int().min(1).max(100).default(50),
});

type WCVariation = {
  id: number;
  sku: string;
  price: string;
  regular_price: string;
  sale_price: string;
  stock_status: string;
  stock_quantity: number | null;
  attributes: Array<{ id: number; name: string; option: string }>;
  image?: { src: string } | null;
};

export const fetchVariations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => VariationsInput.parse(d))
  .handler(async ({ data, context }) => {
    const c = await getCreds(context, data.website_id, "view_products");
    if (!c.wc_consumer_key || !c.wc_consumer_secret) {
      return { ok: false as const, error: "WooCommerce keys missing", variations: [] as WCVariation[], paging: { total: 0, totalPages: 0, page: 1, perPage: data.per_page } };
    }
    try {
      const params = new URLSearchParams({ page: String(data.page), per_page: String(data.per_page) });
      const res = await fetch(
        `${c.url.replace(/\/$/, "")}/wp-json/wc/v3/products/${data.product_id}/variations?${params}`,
        { headers: { Authorization: wcAuthHeader(c) } },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false as const, error: `HTTP ${res.status} ${text.slice(0, 160)}`, variations: [] as WCVariation[], paging: { total: 0, totalPages: 0, page: data.page, perPage: data.per_page } };
      }
      return {
        ok: true as const,
        variations: (await res.json()) as WCVariation[],
        paging: parsePaging(res, data.per_page, data.page),
      };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Network error", variations: [] as WCVariation[], paging: { total: 0, totalPages: 0, page: data.page, perPage: data.per_page } };
    }
  });

const UpdateVariationInput = z.object({
  website_id: z.string().uuid(),
  product_id: z.number().int().positive(),
  variation_id: z.number().int().positive(),
  regular_price: z.string().optional(),
  sale_price: z.string().optional(),
  stock_quantity: z.number().int().optional().nullable(),
  stock_status: z.enum(["instock", "outofstock", "onbackorder"]).optional(),
  sku: z.string().optional(),
});

export const updateVariation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => UpdateVariationInput.parse(d))
  .handler(async ({ data, context }) => {
    const c = await getCreds(context, data.website_id, "edit_products");
    if (!c.wc_consumer_key || !c.wc_consumer_secret) throw new Error("WooCommerce keys missing");
    const { website_id, product_id, variation_id, ...patch } = data;
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) body[k] = v;
    if (body.stock_quantity !== undefined && body.stock_quantity !== null) {
      body.manage_stock = true;
    }
    const res = await fetch(
      `${c.url.replace(/\/$/, "")}/wp-json/wc/v3/products/${product_id}/variations/${variation_id}`,
      {
        method: "PUT",
        headers: { Authorization: wcAuthHeader(c), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Failed to update variation: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    await context.supabase.from("audit_logs").insert({
      user_id: context.userId,
      website_id,
      action: "product.variation_updated",
      details: { product_id, variation_id, fields: Object.keys(body) },
    });
    return { ok: true };
  });

// ---------------- Orders ----------------

const OrdersInput = z.object({
  website_id: z.string().uuid(),
  page: z.number().int().positive().default(1),
  per_page: z.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  status: z.string().trim().max(40).optional(),
  after: z.string().datetime().optional(),
  before: z.string().datetime().optional(),
});

type WCOrder = {
  id: number; number: string; status: string; total: string; currency: string;
  date_created: string;
  billing: { first_name: string; last_name: string; email: string; phone?: string };
};

export const fetchOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => OrdersInput.parse(d))
  .handler(async ({ data, context }) => {
    const c = await getCreds(context, data.website_id, "view_orders");
    if (!c.wc_consumer_key || !c.wc_consumer_secret) {
      return { ok: false as const, error: "WooCommerce keys missing", orders: [] as WCOrder[], paging: { total: 0, totalPages: 0, page: 1, perPage: data.per_page } };
    }
    try {
      const params = new URLSearchParams({
        page: String(data.page),
        per_page: String(data.per_page),
      });
      if (data.search) params.set("search", data.search);
      if (data.status && data.status !== "all") params.set("status", data.status);
      if (data.after) params.set("after", data.after);
      if (data.before) params.set("before", data.before);

      const res = await fetch(`${c.url.replace(/\/$/, "")}/wp-json/wc/v3/orders?${params}`, {
        headers: { Authorization: wcAuthHeader(c) },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false as const, error: `HTTP ${res.status} ${text.slice(0, 160)}`, orders: [] as WCOrder[], paging: { total: 0, totalPages: 0, page: data.page, perPage: data.per_page } };
      }
      return {
        ok: true as const,
        orders: (await res.json()) as WCOrder[],
        paging: parsePaging(res, data.per_page, data.page),
      };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Network error", orders: [] as WCOrder[], paging: { total: 0, totalPages: 0, page: data.page, perPage: data.per_page } };
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
    const c = await getCreds(context, data.website_id, "edit_orders");
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

// ---------------- Customers ----------------

const CustomersInput = z.object({
  website_id: z.string().uuid(),
  page: z.number().int().positive().default(1),
  per_page: z.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
});

type WCCustomer = {
  id: number; email: string; first_name: string; last_name: string;
  username: string; orders_count?: number; total_spent?: string; date_created: string;
  billing?: { address_1?: string; city?: string; country?: string; phone?: string };
};

export const fetchCustomers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => CustomersInput.parse(d))
  .handler(async ({ data, context }) => {
    const c = await getCreds(context, data.website_id, "view_customers");
    if (!c.wc_consumer_key || !c.wc_consumer_secret) {
      return { ok: false as const, error: "WooCommerce keys missing", customers: [] as WCCustomer[], paging: { total: 0, totalPages: 0, page: 1, perPage: data.per_page } };
    }
    try {
      const params = new URLSearchParams({
        page: String(data.page),
        per_page: String(data.per_page),
      });
      if (data.search) params.set("search", data.search);
      const res = await fetch(`${c.url.replace(/\/$/, "")}/wp-json/wc/v3/customers?${params}`, {
        headers: { Authorization: wcAuthHeader(c) },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false as const, error: `HTTP ${res.status} ${text.slice(0, 160)}`, customers: [] as WCCustomer[], paging: { total: 0, totalPages: 0, page: data.page, perPage: data.per_page } };
      }
      return {
        ok: true as const,
        customers: (await res.json()) as WCCustomer[],
        paging: parsePaging(res, data.per_page, data.page),
      };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Network error", customers: [] as WCCustomer[], paging: { total: 0, totalPages: 0, page: data.page, perPage: data.per_page } };
    }
  });

// ---------------- Order detail / notes / refund ----------------

const OrderIdInput = z.object({ website_id: z.string().uuid(), order_id: z.number().int().positive() });

export const fetchOrder = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => OrderIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const c = await getCreds(context, data.website_id, "view_orders");
    if (!c.wc_consumer_key || !c.wc_consumer_secret) return { ok: false as const, error: "WooCommerce keys missing" };
    try {
      const [orderRes, notesRes] = await Promise.all([
        fetch(`${c.url.replace(/\/$/, "")}/wp-json/wc/v3/orders/${data.order_id}`, { headers: { Authorization: wcAuthHeader(c) } }),
        fetch(`${c.url.replace(/\/$/, "")}/wp-json/wc/v3/orders/${data.order_id}/notes`, { headers: { Authorization: wcAuthHeader(c) } }),
      ]);
      if (!orderRes.ok) return { ok: false as const, error: `HTTP ${orderRes.status}` };
      const order = await orderRes.json();
      const notes = notesRes.ok ? await notesRes.json() : [];
      return { ok: true as const, order, notes };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Network error" };
    }
  });

const AddNoteInput = OrderIdInput.extend({
  note: z.string().trim().min(1).max(2000),
  customer_note: z.boolean().default(false),
});

export const addOrderNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => AddNoteInput.parse(d))
  .handler(async ({ data, context }) => {
    const c = await getCreds(context, data.website_id, "edit_orders");
    if (!c.wc_consumer_key || !c.wc_consumer_secret) throw new Error("WooCommerce keys missing");
    const res = await fetch(`${c.url.replace(/\/$/, "")}/wp-json/wc/v3/orders/${data.order_id}/notes`, {
      method: "POST",
      headers: { Authorization: wcAuthHeader(c), "Content-Type": "application/json" },
      body: JSON.stringify({ note: data.note, customer_note: data.customer_note }),
    });
    if (!res.ok) throw new Error(`Failed to add note: HTTP ${res.status}`);
    await context.supabase.from("audit_logs").insert({
      user_id: context.userId, website_id: data.website_id,
      action: "order.note_added", details: { order_id: data.order_id, customer_note: data.customer_note },
    });
    return { ok: true };
  });

const RefundInput = OrderIdInput.extend({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  reason: z.string().trim().max(500).optional(),
});

export const refundOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => RefundInput.parse(d))
  .handler(async ({ data, context }) => {
    const c = await getCreds(context, data.website_id, "edit_orders");
    if (!c.wc_consumer_key || !c.wc_consumer_secret) throw new Error("WooCommerce keys missing");
    const res = await fetch(`${c.url.replace(/\/$/, "")}/wp-json/wc/v3/orders/${data.order_id}/refunds`, {
      method: "POST",
      headers: { Authorization: wcAuthHeader(c), "Content-Type": "application/json" },
      body: JSON.stringify({ amount: data.amount, reason: data.reason ?? "" }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Refund failed: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    await context.supabase.from("audit_logs").insert({
      user_id: context.userId, website_id: data.website_id,
      action: "order.refunded", details: { order_id: data.order_id, amount: data.amount },
    });
    return { ok: true };
  });

// ---------------- Product create / delete / bulk ----------------

const CreateProductInput = z.object({
  website_id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  type: z.enum(["simple", "variable", "grouped", "external"]).default("simple"),
  regular_price: z.string().optional(),
  sale_price: z.string().optional(),
  sku: z.string().optional(),
  description: z.string().max(20000).optional(),
  short_description: z.string().max(5000).optional(),
  status: z.enum(["publish", "draft", "pending", "private"]).default("draft"),
  stock_quantity: z.number().int().optional().nullable(),
  stock_status: z.enum(["instock", "outofstock", "onbackorder"]).optional(),
});

export const createProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => CreateProductInput.parse(d))
  .handler(async ({ data, context }) => {
    const c = await getCreds(context, data.website_id, "edit_products");
    if (!c.wc_consumer_key || !c.wc_consumer_secret) throw new Error("WooCommerce keys missing");
    const { website_id, ...rest } = data;
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== "") body[k] = v;
    if (body.stock_quantity !== undefined && body.stock_quantity !== null) body.manage_stock = true;
    const res = await fetch(`${c.url.replace(/\/$/, "")}/wp-json/wc/v3/products`, {
      method: "POST",
      headers: { Authorization: wcAuthHeader(c), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Failed to create product: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    const created = await res.json();
    await context.supabase.from("audit_logs").insert({
      user_id: context.userId, website_id,
      action: "product.created", details: { product_id: created.id, name: created.name },
    });
    return { ok: true, product: created };
  });

const DeleteProductInput = z.object({
  website_id: z.string().uuid(),
  product_id: z.number().int().positive(),
  force: z.boolean().default(false),
});

export const deleteProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => DeleteProductInput.parse(d))
  .handler(async ({ data, context }) => {
    const c = await getCreds(context, data.website_id, "edit_products");
    if (!c.wc_consumer_key || !c.wc_consumer_secret) throw new Error("WooCommerce keys missing");
    const res = await fetch(
      `${c.url.replace(/\/$/, "")}/wp-json/wc/v3/products/${data.product_id}?force=${data.force ? "true" : "false"}`,
      { method: "DELETE", headers: { Authorization: wcAuthHeader(c) } },
    );
    if (!res.ok) throw new Error(`Failed to delete product: HTTP ${res.status}`);
    await context.supabase.from("audit_logs").insert({
      user_id: context.userId, website_id: data.website_id,
      action: "product.deleted", details: { product_id: data.product_id, force: data.force },
    });
    return { ok: true };
  });

// ---------------- Coupons ----------------

const CouponsListInput = z.object({
  website_id: z.string().uuid(),
  page: z.number().int().positive().default(1),
  per_page: z.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
});

type WCCoupon = {
  id: number; code: string; amount: string; discount_type: string;
  date_expires: string | null; usage_count: number; usage_limit: number | null;
  description: string; free_shipping: boolean;
};

export const fetchCoupons = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => CouponsListInput.parse(d))
  .handler(async ({ data, context }) => {
    const c = await getCreds(context, data.website_id, "view_coupons");
    if (!c.wc_consumer_key || !c.wc_consumer_secret) {
      return { ok: false as const, error: "WooCommerce keys missing", coupons: [] as WCCoupon[], paging: { total: 0, totalPages: 0, page: 1, perPage: data.per_page } };
    }
    try {
      const params = new URLSearchParams({ page: String(data.page), per_page: String(data.per_page) });
      if (data.search) params.set("search", data.search);
      const res = await fetch(`${c.url.replace(/\/$/, "")}/wp-json/wc/v3/coupons?${params}`, { headers: { Authorization: wcAuthHeader(c) } });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false as const, error: `HTTP ${res.status} ${text.slice(0, 160)}`, coupons: [] as WCCoupon[], paging: { total: 0, totalPages: 0, page: data.page, perPage: data.per_page } };
      }
      return { ok: true as const, coupons: (await res.json()) as WCCoupon[], paging: parsePaging(res, data.per_page, data.page) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Network error", coupons: [] as WCCoupon[], paging: { total: 0, totalPages: 0, page: data.page, perPage: data.per_page } };
    }
  });

const CouponInput = z.object({
  website_id: z.string().uuid(),
  id: z.number().int().positive().optional(),
  code: z.string().trim().min(1).max(80),
  discount_type: z.enum(["percent", "fixed_cart", "fixed_product"]).default("percent"),
  amount: z.string(),
  description: z.string().max(500).optional(),
  date_expires: z.string().optional().nullable(),
  usage_limit: z.number().int().positive().optional().nullable(),
  free_shipping: z.boolean().optional(),
  individual_use: z.boolean().optional(),
});

export const saveCoupon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => CouponInput.parse(d))
  .handler(async ({ data, context }) => {
    const c = await getCreds(context, data.website_id, "manage_coupons");
    if (!c.wc_consumer_key || !c.wc_consumer_secret) throw new Error("WooCommerce keys missing");
    const { website_id, id, ...rest } = data;
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== "") body[k] = v;
    const url = id
      ? `${c.url.replace(/\/$/, "")}/wp-json/wc/v3/coupons/${id}`
      : `${c.url.replace(/\/$/, "")}/wp-json/wc/v3/coupons`;
    const res = await fetch(url, {
      method: id ? "PUT" : "POST",
      headers: { Authorization: wcAuthHeader(c), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Coupon save failed: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    const saved = await res.json();
    await context.supabase.from("audit_logs").insert({
      user_id: context.userId, website_id,
      action: id ? "coupon.updated" : "coupon.created",
      details: { coupon_id: saved.id, code: saved.code },
    });
    return { ok: true, coupon: saved };
  });

const DeleteCouponInput = z.object({ website_id: z.string().uuid(), id: z.number().int().positive() });

export const deleteCoupon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => DeleteCouponInput.parse(d))
  .handler(async ({ data, context }) => {
    const c = await getCreds(context, data.website_id, "manage_coupons");
    if (!c.wc_consumer_key || !c.wc_consumer_secret) throw new Error("WooCommerce keys missing");
    const res = await fetch(
      `${c.url.replace(/\/$/, "")}/wp-json/wc/v3/coupons/${data.id}?force=true`,
      { method: "DELETE", headers: { Authorization: wcAuthHeader(c) } },
    );
    if (!res.ok) throw new Error(`Failed to delete coupon: HTTP ${res.status}`);
    await context.supabase.from("audit_logs").insert({
      user_id: context.userId, website_id: data.website_id,
      action: "coupon.deleted", details: { coupon_id: data.id },
    });
    return { ok: true };
  });

// ---------------- Team / website members ----------------
// Owners can list, invite (by email lookup), update, and remove members.
// Email lookup uses the admin client (gated by ownership check in getCreds-style).

const WebsiteIdInput = z.object({ website_id: z.string().uuid() });

const DEFAULT_PERMS: Record<string, boolean> = {
  view_dashboard: true,
  view_orders: false, edit_orders: false,
  view_products: false, edit_products: false,
  view_customers: false, edit_customers: false,
  view_coupons: false, manage_coupons: false,
  view_reports: false,
  manage_website_settings: false,
  manage_team: false,
  view_activity_logs: false,
};

const ROLE_PRESETS: Record<string, Record<string, boolean>> = {
  owner: Object.fromEntries(Object.keys(DEFAULT_PERMS).map((k) => [k, true])),
  admin: { ...DEFAULT_PERMS, view_orders: true, edit_orders: true, view_products: true, edit_products: true, view_customers: true, edit_customers: true, view_coupons: true, manage_coupons: true, view_reports: true, view_activity_logs: true, manage_website_settings: true },
  editor: { ...DEFAULT_PERMS, view_orders: true, edit_orders: true, view_products: true, edit_products: true, view_coupons: true, manage_coupons: true, view_customers: true },
  viewer: { ...DEFAULT_PERMS, view_orders: true, view_products: true, view_customers: true, view_coupons: true, view_reports: true },
};

type MemberRow = {
  id: string; user_id: string; permission: string; role: string | null;
  permissions: Record<string, boolean> | null;
  invitation_status: string | null;
  created_at: string;
  email: string | null; full_name: string | null;
};

export const listMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => WebsiteIdInput.parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; members: MemberRow[] } | { ok: false; error: string }> => {
    const { data: site, error: sErr } = await context.supabase.from("websites").select("id").eq("id", data.website_id).maybeSingle();
    if (sErr) return { ok: false, error: sErr.message };
    if (!site) return { ok: false, error: "Not found or access denied" };

    const { data: members, error } = await context.supabase
      .from("website_members")
      .select("id, user_id, permission, role, permissions, invitation_status, created_at")
      .eq("website_id", data.website_id)
      .order("created_at", { ascending: true });
    if (error) return { ok: false, error: error.message };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ids = (members ?? []).map((m) => m.user_id);
    const { data: profs } = ids.length
      ? await supabaseAdmin.from("profiles").select("id, email, full_name").in("id", ids)
      : { data: [] as Array<{ id: string; email: string | null; full_name: string | null }> };
    const map = new Map((profs ?? []).map((p) => [p.id, p]));
    return {
      ok: true,
      members: (members ?? []).map((m) => ({
        ...(m as MemberRow),
        email: map.get(m.user_id)?.email ?? null,
        full_name: map.get(m.user_id)?.full_name ?? null,
      })),
    };
  });

const InviteInput = z.object({
  website_id: z.string().uuid(),
  email: z.string().trim().email().max(320),
  role: z.enum(["admin", "editor", "viewer"]).default("viewer"),
});

export const inviteMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => InviteInput.parse(d))
  .handler(async ({ data, context }) => {
    await requirePermission(context, data.website_id, "manage_team");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prof, error } = await supabaseAdmin.from("profiles").select("id, email").eq("email", data.email.toLowerCase()).maybeSingle();
    if (error) throw new Error(error.message);
    if (!prof) throw new Error("No registered user with that email yet. Ask them to sign up first.");

    const perms = ROLE_PRESETS[data.role] ?? ROLE_PRESETS.viewer;
    const legacyPermission = data.role === "admin" ? "edit" : data.role === "editor" ? "edit" : "view";
    const { error: insErr } = await context.supabase.from("website_members").insert({
      website_id: data.website_id, user_id: prof.id,
      permission: legacyPermission, role: data.role,
      permissions: perms, invitation_status: "accepted",
      accepted_at: new Date().toISOString(),
    });
    if (insErr) {
      if (/duplicate|unique/i.test(insErr.message)) throw new Error("This user is already a member.");
      throw new Error(friendlyDbError(insErr, "Could not add member."));
    }
    await context.supabase.from("audit_logs").insert({
      user_id: context.userId, website_id: data.website_id,
      action: "website.member_added",
      entity_type: "member", entity_id: prof.id,
      new_value: { role: data.role, permissions: perms, email: data.email },
    });
    return { ok: true };
  });

const MemberUpdate = z.object({
  website_id: z.string().uuid(),
  member_id: z.string().uuid(),
  role: z.enum(["admin", "editor", "viewer", "owner"]).optional(),
  permissions: z.record(z.string(), z.boolean()).optional(),
});

export const updateMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => MemberUpdate.parse(d))
  .handler(async ({ data, context }) => {
    await requirePermission(context, data.website_id, "manage_team");

    const patch: Record<string, unknown> = {};
    if (data.role) {
      patch.role = data.role;
      patch.permission = data.role === "viewer" ? "view" : data.role === "owner" ? "owner" : "edit";
      if (!data.permissions) patch.permissions = ROLE_PRESETS[data.role] ?? ROLE_PRESETS.viewer;
    }
    if (data.permissions) patch.permissions = data.permissions;

    const { data: before } = await context.supabase
      .from("website_members").select("role, permissions")
      .eq("id", data.member_id).eq("website_id", data.website_id).maybeSingle();

    const { error } = await context.supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("website_members").update(patch as any)
      .eq("id", data.member_id).eq("website_id", data.website_id);
    if (error) throw new Error(friendlyDbError(error, "Could not update member."));

    await context.supabase.from("audit_logs").insert({
      user_id: context.userId, website_id: data.website_id,
      action: "website.member_updated",
      entity_type: "member", entity_id: data.member_id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      old_value: (before ?? null) as any, new_value: patch as any,
    });
    return { ok: true };
  });

const MemberRemove = z.object({ website_id: z.string().uuid(), member_id: z.string().uuid() });

export const removeMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => MemberRemove.parse(d))
  .handler(async ({ data, context }) => {
    await requirePermission(context, data.website_id, "manage_team");
    const { data: before } = await context.supabase
      .from("website_members").select("user_id, role, permissions")
      .eq("id", data.member_id).eq("website_id", data.website_id).maybeSingle();
    if (before && (before as { role?: string }).role === "owner") {
      throw new Error("The owner cannot be removed.");
    }
    const { error } = await context.supabase
      .from("website_members").delete()
      .eq("id", data.member_id).eq("website_id", data.website_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_logs").insert({
      user_id: context.userId, website_id: data.website_id,
      action: "website.member_removed",
      entity_type: "member", entity_id: data.member_id,
      old_value: before ?? null,
    });
    return { ok: true };
  });
