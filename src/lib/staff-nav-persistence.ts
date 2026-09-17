import { getAdvisorView } from "@/lib/advisor-view";
import { getCustomerView } from "@/lib/customer-view";
import { getIntroducerView } from "@/lib/introducer-view";
import {
  CUSTOMERS_SUB_TABS,
  MANAGEMENT_SUB_TABS,
  STAFF_BRANCHES,
  VIEW_SUB_TABS,
  type CustomersSubTabId,
  type ManagementSubTabId,
  type StaffBranchId,
  type StaffBranchVisibility,
  type ViewSubTabId,
} from "@/lib/staff-branch-nav";

const BRANCH_KEY = "mortgage-hub:staff-branch";
const CUSTOMERS_SUB_KEY = "mortgage-hub:staff-customers-sub";
const MANAGEMENT_SUB_KEY = "mortgage-hub:staff-management-sub";
const VIEW_SUB_KEY = "mortgage-hub:staff-view-sub";

function readStorage(key: string): string | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStaffNavStorage(
  branch: StaffBranchId,
  extras?: {
    customersSub?: CustomersSubTabId;
    managementSub?: ManagementSubTabId;
    viewSub?: ViewSubTabId;
  },
): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(BRANCH_KEY, branch);
    if (extras?.customersSub) sessionStorage.setItem(CUSTOMERS_SUB_KEY, extras.customersSub);
    if (extras?.managementSub) sessionStorage.setItem(MANAGEMENT_SUB_KEY, extras.managementSub);
    if (extras?.viewSub) sessionStorage.setItem(VIEW_SUB_KEY, extras.viewSub);
  } catch {
    /* ignore */
  }
}

/** Restore branch/sub-tab after reload when view-as is active. */
export function resolveStaffBranchDefault(vis: StaffBranchVisibility): StaffBranchId {
  if (getAdvisorView() || getIntroducerView() || getCustomerView()) {
    if (vis.branches.management) return STAFF_BRANCHES.MANAGEMENT;
  }
  const stored = readStorage(BRANCH_KEY) as StaffBranchId | null;
  if (stored === STAFF_BRANCHES.CUSTOMERS && vis.branches.customers) return stored;
  if (stored === STAFF_BRANCHES.DIARY && vis.branches.diary) return stored;
  if (stored === STAFF_BRANCHES.MANAGEMENT && vis.branches.management) return stored;
  if (stored === STAFF_BRANCHES.MARKETING && vis.branches.marketing) return stored;
  if (stored === STAFF_BRANCHES.FINANCE && vis.branches.finance) return stored;
  if (stored === STAFF_BRANCHES.INTRODUCERS && vis.branches.introducers) return stored;
  if (vis.branches.customers) return STAFF_BRANCHES.CUSTOMERS;
  if (vis.branches.diary) return STAFF_BRANCHES.DIARY;
  if (vis.branches.management) return STAFF_BRANCHES.MANAGEMENT;
  if (vis.branches.marketing) return STAFF_BRANCHES.MARKETING;
  if (vis.branches.introducers) return STAFF_BRANCHES.INTRODUCERS;
  return STAFF_BRANCHES.FINANCE;
}

export function resolveCustomersSubDefault(vis: StaffBranchVisibility): CustomersSubTabId {
  const stored = readStorage(CUSTOMERS_SUB_KEY) as CustomersSubTabId | null;
  if (stored === CUSTOMERS_SUB_TABS.LIST && vis.customers.list) return stored;
  if (stored === CUSTOMERS_SUB_TABS.CONTACTS && vis.customers.contacts) return stored;
  if (stored === CUSTOMERS_SUB_TABS.RELATIONSHIP && vis.customers.relationship) return stored;
  if (vis.customers.list) return CUSTOMERS_SUB_TABS.LIST;
  if (vis.customers.contacts) return CUSTOMERS_SUB_TABS.CONTACTS;
  return CUSTOMERS_SUB_TABS.RELATIONSHIP;
}

export function resolveManagementSubDefault(
  vis: StaffBranchVisibility,
  opts?: { showViewTab?: boolean },
): ManagementSubTabId {
  const inViewAs = Boolean(getAdvisorView() || getIntroducerView() || getCustomerView());
  if (inViewAs && vis.management.view && opts?.showViewTab !== false) {
    return MANAGEMENT_SUB_TABS.VIEW;
  }
  const stored = readStorage(MANAGEMENT_SUB_KEY) as ManagementSubTabId | null;
  if (stored === MANAGEMENT_SUB_TABS.ANALYTICS && vis.management.analytics) return stored;
  if (stored === MANAGEMENT_SUB_TABS.VIEW && vis.management.view && opts?.showViewTab !== false) return stored;
  if (stored === MANAGEMENT_SUB_TABS.MANAGE && vis.management.manage) return stored;
  if (stored === MANAGEMENT_SUB_TABS.ADMIN_ACCESS && vis.management.adminAccess) return stored;
  if (vis.management.analytics) return MANAGEMENT_SUB_TABS.ANALYTICS;
  if (vis.management.view && opts?.showViewTab !== false) return MANAGEMENT_SUB_TABS.VIEW;
  if (vis.management.manage) return MANAGEMENT_SUB_TABS.MANAGE;
  return MANAGEMENT_SUB_TABS.ADMIN_ACCESS;
}

/** Persist Management → View after entering view-as mode (survives reload). */
export function persistViewAsNav(viewSub: ViewSubTabId): void {
  writeStaffNavStorage(STAFF_BRANCHES.MANAGEMENT, {
    managementSub: MANAGEMENT_SUB_TABS.VIEW,
    viewSub,
  });
}

export function resolveViewSubDefault(vis: StaffBranchVisibility): ViewSubTabId {
  const advisor = getAdvisorView();
  const introducer = getIntroducerView();
  const customer = getCustomerView();
  if (advisor && vis.view.advisor) return VIEW_SUB_TABS.ADVISOR;
  if (introducer && vis.view.introducer) return VIEW_SUB_TABS.INTRODUCER;
  if (customer && vis.view.customer) return VIEW_SUB_TABS.CUSTOMER;
  const stored = readStorage(VIEW_SUB_KEY) as ViewSubTabId | null;
  if (stored === VIEW_SUB_TABS.ADVISOR && vis.view.advisor) return stored;
  if (stored === VIEW_SUB_TABS.INTRODUCER && vis.view.introducer) return stored;
  if (stored === VIEW_SUB_TABS.CUSTOMER && vis.view.customer) return stored;
  if (vis.view.advisor) return VIEW_SUB_TABS.ADVISOR;
  if (vis.view.introducer) return VIEW_SUB_TABS.INTRODUCER;
  return VIEW_SUB_TABS.CUSTOMER;
}
