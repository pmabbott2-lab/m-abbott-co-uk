import {
  canView,
  canViewCommissionPayouts,
  canViewFinanceReport,
  canViewRelationship,
  type AdminAccess,
} from "@/lib/admin-access";

/** Top-level staff dashboard branches (phase 1 shell). */
export const STAFF_BRANCHES = {
  CUSTOMERS: "customers",
  DIARY: "diary",
  MANAGEMENT: "management",
  MARKETING: "marketing",
  INTRODUCERS: "introducers",
  FINANCE: "finance",
} as const;

export type StaffBranchId = (typeof STAFF_BRANCHES)[keyof typeof STAFF_BRANCHES];

export const CUSTOMERS_SUB_TABS = {
  LIST: "customers-list",
  CONTACTS: "contacts",
  RELATIONSHIP: "relationship",
} as const;

export type CustomersSubTabId = (typeof CUSTOMERS_SUB_TABS)[keyof typeof CUSTOMERS_SUB_TABS];

export const MANAGEMENT_SUB_TABS = {
  ANALYTICS: "analytics",
  ADVISOR_COMMISSION: "advisor-commission",
  VIEW: "view",
  MANAGE: "manage",
  ADMIN_ACCESS: "admin-access",
} as const;

export type ManagementSubTabId = (typeof MANAGEMENT_SUB_TABS)[keyof typeof MANAGEMENT_SUB_TABS];

export const VIEW_SUB_TABS = {
  ADVISOR: "advisor-view",
  INTRODUCER: "introducer-view",
  CUSTOMER: "customer-view",
} as const;

export type ViewSubTabId = (typeof VIEW_SUB_TABS)[keyof typeof VIEW_SUB_TABS];

export const MARKETING_SUB_TABS = {
  REFER_A_FRIEND: "refer-a-friend",
} as const;

export type MarketingSubTabId = (typeof MARKETING_SUB_TABS)[keyof typeof MARKETING_SUB_TABS];

export const DIARY_SUB_TABS = {
  MY_DIARY: "my-diary",
  ALL_APPOINTMENTS: "all-appointments",
} as const;

export type DiarySubTabId = (typeof DIARY_SUB_TABS)[keyof typeof DIARY_SUB_TABS];

export const FINANCE_SUB_TABS = {
  MY_COMMISSION: "my-commission",
  COMMISSION_MGMT: "commission-mgmt",
  NETWORK_STATEMENTS: "network-statements",
  FINANCE_REPORT: "finance-report",
} as const;

export type FinanceSubTabId = (typeof FINANCE_SUB_TABS)[keyof typeof FINANCE_SUB_TABS];

/** Nested under Finance → My commission (phase 4). */
export const MY_COMMISSION_SUB_TABS = {
  SUMMARY: "summary",
  PIPELINE: "pipeline",
} as const;

export type MyCommissionSubTabId =
  (typeof MY_COMMISSION_SUB_TABS)[keyof typeof MY_COMMISSION_SUB_TABS];

export function defaultMyCommissionSubTab(): MyCommissionSubTabId {
  return MY_COMMISSION_SUB_TABS.SUMMARY;
}

export type StaffBranchNavContext = {
  isAdvisor: boolean;
  isMainAdmin: boolean;
  isOwner: boolean;
  isSupervisor: boolean;
  isIntroducer: boolean;
  adminAccess: AdminAccess | null;
};

export type StaffBranchVisibility = {
  branches: {
    customers: boolean;
    diary: boolean;
    management: boolean;
    marketing: boolean;
    introducers: boolean;
    finance: boolean;
  };
  customers: {
    list: boolean;
    contacts: boolean;
    relationship: boolean;
  };
  management: {
    analytics: boolean;
    advisorCommission: boolean;
    view: boolean;
    manage: boolean;
    adminAccess: boolean;
    manageInvites: boolean;
    manageTeamRoles: boolean;
  };
  marketing: {
    referAFriend: boolean;
  };
  diary: {
    myDiary: boolean;
    allAppointments: boolean;
  };
  view: {
    advisor: boolean;
    introducer: boolean;
    customer: boolean;
  };
  finance: {
    myCommission: boolean;
    commissionMgmt: boolean;
    networkStatements: boolean;
    financeReport: boolean;
  };
};

export function getStaffBranchVisibility(ctx: StaffBranchNavContext): StaffBranchVisibility {
  const { isAdvisor, isMainAdmin, isOwner, isSupervisor, isIntroducer, adminAccess } = ctx;

  const customersList = isAdvisor || canView(adminAccess, "customers");
  const contacts = isAdvisor || canView(adminAccess, "appointments");
  const relationship = canViewRelationship(adminAccess);

  const manageTeamRoles =
    isMainAdmin &&
    (isOwner ||
      isSupervisor ||
      canView(adminAccess, "advisors") ||
      canView(adminAccess, "introducers"));

  const manage =
    isOwner ||
    manageTeamRoles ||
    canView(adminAccess, "invites");

  const manageInvites = canView(adminAccess, "invites");
  const marketingRaf = canView(adminAccess, "raf");
  const marketing = isMainAdmin && marketingRaf;

  const adminAccessTab = isOwner || isSupervisor;
  const analytics = isOwner || isSupervisor;
  const viewAsAdmin = (isOwner || isSupervisor) && isMainAdmin;
  const view = viewAsAdmin;
  const advisorCommission =
    isMainAdmin && (isOwner || isSupervisor || canView(adminAccess, "advisors"));
  const management =
    isMainAdmin && (analytics || advisorCommission || view || manage || adminAccessTab);

  /** Top Introducers tab — real introducer accounts only (not owner/supervisor admin). */
  const introducersBranch = isIntroducer && !isOwner && !isSupervisor;

  /** Pure advisors only — not owner/supervisor/general admin dashboards. */
  const financeMyCommission = isAdvisor && !isMainAdmin;
  const financeCommissionMgmt = canViewCommissionPayouts(adminAccess);
  const financeNetworkStatements =
    isOwner ||
    isSupervisor ||
    canView(adminAccess, "finance_network_statements") ||
    financeCommissionMgmt;
  const financeReport = canViewFinanceReport(adminAccess);

  const staffAdvisor = isAdvisor && !isMainAdmin;
  const adminDiary =
    isMainAdmin &&
    (isOwner ||
      isSupervisor ||
      canView(adminAccess, "advisors") ||
      canView(adminAccess, "appointments"));

  const diaryMy = staffAdvisor || adminDiary;
  const diaryAll = adminDiary;

  return {
    branches: {
      customers: customersList || contacts || relationship,
      diary: diaryMy || diaryAll,
      management,
      marketing,
      introducers: introducersBranch,
      finance: financeMyCommission || financeCommissionMgmt || financeNetworkStatements || financeReport,
    },
    customers: {
      list: customersList,
      contacts,
      relationship,
    },
    management: {
      analytics,
      advisorCommission,
      view,
      manage,
      adminAccess: adminAccessTab,
      manageInvites,
      manageTeamRoles,
    },
    marketing: {
      referAFriend: marketingRaf,
    },
    diary: {
      myDiary: diaryMy,
      allAppointments: diaryAll,
    },
    view: {
      advisor: viewAsAdmin,
      introducer: viewAsAdmin,
      customer: viewAsAdmin,
    },
    finance: {
      myCommission: financeMyCommission,
      commissionMgmt: financeCommissionMgmt,
      networkStatements: financeNetworkStatements,
      financeReport,
    },
  };
}

export function defaultStaffBranch(vis: StaffBranchVisibility): StaffBranchId {
  if (vis.branches.customers) return STAFF_BRANCHES.CUSTOMERS;
  if (vis.branches.diary) return STAFF_BRANCHES.DIARY;
  if (vis.branches.management) return STAFF_BRANCHES.MANAGEMENT;
  if (vis.branches.marketing) return STAFF_BRANCHES.MARKETING;
  if (vis.branches.introducers) return STAFF_BRANCHES.INTRODUCERS;
  return STAFF_BRANCHES.FINANCE;
}

export function defaultCustomersSubTab(vis: StaffBranchVisibility): CustomersSubTabId {
  if (vis.customers.list) return CUSTOMERS_SUB_TABS.LIST;
  if (vis.customers.contacts) return CUSTOMERS_SUB_TABS.CONTACTS;
  return CUSTOMERS_SUB_TABS.RELATIONSHIP;
}

export function defaultManagementSubTab(
  vis: StaffBranchVisibility,
  opts?: { showViewTab?: boolean },
): ManagementSubTabId {
  if (vis.management.advisorCommission) return MANAGEMENT_SUB_TABS.ADVISOR_COMMISSION;
  if (vis.management.analytics) return MANAGEMENT_SUB_TABS.ANALYTICS;
  if (vis.management.view && opts?.showViewTab !== false) return MANAGEMENT_SUB_TABS.VIEW;
  if (vis.management.manage) return MANAGEMENT_SUB_TABS.MANAGE;
  return MANAGEMENT_SUB_TABS.ADMIN_ACCESS;
}

export function defaultDiarySubTab(vis: StaffBranchVisibility): DiarySubTabId {
  if (vis.diary.myDiary) return DIARY_SUB_TABS.MY_DIARY;
  return DIARY_SUB_TABS.ALL_APPOINTMENTS;
}

export function defaultViewSubTab(vis: StaffBranchVisibility): ViewSubTabId {
  if (vis.view.advisor) return VIEW_SUB_TABS.ADVISOR;
  if (vis.view.introducer) return VIEW_SUB_TABS.INTRODUCER;
  return VIEW_SUB_TABS.CUSTOMER;
}

export function defaultFinanceSubTab(vis: StaffBranchVisibility): FinanceSubTabId {
  if (vis.finance.myCommission) return FINANCE_SUB_TABS.MY_COMMISSION;
  if (vis.finance.commissionMgmt) return FINANCE_SUB_TABS.COMMISSION_MGMT;
  if (vis.finance.networkStatements) return FINANCE_SUB_TABS.NETWORK_STATEMENTS;
  return FINANCE_SUB_TABS.FINANCE_REPORT;
}

export function countStaffBranches(vis: StaffBranchVisibility): number {
  return Object.values(vis.branches).filter(Boolean).length;
}
