import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAuthenticatedContext, type Permission } from "./server-guards";

export type PermissionMap = Partial<Record<Permission, boolean>> & { is_owner?: boolean };

export type PermissionSummary = {
  aggregated: PermissionMap;
  perWebsite: Record<string, PermissionMap>;
  isSuperAdmin: boolean;
  websiteCount: number;
};

const ALL_TRUE: PermissionMap = {
  view_dashboard: true, view_orders: true, edit_orders: true,
  view_products: true, edit_products: true,
  view_customers: true, edit_customers: true,
  view_coupons: true, manage_coupons: true,
  view_reports: true, manage_website_settings: true,
  manage_team: true, view_activity_logs: true,
  is_owner: true,
};

/**
 * Returns the current user's permissions across every website they can access,
 * plus an "aggregated" union (used to gate sidebar items and route access when
 * a check is not scoped to a single website).
 */
export const getMyPermissionSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .handler(async ({ context }): Promise<PermissionSummary> => {
    assertAuthenticatedContext(context);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = context.supabase as any;

    // Super-admin bypass — full permissions everywhere.
    const { data: superAdmin } = await supabase.rpc("is_super_admin", { _user_id: context.userId });
    if (superAdmin === true) {
      return { aggregated: { ...ALL_TRUE }, perWebsite: {}, isSuperAdmin: true, websiteCount: 0 };
    }

    const { data: sites, error } = await supabase.from("websites").select("id");
    if (error) throw new Error(error.message);
    const ids: string[] = (sites ?? []).map((s: { id: string }) => s.id);

    const perWebsite: Record<string, PermissionMap> = {};
    const aggregated: PermissionMap = {};

    await Promise.all(
      ids.map(async (id) => {
        const { data, error: rpcErr } = await supabase.rpc("list_my_website_permissions", {
          _website_id: id,
        });
        if (rpcErr) return;
        const perms = (data ?? {}) as PermissionMap;
        perWebsite[id] = perms;
        for (const [k, v] of Object.entries(perms)) {
          if (v === true) aggregated[k as Permission] = true;
        }
      }),
    );

    return { aggregated, perWebsite, isSuperAdmin: false, websiteCount: ids.length };
  });
