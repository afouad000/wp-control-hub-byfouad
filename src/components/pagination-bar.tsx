import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function PaginationBar({
  page,
  totalPages,
  total,
  perPage,
  onPageChange,
  onPerPageChange,
  disabled,
}: {
  page: number;
  totalPages: number;
  total: number;
  perPage: number;
  onPageChange: (p: number) => void;
  onPerPageChange: (n: number) => void;
  disabled?: boolean;
}) {
  const canPrev = page > 1 && !disabled;
  const canNext = page < totalPages && !disabled;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-3 text-xs text-muted-foreground">
      <div>
        {total > 0 ? (
          <>
            Page <span className="font-medium text-foreground">{page}</span> of{" "}
            <span className="font-medium text-foreground">{totalPages || 1}</span> · {total} total
          </>
        ) : (
          "No results"
        )}
      </div>
      <div className="flex items-center gap-2">
        <span>Rows</span>
        <Select value={String(perPage)} onValueChange={(v) => onPerPageChange(Number(v))} disabled={disabled}>
          <SelectTrigger className="h-7 w-[72px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[10, 20, 50, 100].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="h-7" disabled={!canPrev} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="h-3 w-3" />
        </Button>
        <Button size="sm" variant="outline" className="h-7" disabled={!canNext} onClick={() => onPageChange(page + 1)}>
          <ChevronRight className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
