/**
 * G7C platform dashboard data. Authenticated + platform authority. Fail closed.
 * Super Owner: all tenant metadata. Super Admin: explicit grants only.
 * Never returns customer/case/finance/comms tables.
 */
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdminUntyped as db } from "@/integrations/supabase/client.server";
import { PLATFORM_AUDIT_EVENT_TYPES } from "@/lib/platform-audit";
import { superAdminGrantAllowsVisibility, type PlatformAuthorityView } from "@/lib/platform-authority";
import { PlatformRouteDeniedError, requirePlatformRouteAccess } from "@/lib/platform-authority.server";
import {
  companyMayBeInspected,
  emptyDashboard,
  isPlatformTenantType,
  isValidCompanyCodeParam,
  presentPlatformAuditEvent,
  resolveVisibleTenantScope,
  summariseDashboard,
  type PlatformAuditListItem,
  type PlatformCompanyDetail,
  type PlatformCompanyDetailResult,
  type PlatformDashboardOverview,
  type VisibleTenantScope,
} from "@/lib/platform-dashboard";

type TenantRow = {
  id: string;
  company_code: string;
  slug: string;
  company_name: string;
  trading_name: string | null;
  tenant_type: string;
  status: string;
  created_at: string | null;
};

async function loadGrantedTenantIds(userId: string): Promise<string[]> {
  const { data, error } = await db
    .from("super_admin_tenant_access")
    .select("tenant_id, access_level, revoked_at, expires_at")
    .eq("user_id", userId)
    .is("revoked_at", null);
  if (error) throw new Error(error.message);
  const now = Date.now();
  return (data ?? [])
    .filter((row: { access_level?: string | null; expires_at?: string | null }) => {
      if (!superAdminGrantAllowsVisibility(row.access_level as never)) return false;
      if (!row.expires_at) return true;
      const exp = new Date(row.expires_at).getTime();
      return !Number.isNaN(exp) && now < exp;
    })
    .map((row: { tenant_id: string }) => row.tenant_id);
}

async function loadVisibleTenants(
  userId: string,
  authority: PlatformAuthorityView,
): Promise<{ scope: VisibleTenantScope; tenants: TenantRow[] }> {
  const scope = resolveVisibleTenantScope(authority);
  if (scope === "none") return { scope, tenants: [] };

  if (scope === "granted") {
    const ids = await loadGrantedTenantIds(userId);
    if (ids.length === 0) return { scope, tenants: [] };
    const { data, error } = await db
      .from("tenants")
      .select("id, company_code, slug, company_name, trading_name, tenant_type, status, created_at")
      .in("id", ids)
      .order("company_code");
    if (error) throw new Error(error.message);
    return { scope, tenants: (data ?? []) as TenantRow[] };
  }

  const { data, error } = await db
    .from("tenants")
    .select("id, company_code, slug, company_name, trading_name, tenant_type, status, created_at")
    .order("company_code");
  if (error) throw new Error(error.message);
  return { scope, tenants: (data ?? []) as TenantRow[] };
}

async function loadActiveMemberships(tenantIds: string[]): Promise<{ tenantId: string; role: string }[]> {
  if (tenantIds.length === 0) return [];
  const { data, error } = await db
    .from("tenant_memberships")
    .select("tenant_id, role")
    .eq("active", true)
    .in("tenant_id", tenantIds);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: { tenant_id: string; role: string }) => ({
    tenantId: row.tenant_id,
    role: row.role,
  }));
}

function toSummaryInput(tenants: TenantRow[]) {
  return tenants
    .filter((row) => isPlatformTenantType(row.tenant_type))
    .map((row) => ({
      id: row.id,
      tenantType: row.tenant_type as "GROUP" | "EXTERNAL",
      status: row.status,
      companyCode: row.company_code,
      companyName: row.company_name,
      tradingName: row.trading_name,
      slug: row.slug,
    }));
}

async function loadDashboardOverview(userId: string | undefined): Promise<PlatformDashboardOverview> {
  if (!userId) return emptyDashboard("none");
  const authority = await requirePlatformRouteAccess(userId);
  const { scope, tenants } = await loadVisibleTenants(userId, authority);
  const memberships = await loadActiveMemberships(tenants.map((row) => row.id));
  return summariseDashboard({
    tenants: toSummaryInput(tenants),
    memberships,
    scope,
  });
}

export const getPlatformDashboardOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlatformDashboardOverview> => {
    return loadDashboardOverview((context as { userId?: string } | undefined)?.userId);
  });

export const listPlatformCompanySummaries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlatformDashboardOverview["companies"]> => {
    const overview = await loadDashboardOverview((context as { userId?: string } | undefined)?.userId);
    return overview.companies;
  });

const companyCodeSchema = z.object({
  companyCode: z.string().trim().regex(/^[0-9]{3}$/),
});

export const getPlatformCompanyDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => companyCodeSchema.parse(d))
  .handler(async ({ data, context }): Promise<PlatformCompanyDetailResult> => {
    const userId = (context as { userId?: string } | undefined)?.userId;
    if (!userId) return { ok: false, reason: "unauthorized" };

    const code = data.companyCode.trim();
    if (!isValidCompanyCodeParam(code)) return { ok: false, reason: "invalid_code" };

    let authority;
    try {
      authority = await requirePlatformRouteAccess(userId);
    } catch (error) {
      if (error instanceof PlatformRouteDeniedError) {
        return { ok: false, reason: "unauthorized" };
      }
      console.error("[platform-company-detail] authority", error instanceof Error ? error.message : "unknown");
      return { ok: false, reason: "query_failure" };
    }

    const scope = resolveVisibleTenantScope(authority);
    let grantedTenantIds: string[] = [];
    try {
      grantedTenantIds = scope === "granted" ? await loadGrantedTenantIds(userId) : [];
    } catch (error) {
      console.error("[platform-company-detail] grants", error instanceof Error ? error.message : "unknown");
      return { ok: false, reason: "query_failure" };
    }

    let tenant: TenantRow | null = null;
    try {
      const { data: row, error } = await db
        .from("tenants")
        .select("id, company_code, slug, company_name, trading_name, tenant_type, status, created_at")
        .eq("company_code", code)
        .maybeSingle();
      if (error) throw new Error(error.message);
      tenant = (row as TenantRow | null) ?? null;
    } catch (error) {
      console.error("[platform-company-detail] tenant", error instanceof Error ? error.message : "unknown");
      return { ok: false, reason: "query_failure" };
    }

    if (!tenant || !isPlatformTenantType(tenant.tenant_type)) {
      return { ok: false, reason: "not_found" };
    }
    if (!companyMayBeInspected(tenant.id, scope, grantedTenantIds)) {
      return { ok: false, reason: "unauthorized" };
    }

    try {
      const memberships = await loadActiveMemberships([tenant.id]);
      const { data: featureRows, error: featureErr } = await db
        .from("tenant_features")
        .select("feature_key, state")
        .eq("tenant_id", tenant.id);
      if (featureErr) throw new Error(featureErr.message);

      const features = (featureRows ?? []).map((row: { feature_key: string; state: string }) => ({
        key: row.feature_key,
        name: row.feature_key,
        state: row.state,
      }));

      const { data: settings } = await db
        .from("tenant_settings")
        .select("tenant_id")
        .eq("tenant_id", tenant.id)
        .maybeSingle();
      const { data: branding } = await db
        .from("tenant_branding")
        .select("tenant_id")
        .eq("tenant_id", tenant.id)
        .maybeSingle();

      const company: PlatformCompanyDetail = {
        companyCode: tenant.company_code,
        companyName: tenant.company_name,
        tradingName: tenant.trading_name,
        slug: tenant.slug,
        tenantType: tenant.tenant_type,
        status: tenant.status,
        createdAt: tenant.created_at,
        activeMemberCount: memberships.length,
        features,
        config: {
          settingsPresent: Boolean(settings),
          brandingPresent: Boolean(branding),
          enabledFeatureCount: features.filter((row) => row.state === "enabled").length,
        },
      };
      return { ok: true, company };
    } catch (error) {
      console.error("[platform-company-detail] metadata", error instanceof Error ? error.message : "unknown");
      return { ok: false, reason: "query_failure" };
    }
  });

export const listPlatformAuditEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlatformAuditListItem[]> => {
    const userId = (context as { userId?: string } | undefined)?.userId;
    if (!userId) return [];
    const authority = await requirePlatformRouteAccess(userId);
    const scope = resolveVisibleTenantScope(authority);

    const { data: events, error } = await db
      .from("security_audit_events")
      .select("event_type, acting_user_id, tenant_id, metadata, created_at")
      .in("event_type", [...PLATFORM_AUDIT_EVENT_TYPES])
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);

    const rows = events ?? [];
    const tenantIds = [...new Set(rows.map((row: { tenant_id?: string | null }) => row.tenant_id).filter(Boolean))] as string[];
    const companyById = new Map<string, { companyName: string; companyCode: string }>();
    if (tenantIds.length > 0) {
      const { data: tenants, error: tenantErr } = await db
        .from("tenants")
        .select("id, company_name, company_code")
        .in("id", tenantIds);
      if (tenantErr) throw new Error(tenantErr.message);
      for (const tenant of tenants ?? []) {
        companyById.set(tenant.id, {
          companyName: tenant.company_name,
          companyCode: tenant.company_code,
        });
      }
    }

    const granted =
      scope === "granted" ? new Set(await loadGrantedTenantIds(userId)) : null;

    return rows
      .filter((row: { tenant_id?: string | null }) => {
        if (scope === "all") return true;
        if (scope === "granted") {
          return Boolean(row.tenant_id && granted?.has(row.tenant_id));
        }
        return false;
      })
      .map((row: {
        event_type: string;
        acting_user_id: string | null;
        tenant_id: string | null;
        metadata: Record<string, unknown> | null;
        created_at: string;
      }) => {
        const company = row.tenant_id ? companyById.get(row.tenant_id) : undefined;
        return presentPlatformAuditEvent({
          occurredAt: row.created_at,
          eventType: row.event_type,
          actingUserId: row.acting_user_id,
          companyName: company?.companyName ?? null,
          companyCode: company?.companyCode ?? null,
          metadata: row.metadata,
        });
      });
  });
