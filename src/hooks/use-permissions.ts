import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyPermissionSummary, type PermissionSummary, type PermissionMap } from "@/lib/permissions.functions";
import type { Permission } from "@/lib/server-guards";

const EMPTY: PermissionSummary = {
  aggregated: {},
  perWebsite: {},
  isSuperAdmin: false,
  websiteCount: 0,
};

export function usePermissions() {
  const fn = useServerFn(getMyPermissionSummary);
  const query = useQuery({
    queryKey: ["permissions", "summary"],
    queryFn: () => fn({}),
    staleTime: 60_000,
  });
  const summary = query.data ?? EMPTY;

  const can = (permission: Permission): boolean =>
    summary.isSuperAdmin || summary.aggregated[permission] === true;

  const canOnSite = (websiteId: string, permission: Permission): boolean =>
    summary.isSuperAdmin || summary.perWebsite[websiteId]?.[permission] === true;

  return {
    summary,
    can,
    canOnSite,
    isLoading: query.isLoading,
    isReady: !query.isLoading,
  };
}

export type { PermissionMap };
