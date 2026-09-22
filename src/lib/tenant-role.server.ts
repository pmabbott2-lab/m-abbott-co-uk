/**
 * Server loader for tenant-scoped role authority.
 * Slug/id identify the tenant; membership.role is the grant.
 * Does not read user_roles, admin_profiles.level, or ADMIN_EMAILS.
 *
 * Remaining runtime user_roles uses (not tenant authority):
 * - MFA classification: auth-roles.ts, _authenticated/route.tsx, auth.tsx
 * - Test-account provisioning writes: test-accounts.functions.ts
 * - Legacy compatibility writes: grantIntroducerRole / setAdvisorRole / invite consume
 * - Generated Database types: integrations/supabase/types.ts
 * - RLS has_role until P2 migration is applied
 */
import type { PermissionAccess, PermissionKey } from "@/lib/admin-access";
import { DEFAULT_GENERAL_PERMISSIONS, PERMISSION_KEYS } from "@/lib/admin-access";
import {
  deniedTenantRoleView,
  resolveTenantRoleView,
  type TenantMemberRole,
  type TenantRoleView,
} from "@/lib/tenant-role";
import { TenantContextError } from "@/lib/tenant-context.server";
import { isReservedTenantSlug, normalisePublicTenantSlug } from "@/lib/tenant-presentation";

function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const msg = (error.message ?? "").toLowerCase();
  return (
    code === "42703" ||
    code === "PGRST204" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

async function loadGeneralPermissions(
  userId: string,
  tenantId: string,
): Promise<Record<PermissionKey, PermissionAccess>> {
  const permissions = { ...DEFAULT_GENERAL_PERMISSIONS };
  const { supabaseAdminUntyped: db } = await import("@/integrations/supabase/client.server");
  const { data, error } = await db
    .from("admin_permissions")
    .select("permission_key, access, tenant_id")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId);
  if (error) {
    if (!isMissingColumn(error)) throw new Error(error.message);
    return permissions;
  }
  for (const row of data ?? []) {
    const key = row.permission_key as PermissionKey;
    if (PERMISSION_KEYS.includes(key)) {
      permissions[key] = row.access as PermissionAccess;
    }
  }
  return permissions;
}

export async function loadTenantRoleForTenantId(
  userId: string,
  tenantId: string,
  tenantSlug?: string | null,
): Promise<TenantRoleView> {
  const { listTenantMembershipRoles, resolveTenantById } = await import(
    "@/lib/tenant-assert.server"
  );
  const tenant = await resolveTenantById(tenantId);
  if (tenant.status !== "active") {
    return deniedTenantRoleView({ tenantSlug: tenantSlug ?? tenant.slug, tenantId: tenant.id });
  }
  const membershipRoles = await listTenantMembershipRoles(userId, tenant.id);
  if (membershipRoles.length > 0) {
    const generalPermissions = membershipRoles.includes("general")
      ? await loadGeneralPermissions(userId, tenant.id)
      : null;
    return resolveTenantRoleView({
      membershipRoles,
      tenantSlug: tenantSlug ?? tenant.slug,
      tenantId: tenant.id,
      member: true,
      generalPermissions,
    });
  }

  const { validatePlatformTenantAccessSession } = await import(
    "@/lib/platform-tenant-entry.server"
  );
  const platform = await validatePlatformTenantAccessSession({
    userId,
    tenantId: tenant.id,
  });
  if (platform) {
    const { platformAccessTenantRoleView } = await import("@/lib/tenant-role");
    return platformAccessTenantRoleView({
      tenantSlug: tenantSlug ?? tenant.slug,
      tenantId: tenant.id,
      accessLevel: platform.accessLevel,
      basisLabel: platform.basisLabel,
    });
  }

  return deniedTenantRoleView({ tenantSlug: tenantSlug ?? tenant.slug, tenantId: tenant.id });
}

/** Map a tenant role view to legacy app_role strings for existing gates. */
export function syntheticAppRolesFromView(view: TenantRoleView): string[] {
  const roles: string[] = [];
  if (view.isAdvisor) roles.push("advisor");
  if (view.isMainAdmin) roles.push("admin");
  if (view.isIntroducer) roles.push("introducer");
  if (view.membershipRoles.includes("customer")) roles.push("customer");
  return roles;
}

export async function rolesForUserInTenant(
  userId: string,
  tenantId?: string | null,
  tenantSlug?: string | null,
): Promise<string[]> {
  const view = tenantId
    ? await loadTenantRoleForTenantId(userId, tenantId)
    : await resolveActingTenantRole(userId, tenantSlug ?? null, tenantId ?? null);
  return syntheticAppRolesFromView(view);
}

export async function listTenantMemberUserIds(
  tenantId: string,
  roles: TenantMemberRole[],
): Promise<string[]> {
  if (roles.length === 0) return [];
  const { supabaseAdminUntyped: db } = await import("@/integrations/supabase/client.server");
  const { data, error } = await db
    .from("tenant_memberships")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .in("role", roles);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ user_id: string }>;
  return [...new Set(rows.map((r) => r.user_id))];
}

/**
 * Current-tenant slug from the request URL or Referer.
 * Presentation identity only — membership is still required. Never infers 001.
 * Client tenant_id is not read.
 */
export async function peekActingTenantSlugFromRequest(): Promise<string | null> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const request = getRequest();
    const candidates = [request?.url, request?.headers.get("referer"), request?.headers.get("referrer")];
    for (const raw of candidates) {
      if (!raw) continue;
      try {
        const pathname = new URL(raw, "http://localhost").pathname;
        const first = pathname.split("/").filter(Boolean)[0] ?? "";
        const slug = normalisePublicTenantSlug(first);
        if (slug && !isReservedTenantSlug(slug)) return slug;
      } catch {
        /* try next */
      }
    }
  } catch {
    /* no request context */
  }
  return null;
}

/**
 * Resolve acting tenant role.
 * - tenantSlug or tenantId: that tenant only (no 001 fallback)
 * - neither: request URL slug if present; else sole active membership;
 *   dual/none without explicit tenant → denied (no elevation)
 */
export async function resolveActingTenantRole(
  userId: string,
  tenantSlug?: string | null,
  tenantId?: string | null,
): Promise<TenantRoleView> {
  const { getTenantContextBySlug, resolveTenantById } = await import("@/lib/tenant-assert.server");
  const { supabaseAdminUntyped: db } = await import("@/integrations/supabase/client.server");

  const slug = tenantSlug?.trim().toLowerCase() || (await peekActingTenantSlugFromRequest());
  const explicitId = tenantId?.trim() || null;

  if (slug) {
    try {
      const ctx = await getTenantContextBySlug(slug);
      return loadTenantRoleForTenantId(userId, ctx.tenant.id, ctx.tenant.slug);
    } catch (e) {
      if (e instanceof TenantContextError) {
        return deniedTenantRoleView({ tenantSlug: slug, tenantId: explicitId });
      }
      throw e;
    }
  }

  if (explicitId) {
    try {
      const tenant = await resolveTenantById(explicitId);
      return loadTenantRoleForTenantId(userId, tenant.id, tenant.slug);
    } catch (e) {
      if (e instanceof TenantContextError) {
        return deniedTenantRoleView({ tenantId: explicitId });
      }
      throw e;
    }
  }

  const { data, error } = await db
    .from("tenant_memberships")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .eq("active", true);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ tenant_id: string; role: TenantMemberRole }>;
  const tenantIds = [...new Set(rows.map((r) => r.tenant_id))];
  if (tenantIds.length !== 1) {
    return deniedTenantRoleView();
  }
  return loadTenantRoleForTenantId(userId, tenantIds[0]!);
}

export async function requireActingTenantStaff(
  userId: string,
  tenantSlug?: string | null,
  tenantId?: string | null,
): Promise<TenantRoleView> {
  const view = await resolveActingTenantRole(userId, tenantSlug, tenantId);
  if (!view.member || (!view.isMainAdmin && !view.isAdvisor)) {
    throw new Error("Forbidden");
  }
  return view;
}
