/**
 * G7C platform dashboard — static / synthetic checks.
 * No secrets. No network. No staging/production queries.
 * No platform_roles / tenant_memberships / Auth writes.
 * Run: npx tsx scripts/g7c-platform-dashboard-verify.mjs
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePlatformAuthorityFromRoles } from "../src/lib/platform-authority.ts";
import {
  ENTER_TENANT_FORBIDDEN_IDENTIFIERS,
  TENANT_ACCESS_AVAILABLE,
  TENANT_ACCESS_FUTURE_LABEL,
  buildPlatformCompanyDetailPath,
  companyMayBeInspected,
  createCompanyRequiresSuperOwner,
  dashboardPayloadContainsPii,
  emptyDashboard,
  filterTenantsForScope,
  isPlatformNavActive,
  isValidCompanyCodeParam,
  presentPlatformAuditEvent,
  resolveCompanySummaryByCode,
  resolveVisibleTenantScope,
  summariseDashboard,
  tenantTypePresentation,
  PLATFORM_NAV_ITEMS,
} from "../src/lib/platform-dashboard.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
function ok(name, cond, detail = "") {
  if (cond) console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(name);
  }
}

function read(rel) {
  return readFileSync(resolve(root, rel), "utf8");
}

function exists(rel) {
  return existsSync(resolve(root, rel));
}

const PLATFORM_FILES = [
  "src/routes/platform/route.tsx",
  "src/routes/platform/index.tsx",
  "src/routes/platform/companies.tsx",
  "src/routes/platform/companies.index.tsx",
  "src/routes/platform/companies.$companyCode.tsx",
  "src/routes/platform/tenants.tsx",
  "src/routes/platform/admins.tsx",
  "src/routes/platform/audit.tsx",
  "src/components/platform/PlatformShell.tsx",
  "src/lib/platform-dashboard.ts",
  "src/lib/platform-dashboard.server.ts",
];

for (const file of PLATFORM_FILES) {
  ok(`file_${file.replace(/[^\w]+/g, "_")}`, exists(file));
}

ok(
  "route_structure",
  PLATFORM_NAV_ITEMS.map((item) => item.id).join(",") === "overview,companies,admins,audit",
);
ok("nav_overview", PLATFORM_NAV_ITEMS[0].to === "/platform");
ok("nav_companies", PLATFORM_NAV_ITEMS[1].to === "/platform/companies");
ok("nav_admins", PLATFORM_NAV_ITEMS[2].to === "/platform/admins");
ok("nav_audit", PLATFORM_NAV_ITEMS[3].to === "/platform/audit");
ok("nav_active_overview_exact", isPlatformNavActive("/platform", "overview"));
ok("nav_active_overview_not_companies", !isPlatformNavActive("/platform/companies", "overview"));
ok("nav_active_companies_detail", isPlatformNavActive("/platform/companies/001", "companies"));
ok("nav_active_create_company", isPlatformNavActive("/platform/tenants", "companies"));
ok("nav_active_admins", isPlatformNavActive("/platform/admins", "admins"));
ok("nav_active_audit", isPlatformNavActive("/platform/audit", "audit"));

const so = resolvePlatformAuthorityFromRoles({ userId: "user-so", roles: ["super_owner"] });
const sa = resolvePlatformAuthorityFromRoles({ userId: "user-sa", roles: ["super_admin"] });
const owner001 = resolvePlatformAuthorityFromRoles({ userId: "owner-001", roles: ["owner"] });
const owner002 = resolvePlatformAuthorityFromRoles({ userId: "owner-002", roles: ["owner"] });
const adviser = resolvePlatformAuthorityFromRoles({ userId: "adviser", roles: ["adviser", "advisor"] });
const introducer = resolvePlatformAuthorityFromRoles({ userId: "introducer", roles: ["introducer"] });
const customer = resolvePlatformAuthorityFromRoles({ userId: "customer", roles: ["customer"] });
const globalAdmin = resolvePlatformAuthorityFromRoles({ userId: "global-admin", roles: ["admin"] });

ok("so_platform_allowed", so.canAccessPlatform && so.isSuperOwner && so.canCreateCompany);
ok("001_owner_platform_denied", !owner001.canAccessPlatform);
ok("002_owner_platform_denied", !owner002.canAccessPlatform);
ok("adviser_platform_denied", !adviser.canAccessPlatform);
ok("introducer_platform_denied", !introducer.canAccessPlatform);
ok("customer_platform_denied", !customer.canAccessPlatform);
ok("global_admin_platform_denied", !globalAdmin.canAccessPlatform);

ok("so_scope_all", resolveVisibleTenantScope(so) === "all");
ok("sa_scope_granted", resolveVisibleTenantScope(sa) === "granted");
ok("owner_scope_none", resolveVisibleTenantScope(owner001) === "none");

const tenants = [
  { id: "t1", companyCode: "001", companyName: "Mortgage Easy", slug: "mortgageeasy", tenantType: "GROUP", status: "active" },
  { id: "t2", companyCode: "002", companyName: "Trent Valley Financial Services", slug: "trentvalleyfs", tenantType: "GROUP", status: "active" },
  { id: "t3", companyCode: "003", companyName: "External Demo", slug: "externaldemo", tenantType: "EXTERNAL", status: "provisioning" },
];
const memberships = [
  { tenantId: "t1", role: "owner", active: true },
  { tenantId: "t1", role: "adviser", active: true },
  { tenantId: "t1", role: "customer", active: true },
  { tenantId: "t2", role: "owner", active: true },
  { tenantId: "t3", role: "owner", active: false },
];

const soDash = summariseDashboard({
  tenants: filterTenantsForScope(tenants, "all", []),
  memberships,
  scope: "all",
});
ok("total_companies", soDash.totalCompanies === 3);
ok("group_companies", soDash.groupCompanies === 2);
ok("external_companies", soDash.externalCompanies === 1);
ok("active_companies", soDash.activeCompanies === 2);
ok("active_membership_count", soDash.totalActiveMemberships === 4);
ok("role_aggregates_owners", soDash.roleCounts.owner === 2);
ok("role_aggregates_advisers", soDash.roleCounts.adviser === 1);
ok("role_aggregates_customers", soDash.roleCounts.customer === 1);
ok("company_001_present", soDash.companies.some((row) => row.companyCode === "001" && row.slug === "mortgageeasy"));
ok("company_002_present", soDash.companies.some((row) => row.companyCode === "002" && row.slug === "trentvalleyfs"));
ok("no_hardcoded_names_in_dashboard_lib", !read("src/lib/platform-dashboard.ts").includes("Mortgage Easy"));
ok("no_hardcoded_names_in_dashboard_server", !read("src/lib/platform-dashboard.server.ts").includes("Mortgage Easy"));

const saNone = summariseDashboard({
  tenants: filterTenantsForScope(tenants, "granted", []),
  memberships: [],
  scope: "granted",
});
ok("sa_no_grant_all_tenants_denied", saNone.totalCompanies === 0 && saNone.companies.length === 0);
ok("sa_no_grant_cannot_inspect", companyMayBeInspected("t1", "granted", []) === false);

const saOne = summariseDashboard({
  tenants: filterTenantsForScope(tenants, "granted", ["t2"]),
  memberships: memberships.filter((row) => row.tenantId === "t2"),
  scope: "granted",
});
ok("sa_grant_scoped", saOne.totalCompanies === 1 && saOne.companies[0]?.companyCode === "002");
ok("sa_cannot_see_ungranted", !saOne.companies.some((row) => row.companyCode === "001"));

ok("create_company_so_only", createCompanyRequiresSuperOwner(so) && !createCompanyRequiresSuperOwner(sa));
ok("create_company_authority_unchanged", so.canCreateCompany && !sa.canCreateCompany);

const tenantsSrc = read("src/routes/platform/tenants.tsx");
ok("create_company_route_preserved", tenantsSrc.includes("CreateCompanyWizard") && tenantsSrc.includes("canCreateCompany"));
const provisionSrc = read("src/lib/company-provisioning.server.ts");
ok(
  "create_company_still_so_gated",
  provisionSrc.includes("requirePlatformProvisioningAuthority") && provisionSrc.includes("listPlatformCompanies"),
);
ok("authority_resolver_unchanged_list", so.canListPlatformTenants && !sa.canListPlatformTenants);

const group = tenantTypePresentation("GROUP");
const external = tenantTypePresentation("EXTERNAL");
ok("group_caption", group.caption === "Managed in group");
ok("external_caption_platform_managed", external.caption === "Platform managed");
ok("external_not_operational", !external.hint.toLowerCase().includes("operational access"));
ok("group_external_distinct", group.caption !== external.caption);

ok("tenant_access_g7d_enabled_flag", TENANT_ACCESS_AVAILABLE === true);
ok(
  "tenant_access_future_label_retained_for_docs",
  TENANT_ACCESS_FUTURE_LABEL.includes("Audited access not yet enabled"),
);

const dashServer = read("src/lib/platform-dashboard.server.ts");
ok("dashboard_requires_auth", dashServer.includes("requireSupabaseAuth"));
ok("dashboard_requires_platform_authority", dashServer.includes("requirePlatformRouteAccess"));
ok("dashboard_uses_grant_table", dashServer.includes("super_admin_tenant_access"));
ok("dashboard_uses_memberships_counts", dashServer.includes("tenant_memberships") && dashServer.includes("tenant_id, role"));
ok("dashboard_no_customers_table", !dashServer.includes('.from("customers")'));
ok("dashboard_no_cases_table", !dashServer.includes('.from("cases")'));
ok("dashboard_no_sessions_table", !dashServer.includes('.from("sessions")'));
ok("dashboard_no_documents_table", !dashServer.includes('.from("documents")'));
ok("dashboard_no_messages_table", !dashServer.includes('.from("messages")'));
ok("dashboard_selects_no_user_id_from_memberships", !/tenant_memberships[\s\S]{0,180}user_id/.test(dashServer));

const piiPayload = summariseDashboard({
  tenants: filterTenantsForScope(tenants, "all", []),
  memberships: memberships.filter((row) => row.active !== false),
  scope: "all",
});
ok("dashboard_payload_no_pii", dashboardPayloadContainsPii(piiPayload) === false);
ok(
  "pii_detector_catches_email",
  dashboardPayloadContainsPii({ email: "a@b.com" }) === true,
);
ok(
  "pii_detector_catches_customer_name",
  dashboardPayloadContainsPii({ customer_name: "Jane" }) === true,
);

const auditRow = presentPlatformAuditEvent({
  occurredAt: "2026-09-21T12:00:00.000Z",
  eventType: "TENANT_CREATED",
  actingUserId: "f8c24260-fe31-4277-9589-d4000e18a782",
  companyName: "Mortgage Easy",
  companyCode: "001",
  metadata: {
    companyCode: "001",
    slug: "mortgageeasy",
    tenantType: "GROUP",
    token: "secret-invite",
    ownerEmail: "owner@example.test",
  },
});
ok("audit_label_safe", auditRow.eventLabel === "Company created");
ok("audit_actor_not_uuid", auditRow.actorLabel === "Platform user" && !auditRow.actorLabel.includes("f8c24260"));
ok("audit_no_token", !auditRow.description.includes("secret-invite"));
ok("audit_no_email", !auditRow.description.includes("@"));
ok("audit_company_label", auditRow.companyLabel === "Mortgage Easy (001)");

const auditSrc = read("src/routes/platform/audit.tsx");
ok("audit_ui_created", auditSrc.includes("listPlatformAuditEvents"));
ok(
  "audit_no_raw_metadata",
  !auditSrc.includes("JSON.stringify") && !auditSrc.includes("event.metadata") && !auditSrc.includes("raw metadata blob"),
);
ok("audit_schema_sufficient", dashServer.includes("security_audit_events"));

const adminsSrc = read("src/routes/platform/admins.tsx");
ok(
  "admins_page_live",
  adminsSrc.includes("Platform Administrators") && adminsSrc.includes("Add platform administrator"),
);
ok(
  "admins_no_grant_ui",
  !adminsSrc.includes("super_admin_tenant_access") &&
    !adminsSrc.includes("Grant:") &&
    adminsSrc.includes("No grants configured"),
);
const g7cFiles = [
  "src/routes/platform/route.tsx",
  "src/routes/platform/index.tsx",
  "src/routes/platform/companies.tsx",
  "src/routes/platform/companies.index.tsx",
  "src/routes/platform/companies.$companyCode.tsx",
  "src/routes/platform/tenants.tsx",
  "src/routes/platform/admins.tsx",
  "src/routes/platform/audit.tsx",
  "src/components/platform/PlatformShell.tsx",
  "src/lib/platform-dashboard.server.ts",
  "src/components/platform/PlatformCompanyViews.tsx",
];
const forbiddenFn = new RegExp(
  ENTER_TENANT_FORBIDDEN_IDENTIFIERS.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
  "i",
);
for (const file of g7cFiles) {
  const src = read(file);
  ok(
    `no_enter_tenant_${file.replace(/[^\w]+/g, "_")}`,
    !forbiddenFn.test(src) && !src.includes("View As Tenant") && !src.includes("Impersonate"),
  );
}
ok(
  "enter_uses_audited_platform_session",
  TENANT_ACCESS_AVAILABLE === true &&
    read("src/components/platform/PlatformCompanyViews.tsx").includes("startPlatformTenantEntry"),
);

const shell = read("src/components/platform/PlatformShell.tsx");
ok("shell_platform_title", shell.includes("Platform Administration") && shell.includes("Mortgage Hub"));
ok("shell_test_environment", shell.includes("TEST ENVIRONMENT"));
ok("shell_sign_out", shell.includes("Sign out") && shell.includes("signOut"));
ok("shell_no_tenant_gate", !shell.includes("TenantAuthenticatedGate") && !shell.includes("checkTenantMembership"));
ok("shell_no_tenant_nav", !shell.includes("mortgageeasy") && !shell.includes("trentvalleyfs"));
ok("shell_responsive_wrap", shell.includes("flex-wrap") && shell.includes("sm:flex-row"));
ok("shell_uses_platform_authority", shell.includes("getMyPlatformAuthority"));

const companyViews = read("src/components/platform/PlatformCompanyViews.tsx");
ok("company_metadata_name", companyViews.includes("companyName") && companyViews.includes("companyCode"));
ok("company_metadata_slug", companyViews.includes("slug"));
ok("company_metadata_type", companyViews.includes("tenantType"));
ok("company_metadata_status", companyViews.includes("status"));
ok("company_metadata_members", companyViews.includes("activeMemberCount"));
ok("company_detail_created", companyViews.includes("createdAt"));
ok("company_detail_features", companyViews.includes("features"));
ok(
  "group_external_visual",
  companyViews.includes("TenantTypeBadge") && read("src/lib/platform-dashboard.ts").includes("Platform managed"),
);
ok(
  "enter_company_confirmation_control",
  companyViews.includes("Enter company") &&
    companyViews.includes("startPlatformTenantEntry") &&
    companyViews.includes("confirmed: true"),
);

ok("empty_dashboard_closed", emptyDashboard("none").totalCompanies === 0);

ok("authority_file_not_rewritten_for_sa_list", read("src/lib/platform-authority.ts").includes("canListPlatformTenants: isSuperOwner"));
ok("no_g7c_migration", !exists("supabase/migrations/20260922120000_gate_g7c_platform_dashboard.sql"));

const platformDir = readdirSync(resolve(root, "src/routes/platform"));
ok("platform_admins_route_file", platformDir.includes("admins.tsx"));
ok("platform_audit_route_file", platformDir.includes("audit.tsx"));
ok("platform_companies_route_file", platformDir.includes("companies.tsx"));
ok("platform_companies_index_route_file", platformDir.includes("companies.index.tsx"));
ok("platform_company_detail_route_file", platformDir.includes("companies.$companyCode.tsx"));
ok("companies_layout_has_outlet", read("src/routes/platform/companies.tsx").includes("Outlet"));

// Runtime contract: list identifier → route → param → tenants.company_code lookup
const detailRouteSrc = read("src/routes/platform/companies.$companyCode.tsx");
const companyViewsSrc = read("src/components/platform/PlatformCompanyViews.tsx");
const dashServerSrc = read("src/lib/platform-dashboard.server.ts");
ok(
  "detail_link_uses_company_code",
  companyViewsSrc.includes('to="/platform/companies/$companyCode"') &&
    companyViewsSrc.includes("params={{ companyCode: company.companyCode }}"),
);
ok(
  "detail_call_wraps_server_fn_data",
  detailRouteSrc.includes("detailFn({ data: { companyCode } })") &&
    !detailRouteSrc.includes("detailFn({ companyCode })"),
);
ok(
  "detail_lookup_field_is_company_code",
  dashServerSrc.includes('.eq("company_code", code)') ||
    dashServerSrc.includes('.eq("company_code", data.companyCode)'),
);
ok("detail_lookup_not_by_slug", !/eq\("slug"/.test(dashServerSrc));
ok("detail_lookup_not_by_uuid_param", !detailRouteSrc.includes("tenantId"));
ok("detail_path_001", buildPlatformCompanyDetailPath("001") === "/platform/companies/001");
ok("detail_path_002", buildPlatformCompanyDetailPath("002") === "/platform/companies/002");
ok("detail_path_future_003", buildPlatformCompanyDetailPath("003") === "/platform/companies/003");
ok("company_code_param_valid_001", isValidCompanyCodeParam("001"));
ok("company_code_param_valid_002", isValidCompanyCodeParam("002"));
ok("company_code_param_rejects_slug", !isValidCompanyCodeParam("mortgageeasy"));
ok("company_code_param_rejects_uuid", !isValidCompanyCodeParam("f8c24260-fe31-4277-9589-d4000e18a782"));

const fixtureCompanies = soDash.companies;
const me001 = resolveCompanySummaryByCode(fixtureCompanies, "001");
const tv002 = resolveCompanySummaryByCode(fixtureCompanies, "002");
const unknown999 = resolveCompanySummaryByCode(fixtureCompanies, "999");
ok(
  "mortgage_easy_001_resolves",
  me001?.companyName === "Mortgage Easy" &&
    me001.slug === "mortgageeasy" &&
    me001.companyCode === "001",
);
ok(
  "trent_valley_002_resolves",
  tv002?.companyName === "Trent Valley Financial Services" &&
    tv002.slug === "trentvalleyfs" &&
    tv002.companyCode === "002",
);
ok("unknown_code_fails_closed", unknown999 === null);
ok(
  "detail_result_shape_safe",
  dashServerSrc.includes("PlatformCompanyDetailResult") &&
    dashServerSrc.includes('reason: "not_found"') &&
    dashServerSrc.includes('reason: "unauthorized"') &&
    dashServerSrc.includes('reason: "query_failure"'),
);
ok(
  "detail_ui_uses_safe_failure_message",
  detailRouteSrc.includes("companyDetailFailureMessage") &&
    !detailRouteSrc.includes("error.message"),
);

if (failures.length) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log("\nG7C platform dashboard verify PASS");
