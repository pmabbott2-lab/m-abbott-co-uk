/**
 * G7C platform dashboard — pure helpers.
 * Metadata + aggregate counts only. No enter-tenant. No authority changes.
 */
import type { PlatformAuthorityView } from "@/lib/platform-authority";
import { sanitisePlatformAuditMetadata } from "@/lib/platform-audit";

export const PLATFORM_NAV_ITEMS = [
  { id: "overview", to: "/platform", label: "Overview" },
  { id: "companies", to: "/platform/companies", label: "Companies" },
  { id: "admins", to: "/platform/admins", label: "Admins" },
  { id: "audit", to: "/platform/audit", label: "Audit" },
] as const;

export type PlatformNavId = (typeof PLATFORM_NAV_ITEMS)[number]["id"];

export const TENANT_MEMBER_ROLES = [
  "owner",
  "supervisor",
  "general",
  "adviser",
  "introducer",
  "customer",
] as const;

export type TenantMemberRole = (typeof TENANT_MEMBER_ROLES)[number];

export const TENANT_MEMBER_ROLE_LABELS: Record<TenantMemberRole, string> = {
  owner: "Owners",
  supervisor: "Supervisors",
  general: "General",
  adviser: "Advisers",
  introducer: "Introducers",
  customer: "Customers",
};

export type VisibleTenantScope = "all" | "granted" | "none";

export type PlatformTenantType = "GROUP" | "EXTERNAL";

export type PlatformCompanySummary = {
  companyCode: string;
  companyName: string;
  tradingName: string | null;
  slug: string;
  tenantType: PlatformTenantType;
  status: string;
  activeMemberCount: number;
};

export type PlatformCompanyDetail = PlatformCompanySummary & {
  createdAt: string | null;
  features: { key: string; name: string; state: string }[];
  config: {
    settingsPresent: boolean;
    brandingPresent: boolean;
    enabledFeatureCount: number;
  };
};

/** Safe client-facing reason codes for company detail load failures. */
export type PlatformCompanyDetailFailureReason =
  | "not_found"
  | "unauthorized"
  | "invalid_code"
  | "query_failure";

export type PlatformCompanyDetailResult =
  | { ok: true; company: PlatformCompanyDetail }
  | { ok: false; reason: PlatformCompanyDetailFailureReason };

export const COMPANY_CODE_PARAM_PATTERN = /^[0-9]{3}$/;

/** Company list identifier → detail URL segment (must match route param). */
export function buildPlatformCompanyDetailPath(companyCode: string): string {
  return `/platform/companies/${companyCode}`;
}

export function isValidCompanyCodeParam(value: string | null | undefined): boolean {
  return typeof value === "string" && COMPANY_CODE_PARAM_PATTERN.test(value.trim());
}

/**
 * Resolve a company from list/overview rows by company_code.
 * Lookup field is companyCode (maps to tenants.company_code), never slug or UUID.
 */
export function resolveCompanySummaryByCode(
  companies: readonly PlatformCompanySummary[],
  companyCode: string,
): PlatformCompanySummary | null {
  const code = companyCode.trim();
  if (!isValidCompanyCodeParam(code)) return null;
  return companies.find((row) => row.companyCode === code) ?? null;
}

export function companyDetailFailureMessage(reason: PlatformCompanyDetailFailureReason): string {
  if (reason === "not_found") return "Company not found or not in your platform scope.";
  if (reason === "unauthorized") return "You do not have platform access to this company.";
  if (reason === "invalid_code") return "That company code is not valid.";
  return "Could not load company.";
}

export type PlatformRoleCounts = Record<TenantMemberRole, number>;

export type PlatformDashboardOverview = {
  totalCompanies: number;
  groupCompanies: number;
  externalCompanies: number;
  activeCompanies: number;
  totalActiveMemberships: number;
  roleCounts: PlatformRoleCounts;
  scope: VisibleTenantScope;
  companies: PlatformCompanySummary[];
};

export type PlatformAuditListItem = {
  occurredAt: string;
  eventType: string;
  eventLabel: string;
  companyLabel: string | null;
  actorLabel: string;
  description: string;
};

export const TENANT_ACCESS_FUTURE_LABEL = "Tenant access — Audited access not yet enabled";
export const TENANT_ACCESS_AVAILABLE = true;
export const EXTERNAL_ENTRY_REQUIRES_GRANT_COPY =
  "Operational access requires an authorised support or emergency grant.";

export const ADMINS_PLACEHOLDER_COPY =
  "Platform administrator management is not yet enabled. Super Admin grants will be available in a later phase.";

export function emptyRoleCounts(): PlatformRoleCounts {
  return {
    owner: 0,
    supervisor: 0,
    general: 0,
    adviser: 0,
    introducer: 0,
    customer: 0,
  };
}

export function resolveVisibleTenantScope(auth: {
  isSuperOwner: boolean;
  isSuperAdmin: boolean;
  canAccessPlatform: boolean;
}): VisibleTenantScope {
  if (!auth.canAccessPlatform) return "none";
  if (auth.isSuperOwner) return "all";
  if (auth.isSuperAdmin) return "granted";
  return "none";
}

export function filterTenantsForScope<T extends { id: string }>(
  tenants: readonly T[],
  scope: VisibleTenantScope,
  grantedTenantIds: readonly string[],
): T[] {
  if (scope === "none") return [];
  if (scope === "all") return [...tenants];
  const granted = new Set(grantedTenantIds);
  return tenants.filter((tenant) => granted.has(tenant.id));
}

export function companyMayBeInspected(
  tenantId: string,
  scope: VisibleTenantScope,
  grantedTenantIds: readonly string[],
): boolean {
  if (scope === "none") return false;
  if (scope === "all") return true;
  return grantedTenantIds.includes(tenantId);
}

export function isPlatformTenantType(value: string): value is PlatformTenantType {
  return value === "GROUP" || value === "EXTERNAL";
}

export function tenantTypePresentation(type: PlatformTenantType): {
  label: string;
  caption: string;
  hint: string;
} {
  if (type === "GROUP") {
    return {
      label: "GROUP",
      caption: "Managed in group",
      hint: "Businesses managed within the group. Platform metadata is visible here. Operational entry is a later audited action.",
    };
  }
  return {
    label: "EXTERNAL",
    caption: "Platform managed",
    hint: "Independently licensed Mortgage Hub businesses. Platform metadata only — not an operational workspace.",
  };
}

export function countActiveMembers(
  memberships: readonly { tenantId: string; role: string; active?: boolean }[],
  tenantId: string,
): number {
  return memberships.filter((row) => row.tenantId === tenantId && row.active !== false).length;
}

export function aggregateRoleCounts(
  memberships: readonly { role: string; active?: boolean }[],
): PlatformRoleCounts {
  const counts = emptyRoleCounts();
  for (const row of memberships) {
    if (row.active === false) continue;
    if ((TENANT_MEMBER_ROLES as readonly string[]).includes(row.role)) {
      counts[row.role as TenantMemberRole] += 1;
    }
  }
  return counts;
}

export function summariseDashboard(input: {
  tenants: readonly {
    id: string;
    tenantType: PlatformTenantType;
    status: string;
    companyCode: string;
    companyName: string;
    tradingName?: string | null;
    slug: string;
  }[];
  memberships: readonly { tenantId: string; role: string; active?: boolean }[];
  scope: VisibleTenantScope;
}): PlatformDashboardOverview {
  const companies: PlatformCompanySummary[] = input.tenants.map((tenant) => ({
    companyCode: tenant.companyCode,
    companyName: tenant.companyName,
    tradingName: tenant.tradingName ?? null,
    slug: tenant.slug,
    tenantType: tenant.tenantType,
    status: tenant.status,
    activeMemberCount: countActiveMembers(input.memberships, tenant.id),
  }));
  return {
    totalCompanies: companies.length,
    groupCompanies: companies.filter((row) => row.tenantType === "GROUP").length,
    externalCompanies: companies.filter((row) => row.tenantType === "EXTERNAL").length,
    activeCompanies: companies.filter((row) => row.status === "active").length,
    totalActiveMemberships: input.memberships.filter((row) => row.active !== false).length,
    roleCounts: aggregateRoleCounts(input.memberships),
    scope: input.scope,
    companies,
  };
}

export function isPlatformNavActive(pathname: string, itemId: PlatformNavId): boolean {
  const path = pathname.endsWith("/") && pathname !== "/" ? pathname.slice(0, -1) : pathname;
  if (itemId === "overview") return path === "/platform";
  if (itemId === "companies") {
    return path.startsWith("/platform/companies") || path.startsWith("/platform/tenants");
  }
  if (itemId === "admins") return path.startsWith("/platform/admins");
  if (itemId === "audit") return path.startsWith("/platform/audit");
  return false;
}

export const PLATFORM_AUDIT_EVENT_LABELS: Record<string, string> = {
  SUPER_OWNER_ROLE_GRANTED: "Platform role granted",
  SUPER_OWNER_ROLE_REVOKED: "Platform role revoked",
  SUPER_ADMIN_ROLE_GRANTED: "Platform administrator role granted",
  SUPER_ADMIN_ROLE_REVOKED: "Platform administrator role revoked",
  SUPER_ADMIN_TENANT_GRANTED: "Company grant recorded",
  SUPER_ADMIN_TENANT_REVOKED: "Company grant removed",
  TENANT_CREATED: "Company created",
  PLATFORM_TENANT_ENTRY_STARTED: "Tenant entry started",
  PLATFORM_TENANT_ENTRY_ENDED: "Tenant entry ended",
  PLATFORM_TENANT_ENTRY_DENIED: "Tenant entry denied",
  TENANT_OWNER_INVITED: "Company owner invited",
  TENANT_OWNER_ADDED: "Company owner added",
  TENANT_OWNER_REMOVED: "Company owner removed",
  TENANT_OWNER_ROLE_CHANGED: "Company owner role changed",
  LAST_TENANT_OWNER_ACTION_DENIED: "Last company owner action denied",
  PLATFORM_ADMIN_INVITED: "Platform administrator invited",
  PLATFORM_ADMIN_INVITE_CANCELLED: "Platform administrator invitation cancelled",
  PLATFORM_ROLE_GRANTED: "Platform role granted",
  PLATFORM_ROLE_CHANGED: "Platform role changed",
  PLATFORM_ROLE_REVOKED: "Platform role revoked",
  LAST_PLATFORM_OWNER_ACTION_DENIED: "Final Super Owner action denied",
  SUPER_ADMIN_GRANT_CREATED: "Company access granted",
  SUPER_ADMIN_GRANT_CHANGED: "Company access changed",
  SUPER_ADMIN_GRANT_REVOKED: "Company access revoked",
};

const AUDIT_SAFE_META_KEYS = new Set([
  "companyCode",
  "company_code",
  "slug",
  "tenantType",
  "tenant_type",
  "status",
  "role",
  "oldRole",
  "newRole",
  "oldAccess",
  "newAccess",
  "oldExpiry",
  "newExpiry",
  "authorityBasis",
  "accessLevel",
  "reason",
  "action",
  "subjectName",
  "subjectEmail",
]);

export function presentPlatformAuditEvent(input: {
  occurredAt: string;
  eventType: string;
  actingUserId?: string | null;
  companyName?: string | null;
  companyCode?: string | null;
  metadata?: Record<string, unknown> | null;
}): PlatformAuditListItem {
  const safe = sanitisePlatformAuditMetadata(input.metadata);
  const bits: string[] = [];
  for (const [key, value] of Object.entries(safe)) {
    if (!AUDIT_SAFE_META_KEYS.has(key)) continue;
    if (typeof value !== "string" && typeof value !== "number") continue;
    const text = String(value);
    // Allow subjectEmail / subjectName for platform-admin audit rows; still hide UUIDs.
    if (key !== "subjectEmail" && key !== "subjectName") {
      if (looksLikeEmail(text) || looksLikeUuid(text)) continue;
    } else if (looksLikeUuid(text)) {
      continue;
    }
    bits.push(text);
  }
  const companyLabel =
    input.companyName && input.companyCode
      ? `${input.companyName} (${input.companyCode})`
      : input.companyName || input.companyCode || null;
  return {
    occurredAt: input.occurredAt,
    eventType: input.eventType,
    eventLabel: PLATFORM_AUDIT_EVENT_LABELS[input.eventType] ?? "Platform event",
    companyLabel,
    actorLabel: input.actingUserId ? "Platform user" : "System",
    description: bits.join(" · "),
  };
}

const DASHBOARD_PII_KEY =
  /^(email|company_email|full_name|first_name|last_name|phone|telephone|mobile|customer|customer_id|customer_name|case|case_id|mortgage|outstanding|sort_code|account_number|iban|bank|message|communication|document|address|dob|date_of_birth|ni_number|invite_token|password|secret|token)$/i;

export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

export function dashboardPayloadContainsPii(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") {
    return looksLikeEmail(value);
  }
  if (Array.isArray(value)) {
    return value.some(dashboardPayloadContainsPii);
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (DASHBOARD_PII_KEY.test(key) && typeof child !== "number") return true;
      if (dashboardPayloadContainsPii(child)) return true;
    }
  }
  return false;
}

export function emptyDashboard(scope: VisibleTenantScope = "none"): PlatformDashboardOverview {
  return {
    totalCompanies: 0,
    groupCompanies: 0,
    externalCompanies: 0,
    activeCompanies: 0,
    totalActiveMemberships: 0,
    roleCounts: emptyRoleCounts(),
    scope,
    companies: [],
  };
}

/** Used by tests — G7C must not implement these. */
export const ENTER_TENANT_FORBIDDEN_IDENTIFIERS = [
  "enterTenant",
  "enter-tenant",
  "impersonate",
  "viewAsTenant",
  "assumeTenant",
  "assume_tenant",
] as const;

export function createCompanyRequiresSuperOwner(auth: Pick<PlatformAuthorityView, "canCreateCompany" | "isSuperOwner">): boolean {
  return auth.canCreateCompany === true && auth.isSuperOwner === true;
}
