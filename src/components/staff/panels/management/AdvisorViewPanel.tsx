import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AdvisorViewBanner } from "@/components/AdvisorViewBanner";
import { MyCommissionStatementPanel } from "@/components/MyCommissionStatementPanel";
import { AdvisorDiaryPanel } from "@/components/staff/panels/diary/AdvisorDiaryPanel";
import { StaffCustomerBookingCard } from "@/components/StaffCustomerBookingCard";
import { ViewAsAuditPanel } from "@/components/ViewAsAuditPanel";
import { ViewAsExitFooter } from "@/components/ViewAsExitFooter";
import { HubSubNav } from "@/components/ui/tabs";
import {
  CustomersListPanel,
  type CustomerSessionRow,
  type CustomerAllocationFilter,
} from "@/components/staff/panels/customers/CustomersListPanel";
import { clearAdvisorView, getAdvisorView } from "@/lib/advisor-view";
import { markContactOpened } from "@/lib/booking.functions";
import { listAllSessionsForAdvisor } from "@/lib/sessions.functions";
import { recordViewAsAudit } from "@/lib/view-as-audit.functions";

type AssignedAdvisor = { id: string; full_name: string | null; email: string | null };

type AdvisorViewPanelProps = {
  onViewChange: () => void;
  isOwner: boolean;
  isSupervisor: boolean;
  isMainAdmin: boolean;
};

export function AdvisorViewPanel({
  onViewChange,
  isOwner,
  isSupervisor,
  isMainAdmin,
}: AdvisorViewPanelProps) {
  const active = getAdvisorView();
  const qc = useQueryClient();
  const allFn = useServerFn(listAllSessionsForAdvisor);
  const markOpenedFn = useServerFn(markContactOpened);
  const auditFn = useServerFn(recordViewAsAudit);

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "next_contact">("recent");
  const [allocationFilter, setAllocationFilter] = useState<CustomerAllocationFilter>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const advisorViewId = active?.advisorId;

  const allQ = useQuery({
    queryKey: ["advisor-view-sessions", advisorViewId],
    queryFn: () => allFn({ data: { viewAsAdvisorId: advisorViewId } }),
    enabled: Boolean(advisorViewId),
  });

  const markCallbackOpened = useMutation({
    mutationFn: (vars: { contactId: string }) =>
      markOpenedFn({
        data: {
          contactType: "callback",
          contactId: vars.contactId,
          viewAsAdvisorId: advisorViewId,
        },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["advisor-view-sessions"] }),
  });

  const q = search.trim().toLowerCase();
  const sessions = (allQ.data ?? [])
    .filter((s) => {
      const assigned = (s as { assignedAdvisors?: AssignedAdvisor[] }).assignedAdvisors ?? [];
      const isCase = Boolean((s as { case_ref?: string | null }).case_ref);
      if (allocationFilter === "unallocated" && (isCase || assigned.length !== 0)) return false;
      if (allocationFilter === "advisor_introduced" && assigned.length === 0) return false;
      if (!q) return true;
      const c = (s as {
        customer?: { full_name?: string | null; email?: string | null; phone?: string | null } | null;
      }).customer;
      const caseRef = (s as { case_ref?: string | null }).case_ref ?? "";
      const haystack = [c?.full_name, c?.email, c?.phone, caseRef].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    })
    .sort((a, b) => {
      if (sortBy !== "next_contact") return 0;
      const an = (a as { nextContactAt?: string | null }).nextContactAt;
      const bn = (b as { nextContactAt?: string | null }).nextContactAt;
      if (!an && !bn) return 0;
      if (!an) return 1;
      if (!bn) return -1;
      return new Date(an).getTime() - new Date(bn).getTime();
    });

  const visibleIds = sessions.map((s) => s.id);
  const customerRows: CustomerSessionRow[] = sessions.map((s) => ({
    id: s.id,
    customer_id: (s as { customer_id: string }).customer_id,
    status: s.status,
    started_at: s.started_at,
    case_ref: (s as { case_ref?: string | null }).case_ref,
    customer: (s as {
      customer?: { full_name?: string | null; email?: string | null; phone?: string | null } | null;
    }).customer,
    assignedAdvisors: (s as { assignedAdvisors?: AssignedAdvisor[] }).assignedAdvisors,
    nextContactAt: (s as { nextContactAt?: string | null }).nextContactAt,
    callback: (s as { callback?: { id: string; window: string | null } | null }).callback,
    journeyComplete: (s as { journeyComplete?: boolean }).journeyComplete,
    hasLenderDetails: (s as { hasLenderDetails?: boolean }).hasLenderDetails,
    archivedFromAdvisor: (s as { archivedFromAdvisor?: boolean }).archivedFromAdvisor,
    missingLenderAfterCompletion: (s as { missingLenderAfterCompletion?: boolean }).missingLenderAfterCompletion,
  }));

  const handleExit = async () => {
    if (active) {
      try {
        await auditFn({
          data: {
            viewType: "advisor",
            targetUserId: active.advisorId,
            action: "exit_view",
            summary: `Exited advisor view for ${active.advisorName}`,
          },
        });
      } catch {
        /* non-fatal */
      }
    }
    clearAdvisorView();
    onViewChange();
  };

  return (
    <div className="space-y-4">
      <AdvisorViewBanner canUse onViewChange={onViewChange} />

      {!active && (
        <p className="text-sm text-muted-foreground">
          Select an advisor and enter view to see their customers, diary, and commission exactly as
          they would — you can make changes on their behalf.
        </p>
      )}

      {active && (
        <>
          <HubSubNav
            defaultValue="customers"
            tabs={[
              {
                id: "customers",
                label: "Customers",
                content: (
                  <div className="space-y-4">
                    <StaffCustomerBookingCard
                      onBooked={() => qc.invalidateQueries({ queryKey: ["advisor-view-sessions"] })}
                    />
                    <CustomersListPanel
                      isMainAdmin={isMainAdmin}
                      isOwner={isOwner}
                      isSupervisor={isSupervisor}
                      sessions={customerRows}
                      search={search}
                      onSearchChange={setSearch}
                      sortBy={sortBy}
                      onSortByChange={setSortBy}
                      allocationFilter={allocationFilter}
                      onAllocationFilterChange={setAllocationFilter}
                      selectedIds={selectedIds}
                      visibleIds={visibleIds}
                      onToggleSelected={(id, on) =>
                        setSelectedIds((prev) =>
                          on ? [...new Set([...prev, id])] : prev.filter((x) => x !== id),
                        )
                      }
                      onSelectAll={() => setSelectedIds(visibleIds)}
                      onClearSelection={() => setSelectedIds([])}
                      onCallbackOpen={(id) => markCallbackOpened.mutate({ contactId: id })}
                      onInvalidate={() => qc.invalidateQueries({ queryKey: ["advisor-view-sessions"] })}
                    />
                  </div>
                ),
              },
              {
                id: "diary",
                label: "Diary",
                content: (
                  <AdvisorDiaryPanel
                    viewAsAdvisorId={active.advisorId}
                    title={`${active.advisorName}'s diary`}
                    description="Upcoming confirmed appointments for this advisor — same view they see under Diary."
                  />
                ),
              },
              {
                id: "commission",
                label: "My commission",
                content: (
                  <MyCommissionStatementPanel
                    viewAsUserId={active.advisorId}
                    title={`${active.advisorName}'s commission`}
                    description="Commission statement for this advisor — same view they see under Finance → My commission."
                    embedded
                  />
                ),
              },
            ]}
          />

          <ViewAsAuditPanel viewType="advisor" targetUserId={active.advisorId} />

          <ViewAsExitFooter label="Exit advisor view" onExit={handleExit} />
        </>
      )}
    </div>
  );
}
