/**
 * Server-only safety helpers for createServerFn handlers.
 *
 * Intentionally tiny and dependency-free so it can be imported from any
 * `*.functions.ts` module without dragging server-only modules into the
 * client bundle. The functions here ONLY inspect the context shape that
 * `requireSupabaseAuth` produces — they never read env vars at module
 * scope and never import the service-role client.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MaybeAuthContext = {
  userId?: string | null;
  supabase?: unknown;
  claims?: { sub?: string; role?: string } | null;
};

/**
 * Throw a generic Unauthorized error if the request was not authenticated.
 * `requireSupabaseAuth` already validates the bearer token, but a defensive
 * check here protects against accidental removal of the middleware and makes
 * the invariant `auth.uid() IS NOT NULL` explicit at every insert site.
 */
export function assertAuthenticatedContext(
  context: MaybeAuthContext,
): asserts context is { userId: string; supabase: unknown; claims: { sub: string; role?: string } } {
  const uid = context?.userId;
  const sub = context?.claims?.sub;
  if (!uid || !sub || uid !== sub || !UUID_RE.test(uid)) {
    throw new Error("Unauthorized: missing or invalid user session.");
  }
  // Reject elevated tokens. Server functions must run as the signed-in user
  // so that RLS applies. Service-role JWTs would silently bypass policies.
  const role = context.claims?.role;
  if (role && role !== "authenticated") {
    throw new Error("Forbidden: server functions must run as an authenticated user, not a service role.");
  }
  if (!context.supabase) {
    throw new Error("Server misconfiguration: Supabase client missing from context.");
  }
}

/**
 * Map a Postgres / PostgREST error into a short user-safe message.
 * Strips SQL details, table names, and policy names from what reaches the UI.
 * The full error is still logged server-side (without credentials) for ops.
 */
export function friendlyDbError(err: { code?: string; message?: string } | null | undefined, fallback = "Something went wrong saving your data."): string {
  if (!err) return fallback;
  const code = err.code ?? "";
  const msg = (err.message ?? "").toLowerCase();
  if (code === "42501" || msg.includes("row-level security") || msg.includes("permission denied")) {
    return "You don't have permission to perform this action. Please sign out and back in, then try again.";
  }
  if (code === "23505" || msg.includes("duplicate key") || msg.includes("unique constraint")) {
    return "A record with these details already exists.";
  }
  if (code === "23503" || msg.includes("foreign key")) {
    return "Linked record could not be found.";
  }
  if (code === "23502" || msg.includes("null value")) {
    return "A required field was missing.";
  }
  if (msg.includes("jwt") || msg.includes("unauthorized")) {
    return "Your session expired. Please sign in again.";
  }
  return fallback;
}

export type Permission =
  | "view_dashboard"
  | "view_orders" | "edit_orders"
  | "view_products" | "edit_products"
  | "view_customers" | "edit_customers"
  | "view_coupons" | "manage_coupons"
  | "view_reports"
  | "manage_website_settings"
  | "manage_team"
  | "view_activity_logs";

/**
 * Throws if the current user does not have the given permission on the website.
 * Uses the SECURITY DEFINER `public.user_can_website` wrapper via the
 * user-scoped Supabase client (so auth.uid() is the calling user).
 */
export async function requirePermission(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: any,
  websiteId: string,
  permission: Permission,
): Promise<void> {
  assertAuthenticatedContext(context);
  const { data, error } = await context.supabase.rpc("user_can_website", {
    _website_id: websiteId,
    _permission: permission,
  });
  if (error) throw new Error(error.message);
  if (data !== true) {
    throw new Error(`You don't have permission to ${permission.replace(/_/g, " ")} on this website.`);
  }
}

