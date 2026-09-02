import type { ReactNode } from "react";
import {
  CalendarDays,
  Eye,
  History,
  Inbox,
  Link2,
  PoundSterling,
  Settings,
  ShieldCheck,
  UserCog,
  Users,
} from "lucide-react";
import {
  CUSTOMERS_SUB_TABS,
  defaultCustomersSubTab,
  defaultFinanceSubTab,
  defaultManagementSubTab,
  defaultStaffBranch,
  FINANCE_SUB_TABS,
  MANAGEMENT_SUB_TABS,
  STAFF_BRANCHES,
  type StaffBranchVisibility,
} from "@/lib/staff-branch-nav";
import type { AdminAccess } from "@/lib/admin-access";
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
import { AdvisorCommissionStatementsPanel } from "@/components/staff/panels/management/AdvisorCommissionStatementsPanel";
import { TeamRolesPanel } from "@/components/staff/panels/management/TeamRolesPanel";
import { DiaryTabsPanel } from "@/components/staff/panels/diary/DiaryTabsPanel";
import { canEditAdminPermissions } from "@/lib/admin-access";
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

function DiaryBranchPanel({
  visibility,
  isStaffAdvisor,
}: {
  visibility: StaffBranchVisibility;
  isStaffAdvisor: boolean;
}) {
  return <DiaryTabsPanel visibility={visibility} isStaffAdvisor={isStaffAdvisor} />;
}

function ManagementBranchPanel({
  visibility,
  staff,
}: {
  visibility: StaffBranchVisibility;
  staff: StaffBranchContext;
}) {
  const tabs: HubSubNavTab[] = [];

  if (visibility.management.advisorCommission) {
    tabs.push({
      id: MANAGEMENT_SUB_TABS.ADVISOR_COMMISSION,
      label: "Commission statements",
      icon: <PoundSterling className="w-4 h-4 shrink-0" />,
      content: <AdvisorCommissionStatementsPanel />,
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
          showTeamRoles={visibility.management.manageTeamRoles}
          showInvites={visibility.management.manageInvites}
          showReferAFriend={visibility.management.manageRaf}
          teamRolesPanel={
            <TeamRolesPanel
              adminAccess={staff.adminAccess}
              isOwner={staff.isOwner}
              isSupervisor={staff.isSupervisor}
            />
          }
          invitesPanel={<InviteStaffCard />}
          referAFriendPanel={<RafLinksAccessCard />}
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
      defaultValue={defaultManagementSubTab(visibility, {
        showViewTab: staff.showAdvisorViewTab,
      })}
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

  return <HubSubNav tabs={tabs} defaultValue={defaultCustomersSubTab(visibility)} />;
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

  if (visibility.finance.commissionMgmt && staff.showCommissionPayouts) {
    tabs.push({
      id: FINANCE_SUB_TABS.COMMISSION_MGMT,
      label: "Commission mgmt",
      icon: <PoundSterling className="w-4 h-4 shrink-0" />,
      content: <CommissionPayoutsPanel canAmend={staff.canAmendPayouts} />,
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
      content: <DiaryBranchPanel visibility={visibility} isStaffAdvisor={staff.isStaffAdvisor} />,
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

  return (
    <HubSubNav
      tabs={branchTabs}
      defaultValue={defaultStaffBranch(visibility)}
      variant="hub"
      listClassName="w-full max-w-4xl mx-auto mb-5 justify-center"
    />
  );
}
