import { Search } from "lucide-react";
import { OwnerCustomerExportBox } from "@/components/OwnerCustomerExportBox";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BulkAllocateDialog,
  BulkTransferDialog,
  DashboardSessionRow,
  DashboardSessionsListHeader,
} from "@/components/staff/panels/staff-panels";

export type AssignedAdvisor = { id: string; full_name: string | null; email: string | null };

export type CustomerAllocationFilter = "unallocated" | "advisor_introduced" | "all";

export type CustomerSessionRow = {
  id: string;
  customer_id: string;
  status: string;
  started_at: string;
  case_ref?: string | null;
  customer?: { full_name?: string | null; email?: string | null; phone?: string | null } | null;
  assignedAdvisors?: AssignedAdvisor[];
  nextContactAt?: string | null;
  callback?: { id: string; window: string | null } | null;
  journeyComplete?: boolean;
  hasLenderDetails?: boolean;
  archivedFromAdvisor?: boolean;
  missingLenderAfterCompletion?: boolean;
};

type CustomersListPanelProps = {
  isMainAdmin: boolean;
  isOwner: boolean;
  isSupervisor: boolean;
  sessions: CustomerSessionRow[];
  search: string;
  onSearchChange: (value: string) => void;
  sortBy: "recent" | "next_contact";
  onSortByChange: (value: "recent" | "next_contact") => void;
  allocationFilter: CustomerAllocationFilter;
  onAllocationFilterChange: (value: CustomerAllocationFilter) => void;
  selectedIds: string[];
  visibleIds: string[];
  onToggleSelected: (id: string, on: boolean) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onCallbackOpen: (contactId: string) => void;
  onInvalidate: () => void;
};

export function CustomersListPanel({
  isMainAdmin,
  isOwner,
  isSupervisor,
  sessions,
  search,
  onSearchChange,
  sortBy,
  onSortByChange,
  allocationFilter,
  onAllocationFilterChange,
  selectedIds,
  visibleIds,
  onToggleSelected,
  onSelectAll,
  onClearSelection,
  onCallbackOpen,
  onInvalidate,
}: CustomersListPanelProps) {
  const selectedVisible = selectedIds.filter((id) => visibleIds.includes(id));
  const allVisibleSelected = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;

  const emptyMessage =
    search.trim()
      ? "No customers match your search."
      : allocationFilter === "unallocated"
        ? "No unallocated fact-finds."
        : allocationFilter === "advisor_introduced"
          ? "No advisor-allocated customers."
          : "No customers yet.";

  return (
    <div className="flex flex-col gap-4">
      {isMainAdmin ? (
        <div className="space-y-3 mb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-muted-foreground">
              One row per fact-find or case — customer name, reference, and status at a glance.
            </p>
            <div className="flex items-center gap-2">
              <Label htmlFor="allocation-filter" className="text-xs text-muted-foreground shrink-0">
                Show
              </Label>
              <select
                id="allocation-filter"
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={allocationFilter}
                onChange={(e) =>
                  onAllocationFilterChange(e.target.value as CustomerAllocationFilter)
                }
              >
                <option value="unallocated">Unallocated</option>
                <option value="advisor_introduced">Advisor allocated</option>
                <option value="all">All customers</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search customers by name, email or phone…"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                className="pl-9"
              />
            </div>
            <select
              className="rounded-md border bg-background px-3 py-2 text-sm"
              value={sortBy}
              onChange={(e) => onSortByChange(e.target.value as "recent" | "next_contact")}
              aria-label="Sort customers"
            >
              <option value="recent">Sort: Most recent</option>
              <option value="next_contact">Sort: Next contact</option>
            </select>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl border bg-muted/40 px-3 py-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={allVisibleSelected}
                onCheckedChange={(v) => (v === true ? onSelectAll() : onClearSelection())}
              />
              {selectedVisible.length > 0 ? `${selectedVisible.length} selected` : "Select all"}
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              {selectedVisible.length > 0 && (
                <Button variant="ghost" size="sm" onClick={onClearSelection}>
                  Clear
                </Button>
              )}
              <BulkAllocateDialog
                selectedIds={selectedVisible}
                onDone={() => {
                  onClearSelection();
                  onInvalidate();
                }}
              />
              <BulkTransferDialog
                selectedIds={selectedVisible}
                onDone={() => {
                  onClearSelection();
                  onInvalidate();
                }}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search customers by name, email or phone…"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-9"
            />
          </div>
          <select
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={sortBy}
            onChange={(e) => onSortByChange(e.target.value as "recent" | "next_contact")}
            aria-label="Sort customers"
          >
            <option value="recent">Sort: Most recent</option>
            <option value="next_contact">Sort: Next contact</option>
          </select>
        </div>
      )}
      <div className="rounded-2xl border bg-card overflow-hidden max-h-[min(70vh,640px)] overflow-y-auto">
        <DashboardSessionsListHeader showCheckbox={isMainAdmin} />
        {sessions.length === 0 && (
          <div className="p-6 text-muted-foreground text-sm">{emptyMessage}</div>
        )}
        {sessions.map((session) => (
          <DashboardSessionRow
            key={session.id}
            session={session}
            isMainAdmin={isMainAdmin}
            isOwner={isOwner}
            isSupervisor={isSupervisor}
            selected={selectedIds.includes(session.id)}
            onToggleSelect={(on) => onToggleSelected(session.id, on)}
            onCallbackOpen={onCallbackOpen}
            onInvalidate={onInvalidate}
          />
        ))}
      </div>
      {isOwner && (
        <div className="self-start pt-1">
          <OwnerCustomerExportBox />
        </div>
      )}
    </div>
  );
}
