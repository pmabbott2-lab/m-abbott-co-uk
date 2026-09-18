import type { ReactNode } from "react";
import {
  Eye,
  Gift,
  History,
  Inbox,
  Link2,
  MessageSquareText,
  PoundSterling,
  Settings,
  ShieldCheck,
  UserCog,
  Users,
  CalendarDays,
  BarChart3,
} from "lucide-react";
import {
  CUSTOMERS_SUB_TABS,
  defaultFinanceSubTab,
  defaultMarketingSubTab,
  FINANCE_SUB_TABS,
  MANAGEMENT_SUB_TABS,
  MARKETING_SUB_TABS,
  STAFF_BRANCHES,
  type ManagementSubTabId,
  type StaffBranchVisibility,
} from "@/lib/staff-branch-nav";
import {
  resolveCustomersSubDefault,
  resolveManagementSubDefault,
  resolveStaffBranchDefault,
  resolveViewSubDefault,
  writeStaffNavStorage,
} from "@/lib/staff-nav-persistence";
import type { AdminAccess } from "@/lib/admin-access";
import { canAmend, canEditAdminPermissions } from "@/lib/admin-access";
import { CommissionPayoutsPanel } from "@/components/CommissionPayoutsPanel";
import { RelationshipManagementPanel } from "@/components/RelationshipManagementPanel";
import { MyCommissionBranchPanel } from "@/components/MyCommissionStatementPanel";
import { ManageTabPanel } from "@/components/ManageTabPanel";
import {
  AdminAccessPanel,
  ContactsCard,
  IntroducerPortalPanel,
  OwnerFinanceReport,
  InviteStaffCard,
  RafLinksAccessCard,
} from "@/components/staff/panels";
import { ViewBranchPanel } from "@/components/staff/panels/management/ViewBranchPanel";
import { JourneyAnalyticsPanel } from "@/components/staff/panels/management/JourneyAnalyticsPanel";
import { TeamRolesPanel } from "@/components/staff/panels/management/TeamRolesPanel";
import { DiaryTabsPanel } from "@/components/staff/panels/diary/DiaryTabsPanel";
import { NetworkStatementsPanel } from "@/components/staff/panels/finance/NetworkStatementsPanel";
import { AdvisorCommissionStatementsPanel } from "@/components/staff/panels/management/AdvisorCommissionStatementsPanel";
import { CommsScriptsPanel } from "@/components/staff/panels/marketing/CommsScriptsPanel";
import { getAdvisorView } from "@/lib/advisor-view";
import { HubSubNav, type HubSubNavTab } from "@/components/ui/tabs";

export type StaffBranchContext = {
  isMainAdmin: boolean;
  isStaffAdvisor: boolean;
  isOwner: boolean;
  isSupervisor: boolean;
  isIntroducer: boolean;
  adminAccess: AdminAccess | null;
  showRelationshipTab: boolean;
  canRefreshRelationship: boolean;
  showAdvisorViewTab: boolean;
  showIntroducerViewTab: boolean;
  showCommissionPayouts: boolean;
  canAmendPayouts: boolean;
  showFinanceReport: boolean;
  branchVis: StaffBranchVisibility;
  customersList: ReactNode;
  onAdvisorViewChange: () => void;
  onIntroducerViewChange: () => void;
  onCustomerViewChange: () => void;
};

type StaffBranchTabsProps = {
  visibility: StaffBranchVisibility;
  staff: StaffBranchContext;
};

function ManagementBranchPanel({
  visibility,
  staff,
}: {
  visibility: StaffBranchVisibility;
  staff: StaffBranchContext;
}) {
  const tabs: HubSubNavTab[] = [];

  if (visibility.management.analytics) {
    tabs.push({
      id: MANAGEMENT_SUB_TABS.ANALYTICS,
      label: "Analytics",
      icon: <BarChart3 className="w-4 h-4 shrink-0" />,
      content: <JourneyAnalyticsPanel />,
    });
  }

  if (visibility.management.view && staff.showAdvisorViewTab) {
    tabs.push({
      id: MANAGEMENT_SUB_TABS.VIEW,
      label: "View",
      icon: <Eye className="w-4 h-4 shrink-0" />,
      content: (
        <ViewBranchPanel
          visibility={visibility}
          isOwner={staff.isOwner}
          isSupervisor={staff.isSupervisor}
          isMainAdmin={staff.isMainAdmin}
          defaultViewSub={resolveViewSubDefault(visibility)}
          onAdvisorViewChange={staff.onAdvisorViewChange}
          onIntroducerViewChange={staff.onIntroducerViewChange}
          onCustomerViewChange={staff.onCustomerViewChange}
        />
      ),
    });
  }

  if (visibility.management.manage) {
    tabs.push({
      id: MANAGEMENT_SUB_TABS.MANAGE,
      label: "Manage",
      icon: <ShieldCheck className="w-4 h-4 shrink-0" />,
      content: (
        <ManageTabPanel
          isOwner={staff.isOwner}
          isSupervisor={staff.isSupervisor}
          showTeamRoles={visibility.management.manageTeamRoles}
          showInvites={visibility.management.manageInvites}
          teamRolesPanel={
            <TeamRolesPanel
              adminAccess={staff.adminAccess}
              isOwner={staff.isOwner}
              isSupervisor={staff.isSupervisor}
            />
          }
          invitesPanel={<InviteStaffCard />}
        />
      ),
    });
  }

  if (visibility.management.adminAccess) {
    tabs.push({
      id: MANAGEMENT_SUB_TABS.ADMIN_ACCESS,
      label: "Admin access",
      icon: <UserCog className="w-4 h-4 shrink-0" />,
      content: (
        <AdminAccessPanel
          isOwner={staff.isOwner}
          canEditPerms={canEditAdminPermissions(staff.adminAccess)}
        />
      ),
    });
  }

  return (
    <HubSubNav
      tabs={tabs}
      defaultValue={resolveManagementSubDefault(visibility, {
        showViewTab: staff.showAdvisorViewTab,
      })}
      persistKey="mortgage-hub:staff-management-sub"
      onActiveChange={(id) =>
        writeStaffNavStorage(STAFF_BRANCHES.MANAGEMENT, { managementSub: id as ManagementSubTabId })
      }
    />
  );
}

function CustomersBranchPanel({
  visibility,
  staff,
}: {
  visibility: StaffBranchVisibility;
  staff: StaffBranchContext;
}) {
  const tabs: HubSubNavTab[] = [];

  if (visibility.customers.list) {
    tabs.push({
      id: CUSTOMERS_SUB_TABS.LIST,
      label: "Customers",
      icon: <Users className="w-4 h-4 shrink-0" />,
      content: staff.customersList,
    });
  }

  if (visibility.customers.contacts) {
    tabs.push({
      id: CUSTOMERS_SUB_TABS.CONTACTS,
      label: "Contacts",
      icon: <Inbox className="w-4 h-4 shrink-0" />,
      content: <ContactsCard adminAccess={staff.adminAccess} isOwner={staff.isOwner} />,
    });
  }

  if (visibility.customers.relationship && staff.showRelationshipTab) {
    tabs.push({
      id: CUSTOMERS_SUB_TABS.RELATIONSHIP,
      label: "Relationship",
      icon: <History className="w-4 h-4 shrink-0" />,
      content: <RelationshipManagementPanel canRefresh={staff.canRefreshRelationship} />,
    });
  }

  return (
    <HubSubNav
      tabs={tabs}
      defaultValue={resolveCustomersSubDefault(visibility)}
      persistKey="mortgage-hub:staff-customers-sub"
      onActiveChange={(id) =>
        writeStaffNavStorage(STAFF_BRANCHES.CUSTOMERS, { customersSub: id as typeof CUSTOMERS_SUB_TABS.LIST })
      }
    />
  );
}

function FinanceBranchPanel({ visibility, staff }: { visibility: StaffBranchVisibility; staff: StaffBranchContext }) {
  const tabs: HubSubNavTab[] = [];

  if (visibility.finance.myCommission) {
    tabs.push({
      id: FINANCE_SUB_TABS.MY_COMMISSION,
      label: "My commission",
      icon: <PoundSterling className="w-4 h-4 shrink-0" />,
      content: <MyCommissionBranchPanel />,
    });
  }

  if (visibility.finance.commissionStatements) {
    tabs.push({
      id: FINANCE_SUB_TABS.COMMISSION_STATEMENTS,
      label: "Commission statements",
      icon: <PoundSterling className="w-4 h-4 shrink-0" />,
      content: <AdvisorCommissionStatementsPanel />,
    });
  }

  if (visibility.finance.commissionMgmt && staff.showCommissionPayouts) {
    tabs.push({
      id: FINANCE_SUB_TABS.COMMISSION_MGMT,
      label: "Commission mgmt",
      icon: <PoundSterling className="w-4 h-4 shrink-0" />,
      content: <CommissionPayoutsPanel canAmend={staff.canAmendPayouts} />,
    });
  }

  if (visibility.finance.networkStatements) {
    tabs.push({
      id: FINANCE_SUB_TABS.NETWORK_STATEMENTS,
      label: "Network statements",
      icon: <PoundSterling className="w-4 h-4 shrink-0" />,
      content: <NetworkStatementsPanel />,
    });
  }

  if (visibility.finance.financeReport && staff.showFinanceReport) {
    tabs.push({
      id: FINANCE_SUB_TABS.FINANCE_REPORT,
      label: "Finance report",
      icon: <PoundSterling className="w-4 h-4 shrink-0" />,
      content: <OwnerFinanceReport />,
    });
  }

  return <HubSubNav tabs={tabs} defaultValue={defaultFinanceSubTab(visibility)} />;
}

function MarketingBranchPanel({
  visibility,
  staff,
}: {
  visibility: StaffBranchVisibility;
  staff: StaffBranchContext;
}) {
  const tabs: HubSubNavTab[] = [];

  if (visibility.marketing.referAFriend) {
    tabs.push({
      id: MARKETING_SUB_TABS.REFER_A_FRIEND,
      label: "RAF",
      icon: <Gift className="w-4 h-4 shrink-0" />,
      content: <RafLinksAccessCard />,
    });
  }

  if (visibility.marketing.commsScripts) {
    tabs.push({
      id: MARKETING_SUB_TABS.COMMS_SCRIPTS,
      label: "Email / Text / Voice Scripts",
      icon: <MessageSquareText className="w-4 h-4 shrink-0" />,
      content: (
        <CommsScriptsPanel
          canAmend={
            Boolean(staff.isOwner || staff.isSupervisor || canAmend(staff.adminAccess, "comms_templates"))
          }
        />
      ),
    });
  }

  if (tabs.length === 1) return <div className="space-y-4">{tabs[0].content}</div>;
  return <HubSubNav tabs={tabs} defaultValue={defaultMarketingSubTab(visibility)} />;
}

export function StaffBranchTabs({ visibility, staff }: StaffBranchTabsProps) {
  const branchTabs: HubSubNavTab[] = [];

  if (visibility.branches.customers) {
    branchTabs.push({
      id: STAFF_BRANCHES.CUSTOMERS,
      label: "Customers",
      icon: <Users className="w-4 h-4 shrink-0" />,
      content: <CustomersBranchPanel visibility={visibility} staff={staff} />,
    });
  }

  if (visibility.branches.diary) {
    branchTabs.push({
      id: STAFF_BRANCHES.DIARY,
      label: "Diary",
      icon: <CalendarDays className="w-4 h-4 shrink-0" />,
      content: (
        <DiaryTabsPanel
          visibility={visibility}
          isStaffAdvisor={staff.isStaffAdvisor}
          viewAsAdvisorId={getAdvisorView()?.advisorId}
        />
      ),
    });
  }

  if (visibility.branches.management) {
    branchTabs.push({
      id: STAFF_BRANCHES.MANAGEMENT,
      label: "Management",
      icon: <Settings className="w-4 h-4 shrink-0" />,
      content: <ManagementBranchPanel visibility={visibility} staff={staff} />,
    });
  }

  if (visibility.branches.marketing) {
    branchTabs.push({
      id: STAFF_BRANCHES.MARKETING,
      label: "Marketing",
      icon: <Gift className="w-4 h-4 shrink-0" />,
      content: <MarketingBranchPanel visibility={visibility} staff={staff} />,
    });
  }

  if (visibility.branches.introducers && staff.isIntroducer) {
    branchTabs.push({
      id: STAFF_BRANCHES.INTRODUCERS,
      label: "Introducers",
      icon: <Link2 className="w-4 h-4 shrink-0" />,
      content: <IntroducerPortalPanel />,
    });
  }

  if (visibility.branches.finance) {
    branchTabs.push({
      id: STAFF_BRANCHES.FINANCE,
      label: "Finance",
      icon: <PoundSterling className="w-4 h-4 shrink-0" />,
      content: <FinanceBranchPanel visibility={visibility} staff={staff} />,
    });
  }

  if (branchTabs.length === 0) return null;
  if (branchTabs.length === 1) return <div className="space-y-4">{branchTabs[0].content}</div>;

  const defaultBranch = resolveStaffBranchDefault(visibility);

  return (
    <HubSubNav
      tabs={branchTabs}
      defaultValue={defaultBranch}
      variant="hub"
      listClassName="w-full max-w-5xl mx-auto mb-5 justify-center"
      persistKey="mortgage-hub:staff-branch"
      onActiveChange={(id) => writeStaffNavStorage(id as typeof STAFF_BRANCHES.CUSTOMERS)}
    />
  );
}
