import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type ManageListSort = "date" | "alpha";

type Props = {
  search: string;
  onSearchChange: (value: string) => void;
  sort: ManageListSort;
  onSortChange: (value: ManageListSort) => void;
  searchPlaceholder?: string;
};

export function ManageListControls({
  search,
  onSearchChange,
  sort,
  onSortChange,
  searchPlaceholder = "Search…",
}: Props) {
  return (
    <div className="p-3 border-b flex flex-col sm:flex-row gap-3 sm:items-end">
      <div className="relative flex-1 min-w-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>
      <div className="space-y-1 shrink-0">
        <Label className="text-xs text-muted-foreground">Sort by</Label>
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm w-full sm:w-40"
          value={sort}
          onChange={(e) => onSortChange(e.target.value as ManageListSort)}
        >
          <option value="date">Date added</option>
          <option value="alpha">Alphabetical</option>
        </select>
      </div>
    </div>
  );
}

/** Scrollable list body showing at most `visibleCount` rows (default 5). */
export function ManageListScroll({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-h-[320px] overflow-y-auto divide-y [-webkit-overflow-scrolling:touch]">
      {children}
    </div>
  );
}
