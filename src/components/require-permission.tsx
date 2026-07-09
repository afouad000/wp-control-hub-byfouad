import { Link } from "@tanstack/react-router";
import { ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/hooks/use-permissions";
import type { Permission } from "@/lib/server-guards";

/**
 * Client-side guard that hides a route's content when the current user lacks
 * the required permission on ALL of their websites. Backend server functions
 * still enforce permissions per-site — this only prevents the UI from
 * rendering a page the user cannot use.
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: React.ReactNode;
}) {
  const { can, isLoading, summary } = usePermissions();

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        Checking access…
      </div>
    );
  }

  if (can(permission)) return <>{children}</>;

  const noSites = summary.websiteCount === 0 && !summary.isSuperAdmin;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-full bg-muted">
        <ShieldOff className="h-6 w-6 text-muted-foreground" />
      </div>
      <h2 className="text-lg font-semibold">
        {noSites ? "No websites connected" : "You don't have access"}
      </h2>
      <p className="text-sm text-muted-foreground">
        {noSites
          ? "Connect a WordPress or WooCommerce site to start managing it here."
          : `You need the "${permission.replace(/_/g, " ")}" permission on at least one website to view this page. Ask an owner to grant it in Users & roles.`}
      </p>
      <Button asChild size="sm" variant={noSites ? "default" : "outline"}>
        <Link to={noSites ? "/websites/new" : "/websites"}>
          {noSites ? "Add a website" : "Back to websites"}
        </Link>
      </Button>
    </div>
  );
}
