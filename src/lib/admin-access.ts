/** Admin levels and permission keys for Mortgage Hub staff access control. */

export type AdminLevel = "owner" | "supervisor" | "general";

export const ADMIN_LEVEL_LABELS: Record<AdminLevel, string> = {
  owner: "Owner Admin",
  supervisor: "Admin Supervisor",
  general: "General Admin",
};

export type PermissionAccess = "none" | "view" | "amend";

export const PERMISSION_KEYS = [
  "customers",
  "advisors",
  "introducers",
  "introducer_amend",
  "allocations",
  "raf",
  "invites",
  "appointments",
  "journey",
  "users_roles",
  "admin_access",
  "finance_customer",
  "finance_advisor_pct",
  "finance_introducer_pct",
  "finance_raf",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  customers: "Customers",
  advisors: "Advisors",
  introducers: "Introducers",
  introducer_amend: "Introducer amend (customer)",
  allocations: "Fact-find allocations",
  raf: "RAF / referrals",
  invites: "Staff invite links",
  appointments: "Appointments & call-backs",
  journey: "Journey milestones",
  users_roles: "Users & roles (view)",
  admin_access: "Admin permissions matrix",
  finance_customer: "Finance — customer fees",
  finance_advisor_pct: "Finance — advisor commission %",
  finance_introducer_pct: "Finance — introducer commission %",
  finance_raf: "Finance — RAF commission highlight",
};

/** Defaults applied when promoting someone to general admin. */
export const DEFAULT_GENERAL_PERMISSIONS: Record<PermissionKey, PermissionAccess> = {
  customers: "amend",
  advisors: "none",
  introducers: "none",
  introducer_amend: "none",
  allocations: "view",
  raf: "none",
  invites: "none",
  appointments: "amend",
  journey: "amend",
  users_roles: "view",
  admin_access: "none",
  finance_customer: "none",
  finance_advisor_pct: "none",
  finance_introducer_pct: "none",
  finance_raf: "none",
};

export type AdminAccess = {
  isAdmin: boolean;
  adminLevel: AdminLevel | null;
  isOwner: boolean;
  isSupervisor: boolean;
  /** Owner and supervisor always true for every key; general uses matrix. */
  permissions: Record<PermissionKey, PermissionAccess>;
};

export function emptyPermissions(): Record<PermissionKey, PermissionAccess> {
  return Object.fromEntries(PERMISSION_KEYS.map((k) => [k, "none"])) as Record<
    PermissionKey,
    PermissionAccess
  >;
}

export function fullPermissions(): Record<PermissionKey, PermissionAccess> {
  return Object.fromEntries(PERMISSION_KEYS.map((k) => [k, "amend"])) as Record<
    PermissionKey,
    PermissionAccess
  >;
}

export function canView(access: AdminAccess | null | undefined, key: PermissionKey): boolean {
  if (!access?.isAdmin) return false;
  if (access.isOwner || access.isSupervisor) return true;
  const a = access.permissions[key];
  return a === "view" || a === "amend";
}

export function canAmend(access: AdminAccess | null | undefined, key: PermissionKey): boolean {
  if (!access?.isAdmin) return false;
  if (access.isOwner || access.isSupervisor) return true;
  return access.permissions[key] === "amend";
}

/** Finance transaction report is owner-only. */
export function canViewFinanceReport(access: AdminAccess | null | undefined): boolean {
  return Boolean(access?.isOwner);
}

/** Commission payout queue (advisor / introducer / RAF). */
export function canViewCommissionPayouts(access: AdminAccess | null | undefined): boolean {
  if (!access?.isAdmin) return false;
  if (access.isOwner || access.isSupervisor) return true;
  return (
    canView(access, "finance_raf") ||
    canView(access, "finance_advisor_pct") ||
    canView(access, "finance_introducer_pct")
  );
}

export function canAmendCommissionPayouts(access: AdminAccess | null | undefined): boolean {
  if (!access?.isAdmin) return false;
  if (access.isOwner || access.isSupervisor) return true;
  return (
    canAmend(access, "finance_raf") ||
    canAmend(access, "finance_advisor_pct") ||
    canAmend(access, "finance_introducer_pct")
  );
}

/** Owner-only history amend. */
export function canAmendHistory(access: AdminAccess | null | undefined): boolean {
  return Boolean(access?.isOwner);
}

/** Amend customer introducer code — owner, supervisor, or general with introducer_amend. */
export function canAmendIntroducer(access: AdminAccess | null | undefined): boolean {
  if (!access?.isAdmin) return false;
  if (access.isOwner || access.isSupervisor) return true;
  return canAmend(access, "introducer_amend");
}

/** Backdate introducer commission after amendment — owner only. */
export function canRefreshIntroducerCommission(access: AdminAccess | null | undefined): boolean {
  return Boolean(access?.isOwner);
}

/** Edit general-admin permission matrix — owner or general admin with admin_access amend. */
export function canEditAdminPermissions(access: AdminAccess | null | undefined): boolean {
  if (!access?.isAdmin) return false;
  if (access.isOwner) return true;
  if (access.isSupervisor) return false;
  return canAmend(access, "admin_access");
}

/** Grant supervisor / general admin levels — owner for supervisor; owner + supervisor for general. */
export function canGrantAdminLevel(
  access: AdminAccess | null | undefined,
  level: "supervisor" | "general",
): boolean {
  if (!access?.isAdmin) return false;
  if (level === "supervisor") return Boolean(access.isOwner);
  return Boolean(access.isOwner || access.isSupervisor);
}

/** Any admin (with journey amend) or advisor can confirm; only admin can reverse. */
export function canReverseJourney(access: AdminAccess | null | undefined): boolean {
  return canAmend(access, "journey");
}
