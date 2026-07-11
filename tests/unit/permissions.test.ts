import { describe, it, expect } from "vitest";
import type { PermissionSummary } from "../../src/lib/permissions.functions";
import type { Permission } from "../../src/lib/server-guards";

// Re-implement the pure helpers here to test them without React hook context.
// They MUST stay in sync with src/hooks/use-permissions.ts — if that logic
// changes, so does this.
function makeChecks(summary: PermissionSummary) {
  const can = (permission: Permission): boolean =>
    summary.isSuperAdmin || summary.aggregated[permission] === true;
  const canOnSite = (websiteId: string, permission: Permission): boolean =>
    summary.isSuperAdmin || summary.perWebsite[websiteId]?.[permission] === true;
  return { can, canOnSite };
}

const EMPTY: PermissionSummary = {
  aggregated: {},
  perWebsite: {},
  isSuperAdmin: false,
  websiteCount: 0,
};

describe("permission checks", () => {
  it("denies everything on an empty summary", () => {
    const { can, canOnSite } = makeChecks(EMPTY);
    expect(can("view_orders")).toBe(false);
    expect(canOnSite("any", "view_orders")).toBe(false);
  });

  it("super admin bypasses all checks", () => {
    const { can, canOnSite } = makeChecks({ ...EMPTY, isSuperAdmin: true });
    expect(can("manage_team")).toBe(true);
    expect(canOnSite("nonexistent", "edit_products")).toBe(true);
  });

  it("aggregated grants apply to can() but not to specific sites without perWebsite entry", () => {
    const { can, canOnSite } = makeChecks({
      ...EMPTY,
      aggregated: { view_orders: true },
      websiteCount: 1,
    });
    expect(can("view_orders")).toBe(true);
    expect(can("edit_orders")).toBe(false);
    expect(canOnSite("site-a", "view_orders")).toBe(false);
  });

  it("perWebsite entries control per-site checks independently", () => {
    const { canOnSite } = makeChecks({
      ...EMPTY,
      aggregated: { view_orders: true, edit_orders: true },
      perWebsite: {
        "site-a": { view_orders: true, edit_orders: true },
        "site-b": { view_orders: true },
      },
      websiteCount: 2,
    });
    expect(canOnSite("site-a", "edit_orders")).toBe(true);
    expect(canOnSite("site-b", "edit_orders")).toBe(false);
    expect(canOnSite("site-b", "view_orders")).toBe(true);
  });
});
