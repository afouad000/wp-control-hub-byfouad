import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAuthenticatedContext, friendlyDbError, requirePermission } from "./server-guards";

/**
 * Team invitations.
 *
 * Owners / managers create a signed invite, share the link, and the invitee
 * accepts once signed in. The accept flow is enforced in Postgres via the
 * SECURITY DEFINER `public.accept_invitation(token)` function, which checks
 * email match + expiry + revocation before adding the member.
 *
 * Roles map to preset permission bundles that mirror `websites.functions.ts`.
 */

const ROLE_PRESETS_KEYS = [
  "view_dashboard",
  "view_orders", "edit_orders",
  "view_products", "edit_products",
  "view_customers", "edit_customers",
  "view_coupons", "manage_coupons",
  "view_reports",
  "manage_website_settings",
  "manage_team",
  "view_activity_logs",
] as const;

function makePreset(role: "admin" | "editor" | "viewer"): Record<string, boolean> {
  const base: Record<string, boolean> = Object.fromEntries(ROLE_PRESETS_KEYS.map((k) => [k, false]));
  if (role === "admin") {
    return {
      ...base,
      view_dashboard: true, view_orders: true, edit_orders: true,
      view_products: true, edit_products: true, view_customers: true, edit_customers: true,
      view_coupons: true, manage_coupons: true, view_reports: true,
      view_activity_logs: true, manage_website_settings: true,
    };
  }
  if (role === "editor") {
    return {
      ...base,
      view_dashboard: true,
      view_orders: true, edit_orders: true,
      view_products: true, edit_products: true,
      view_customers: true,
      view_coupons: true, manage_coupons: true,
    };
  }
  return {
    ...base,
    view_dashboard: true, view_orders: true, view_products: true,
    view_customers: true, view_coupons: true, view_reports: true,
  };
}

/** Cryptographically random URL-safe token, ~256 bits. */
export function generateInvitationToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  // base64url without padding
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Returns true when the invitation is still actionable. */
export function isInvitationLive(inv: {
  expires_at: string | Date;
  accepted_at: string | Date | null;
  revoked_at: string | Date | null;
}): boolean {
  if (inv.accepted_at) return false;
  if (inv.revoked_at) return false;
  return new Date(inv.expires_at).getTime() > Date.now();
}

const IdInput = z.object({ id: z.string().uuid() });
const WebsiteIdInput = z.object({ website_id: z.string().uuid() });
const TokenInput = z.object({ token: z.string().trim().min(10).max(200) });
const CreateInput = z.object({
  website_id: z.string().uuid(),
  email: z.string().trim().email().max(320),
  role: z.enum(["admin", "editor", "viewer"]).default("viewer"),
  permissions: z.record(z.string(), z.boolean()).optional(),
});

export type InvitationRow = {
  id: string;
  website_id: string;
  email: string;
  role: string;
  permissions: Record<string, boolean> | null;
  invited_by: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export const listInvitations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => WebsiteIdInput.parse(d))
  .handler(async ({ data, context }) => {
    await requirePermission(context, data.website_id, "manage_team");
    const { data: rows, error } = await context.supabase
      .from("website_invitations")
      .select("id, website_id, email, role, permissions, invited_by, expires_at, accepted_at, revoked_at, created_at")
      .eq("website_id", data.website_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(friendlyDbError(error, "Could not load invitations."));
    return { ok: true as const, invitations: (rows ?? []) as InvitationRow[] };
  });

export const createInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => CreateInput.parse(d))
  .handler(async ({ data, context }) => {
    assertAuthenticatedContext(context);
    await requirePermission(context, data.website_id, "manage_team");

    const email = data.email.toLowerCase();
    const permissions = data.permissions ?? makePreset(data.role);
    const token = generateInvitationToken();

    // Revoke any prior pending invite for the same email+website so listings stay clean.
    await context.supabase
      .from("website_invitations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("website_id", data.website_id)
      .eq("email", email)
      .is("accepted_at", null)
      .is("revoked_at", null);

    const { data: inserted, error } = await context.supabase
      .from("website_invitations")
      .insert({
        website_id: data.website_id,
        email,
        role: data.role,
        permissions,
        invited_by: context.userId,
        token,
      })
      .select("id, token, expires_at")
      .single();
    if (error) throw new Error(friendlyDbError(error, "Could not create invitation."));

    await context.supabase.from("audit_logs").insert({
      user_id: context.userId,
      website_id: data.website_id,
      action: "website.invitation_created",
      entity_type: "invitation",
      entity_id: inserted.id,
      new_value: { email, role: data.role },
    });

    return {
      ok: true as const,
      id: inserted.id as string,
      token: inserted.token as string,
      expires_at: inserted.expires_at as string,
    };
  });

export const revokeInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    assertAuthenticatedContext(context);
    const { data: inv, error: fErr } = await context.supabase
      .from("website_invitations")
      .select("id, website_id, email, revoked_at, accepted_at")
      .eq("id", data.id)
      .maybeSingle();
    if (fErr) throw new Error(friendlyDbError(fErr, "Could not revoke invitation."));
    if (!inv) throw new Error("Invitation not found or access denied.");
    await requirePermission(context, inv.website_id, "manage_team");
    if (inv.accepted_at) throw new Error("Invitation was already accepted.");

    const { error } = await context.supabase
      .from("website_invitations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(friendlyDbError(error, "Could not revoke invitation."));

    await context.supabase.from("audit_logs").insert({
      user_id: context.userId,
      website_id: inv.website_id,
      action: "website.invitation_revoked",
      entity_type: "invitation",
      entity_id: data.id,
      new_value: { email: inv.email },
    });
    return { ok: true as const };
  });

/**
 * Public-ish accessor. Reads the SECURITY DEFINER wrapper, which returns
 * only a safe summary (no credentials, no permissions map). Callable
 * anonymously — the token IS the capability.
 */
export const getInvitationByToken = createServerFn({ method: "GET" })
  .inputValidator((d) => TokenInput.parse(d))
  .handler(async ({ data }) => {
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error("Server misconfiguration.");
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const h = new Headers(init?.headers);
          if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
          h.set("apikey", key);
          return fetch(input, { ...init, headers: h });
        },
      },
    });
    const { data: rows, error } = await client.rpc("get_invitation_by_token", { _token: data.token });
    if (error) throw new Error("Could not load invitation.");
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) return { ok: false as const, error: "Invitation not found." };
    return {
      ok: true as const,
      invitation: {
        website_id: row.website_id as string,
        website_name: row.website_name as string,
        email: row.email as string,
        role: row.role as string,
        invited_by_email: (row.invited_by_email as string | null) ?? null,
        expires_at: row.expires_at as string,
        accepted_at: (row.accepted_at as string | null) ?? null,
        revoked_at: (row.revoked_at as string | null) ?? null,
      },
    };
  });

export const acceptInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => TokenInput.parse(d))
  .handler(async ({ data, context }) => {
    assertAuthenticatedContext(context);
    const { data: rows, error } = await context.supabase.rpc("accept_invitation", { _token: data.token });
    if (error) throw new Error(friendlyDbError(error, "Could not accept invitation."));
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row || row.ok !== true) {
      return { ok: false as const, error: (row?.message as string) ?? "Could not accept invitation." };
    }
    return { ok: true as const, website_id: row.website_id as string, message: row.message as string };
  });
