import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, AlertTriangle, PowerOff, ShoppingCart } from "lucide-react";

export type ConnectionStatus =
  | "connected"
  | "connected_no_wc"
  | "error"
  | "disconnected"
  | "unknown";

export function ConnectionBadge({ status }: { status?: string | null }) {
  const s = (status ?? "unknown") as ConnectionStatus;
  switch (s) {
    case "connected":
      return (
        <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="mr-1 h-3 w-3" /> Connected
        </Badge>
      );
    case "connected_no_wc":
      return (
        <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400">
          <ShoppingCart className="mr-1 h-3 w-3" /> WooCommerce inactive
        </Badge>
      );
    case "error":
      return (
        <Badge variant="outline" className="border-destructive/40 text-destructive">
          <AlertCircle className="mr-1 h-3 w-3" /> API error
        </Badge>
      );
    case "disconnected":
      return (
        <Badge variant="outline" className="text-muted-foreground">
          <PowerOff className="mr-1 h-3 w-3" /> Disconnected
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-muted-foreground">
          <AlertTriangle className="mr-1 h-3 w-3" /> Needs attention
        </Badge>
      );
  }
}
