import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { KeyRound } from "lucide-react";
import { listAllSessionsForAdvisor, getMyRole } from "@/lib/sessions.functions";
import {
  ADMIN_LEVEL_LABELS,
  canAmendCommissionPayouts,
  canViewCommissionPayouts,
  canViewFinanceReport,
  canViewRelationship,
  canAmendRelationship,
  type AdminAccess,
} from "@/lib/admin-access";
import { markContactOpened } from "@/lib/booking.functions";
import { StaffCustomerBookingCard } from "@/components/StaffCustomerBookingCard";
import { StaffBranchTabs } from "@/components/staff/StaffBranchTabs";
import { getStaffBranchVisibility } from "@/lib/staff-branch-nav";
import { getAdvisorView } from "@/lib/advisor-view";
import { AppShell } from "@/components/AppShell";
import { useTenantUi } from "@/lib/tenant-ui";
import { isPlatformReadOnly } from "@/lib/tenant-role";
import {
  CustomersListPanel,
  type CustomerSessionRow,
  type CustomerAllocationFilter,
} from "@/components/staff/panels/customers/CustomersListPanel";

type AssignedAdvisor = { id: string; full_name: string | null; email: string | null };

type StaffDashboardProps = {
  isAdvisor: boolean;
  isMainAdmin: boolean;
  isOwner: boolean;
  isSupervisor: boolean;
  isIntroducer: boolean;
  adminLevel: string | null;
  adminAccess: AdminAccess | null;
  advisorCode: string | null;
  accessContext?: string | null;
  platformAccessLevel?: string | null;
};

export function StaffDashboard({
  isAdvisor,
  isMainAdmin,
  isOwner,
  isSupervisor,
  isIntroducer,
  adminLevel,
  adminAccess,
  advisorCode,
  accessContext = null,
  platformAccessLevel = null,
}: StaffDashboardProps) {
  const qc = useQueryClient();
  const tenantSlug = useTenantUi()?.slug;
  const allFn = useServerFn(listAllSessionsForAdvisor);
  const markOpenedFn = useServerFn(markContactOpened);

  const platformReadOnly = isPlatformReadOnly({
    accessContext: (accessContext as "membership" | "platform_access" | "none") ?? "none",
    platformAccessLevel:
      (platformAccessLevel as "read_only" | "operational_admin" | "emergency" | null) ?? null,
  });
  const canLoadOperationalReads = isAdvisor || isMainAdmin || platformReadOnly;

  const showCommissionPayouts = !platformReadOnly && canViewCommissionPayouts(adminAccess);
  const canAmendPayouts = !platformReadOnly && canAmendCommissionPayouts(adminAccess);
  const showFinanceReport = !platformReadOnly && canViewFinanceReport(adminAccess);
  const showRelationshipTab = !platformReadOnly && canViewRelationship(adminAccess);
  const canRefreshRelationship = !platformReadOnly && canAmendRelationship(adminAccess);
  const showAdvisorViewTab = !platformReadOnly && (isOwner || isSupervisor) && isMainAdmin;
  const showIntroducerViewTab = !platformReadOnly && (isOwner || isSupervisor) && isMainAdmin;
  const dashboardTitle = platformReadOnly
    ? "Dashboard"
    : isMainAdmin
      ? "Admin dashboard"
      : isAdvisor
        ? "Your customers"
        : isIntroducer
          ? "Introducer dashboard"
          : "Dashboard";

  const [allocationFilter, setAllocationFilter] = useState<CustomerAllocationFilter>(
    isMainAdmin && !platformReadOnly ? "unallocated" : "all",
  );
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "next_contact">("recent");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [advisorViewTick, setAdvisorViewTick] = useState(0);
  const [introducerViewTick, setIntroducerViewTick] = useState(0);
  const [customerViewTick, setCustomerViewTick] = useState(0);
  const advisorViewId = getAdvisorView()?.advisorId;

  const allQ = useQuery({
    queryKey: ["all-sessions", advisorViewId, advisorViewTick, tenantSlug ?? null],
    queryFn: () => allFn({ data: { viewAsAdvisorId: advisorViewId, tenantSlug } }),
    enabled: canLoadOperationalReads,
  });

  const markCallbackOpened = useMutation({
    mutationFn: (vars: { contactId: string }) =>
      markOpenedFn({ data: { contactType: "callback", contactId: vars.contactId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["all-sessions"] }),
  });

  const isStaffAdvisor = isAdvisor && !isMainAdmin;

  const q = search.trim().toLowerCase();
  const sessions = (allQ.data ?? [])
    .filter((s) => {
      // Pure advisors: archive completed journeys once lender details are entered.
      // Main admin Customers and Management → View keep them visible.
      if (
        isStaffAdvisor &&
        (s as { archivedFromAdvisor?: boolean }).archivedFromAdvisor
      ) {
        return false;
      }
      const assigned = (s as { assignedAdvisors?: AssignedAdvisor[] }).assignedAdvisors ?? [];
      const isCase = Boolean((s as { case_ref?: string | null }).case_ref);
      if (allocationFilter === "unallocated" && (isCase || assigned.length !== 0)) return false;
      if (allocationFilter === "advisor_introduced" && assigned.length === 0) return false;
      if (!q) return true;
      const c = (s as { customer?: { full_name?: string | null; email?: string | null; phone?: string | null } | null }).customer;
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

  const invalidateSessions = () => qc.invalidateQueries({ queryKey: ["all-sessions"] });
  const visibleIds = sessions.map((s) => s.id);
  const toggleSelected = (id: string, on: boolean) =>
    setSelectedIds((prev) => (on ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));
  const clearSelection = () => setSelectedIds([]);

  const branchVis = getStaffBranchVisibility({
    isAdvisor,
    isMainAdmin,
    isOwner,
    isSupervisor,
    isIntroducer,
    adminAccess,
    platformReadOnly,
  });
  // Keep mutate chrome off for Data Read (do not raise isMainAdmin).
  const listAsMainAdmin = isMainAdmin && !platformReadOnly;

  const customerRows: CustomerSessionRow[] = sessions.map((s) => ({
    id: s.id,
    customer_id: (s as { customer_id: string }).customer_id,
    status: s.status,
    started_at: s.started_at,
    case_ref: (s as { case_ref?: string | null }).case_ref,
    customer: (s as { customer?: { full_name?: string | null; email?: string | null; phone?: string | null } | null }).customer,
    assignedAdvisors: (s as { assignedAdvisors?: AssignedAdvisor[] }).assignedAdvisors,
    nextContactAt: (s as { nextContactAt?: string | null }).nextContactAt,
    callback: (s as { callback?: { id: string; window: string | null } | null }).callback,
    journeyComplete: (s as { journeyComplete?: boolean }).journeyComplete,
    hasLenderDetails: (s as { hasLenderDetails?: boolean }).hasLenderDetails,
    archivedFromAdvisor: (s as { archivedFromAdvisor?: boolean }).archivedFromAdvisor,
    missingLenderAfterCompletion: (s as { missingLenderAfterCompletion?: boolean }).missingLenderAfterCompletion,
  }));

  return (
    <AppShell title={isIntroducer && !isAdvisor && !isMainAdmin ? "Introducer portal" : "Advisor dashboard"}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-2xl font-semibold">{dashboardTitle}</h2>
          {adminLevel && !platformReadOnly && (
            <span className="inline-flex items-center rounded-full border bg-muted px-3 py-1 text-xs font-medium">
              {ADMIN_LEVEL_LABELS[adminLevel as keyof typeof ADMIN_LEVEL_LABELS]}
            </span>
          )}
          {platformReadOnly && (
            <span className="inline-flex items-center rounded-full border bg-muted px-3 py-1 text-xs font-medium">
              Read only
            </span>
          )}
          {advisorCode && isStaffAdvisor && !platformReadOnly && (
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-sm">
              <KeyRound className="w-3.5 h-3.5 text-muted-foreground" />
              Your code: <span className="font-mono font-medium">{advisorCode}</span>
            </span>
          )}
        </div>
      </div>

      <StaffBranchTabs
        visibility={branchVis}
        staff={{
          isMainAdmin: listAsMainAdmin,
          isStaffAdvisor: isStaffAdvisor && !platformReadOnly,
          isOwner: isOwner && !platformReadOnly,
          isSupervisor: isSupervisor && !platformReadOnly,
          isIntroducer: isIntroducer && !platformReadOnly,
          adminAccess: platformReadOnly ? null : adminAccess,
          showRelationshipTab,
          canRefreshRelationship,
          showAdvisorViewTab,
          showIntroducerViewTab,
          showCommissionPayouts,
          canAmendPayouts,
          showFinanceReport,
          branchVis,
          readOnly: platformReadOnly,
          customersList: (
            <div className="space-y-4">
              {isStaffAdvisor && !platformReadOnly && (
                <StaffCustomerBookingCard onBooked={invalidateSessions} />
              )}
              <CustomersListPanel
              isMainAdmin={listAsMainAdmin}
              isOwner={isOwner && !platformReadOnly}
              isSupervisor={isSupervisor && !platformReadOnly}
              sessions={customerRows}
              search={search}
              onSearchChange={setSearch}
              sortBy={sortBy}
              onSortByChange={setSortBy}
              allocationFilter={allocationFilter}
              onAllocationFilterChange={setAllocationFilter}
              selectedIds={selectedIds}
              visibleIds={visibleIds}
              onToggleSelected={toggleSelected}
              onSelectAll={() => setSelectedIds(visibleIds)}
              onClearSelection={clearSelection}
              onCallbackOpen={(id) => markCallbackOpened.mutate({ contactId: id })}
              onInvalidate={invalidateSessions}
            />
            </div>
          ),
          onAdvisorViewChange: () => {
            setAdvisorViewTick((n) => n + 1);
            invalidateSessions();
          },
          onIntroducerViewChange: () => {
            setIntroducerViewTick((n) => n + 1);
          },
          onCustomerViewChange: () => {
            setCustomerViewTick((n) => n + 1);
          },
        }}
        key={`branch-${advisorViewTick}-${introducerViewTick}-${customerViewTick}`}
      />
    </AppShell>
  );
}

/** Load role + introducer flag then render staff dashboard. */
export function StaffDashboardLoader() {
  const tenantSlug = useTenantUi()?.slug;
  const roleFn = useServerFn(getMyRole);

  const roleQ = useQuery({
    queryKey: ["my-role", tenantSlug ?? null],
    queryFn: async () => {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Account load timed out — please sign in again.")), 12000),
      );
      return Promise.race([roleFn({ data: { tenantSlug } }), timeout]);
    },
    retry: 1,
  });

  if (roleQ.isLoading) {
    return (
      <AppShell title="Home">
        <div className="py-16 text-center text-muted-foreground">Loading…</div>
      </AppShell>
    );
  }

  if (roleQ.isError) {
    return (
      <AppShell title="Home">
        <div className="py-16 text-center text-muted-foreground">
          We couldn&apos;t load your account. Please sign in again.
        </div>
      </AppShell>
    );
  }

  return (
    <StaffDashboard
      isAdvisor={roleQ.data?.isAdvisor ?? false}
      isMainAdmin={roleQ.data?.isMainAdmin ?? false}
      isOwner={roleQ.data?.isOwner ?? false}
      isSupervisor={roleQ.data?.isSupervisor ?? false}
      isIntroducer={roleQ.data?.isIntroducer ?? false}
      adminLevel={roleQ.data?.adminLevel ?? null}
      adminAccess={roleQ.data?.adminAccess ?? null}
      advisorCode={roleQ.data?.advisorCode ?? null}
      accessContext={roleQ.data?.accessContext ?? null}
      platformAccessLevel={roleQ.data?.platformAccessLevel ?? null}
    />
  );
}
