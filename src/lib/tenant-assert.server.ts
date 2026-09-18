/**
 * Gate G4A — canonical server-side tenant assertion.
 *
 * Service role bypasses RLS. These helpers are the authorisation boundary for
 * privileged operations. Client-supplied tenant_id is never trusted alone.
 *
 * FAIL CLOSED: no silent default to Mortgage Easy (001).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  TenantContextError,
  type TenantContext,
  type TenantRecord,
  canAccessTenantData,
  canAdministerTenant,
  getTenantContextBySlug,
  hasTenantMembership,
  listTenantMembershipRoles,
  requireTenantAdmin,
  requireTenantDataAccess,
  requireTenantMembership,
  resolveTenantById,
  resolveTenantBySlug,
} from "@/lib/tenant-context.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as any;

export {
  TenantContextError,
  getTenantContextBySlug,
  requireTenantMembership,
  requireTenantAdmin,
  requireTenantDataAccess,
  hasTenantMembership,
  canAccessTenantData,
  canAdministerTenant,
  resolveTenantBySlug,
  resolveTenantById,
  listTenantMembershipRoles,
};

export type AuthorisedTenant = {
  tenant: TenantRecord;
  /** How authority was established (not a grant from the client). */
  authority:
    | "membership"
    | "admin_plane"
    | "data_plane"
    | "public_slug"
    | "resource_owner";
  userId?: string;
  roles?: string[];
};

/** Reject obvious client forgeries: body/query tenant_id must match authorised tenant if present. */
export function rejectMismatchedClientTenantId(
  authorisedTenantId: string,
  clientTenantId: string | null | undefined,
): void {
  if (clientTenantId == null || clientTenantId === "") return;
  if (clientTenantId !== authorisedTenantId) {
    throw new TenantContextError(
      "TENANT_DATA_ACCESS_DENIED",
      "Tenant access denied.",
    );
  }
}

/**
 * Authenticated user must have active membership for the tenant identified by
 * a server-resolved slug (from the route), not from a free-form body field.
 */
export async function requireAuthenticatedTenantBySlug(
  userId: string,
  slug: string,
): Promise<AuthorisedTenant> {
  const ctx = await getTenantContextBySlug(slug);
  await requireTenantMembership(userId, ctx.tenant.id);
  const roles = await listTenantMembershipRoles(userId, ctx.tenant.id);
  return {
    tenant: ctx.tenant,
    authority: "membership",
    userId,
    roles,
  };
}

/** Authenticated user + explicit tenant UUID already resolved server-side. */
export async function requireAuthenticatedTenantById(
  userId: string,
  tenantId: string,
): Promise<AuthorisedTenant> {
  const tenant = await resolveTenantById(tenantId);
  if (tenant.status !== "active") {
    throw new TenantContextError(
      "TENANT_INACTIVE",
      `Tenant '${tenant.slug}' is not active.`,
    );
  }
  await requireTenantMembership(userId, tenant.id);
  const roles = await listTenantMembershipRoles(userId, tenant.id);
  return { tenant, authority: "membership", userId, roles };
}

/**
 * Resolve the operating tenant for an authenticated user when the caller did
 * not supply a slug.
 *
 * - 1 active membership → that tenant
 * - 0 → deny (never invent 001)
 * - 2+ → require explicit tenantId/slug (fail closed)
 */
export async function resolveSoleMembershipTenant(
  userId: string,
  explicitTenantId?: string | null,
): Promise<AuthorisedTenant> {
  if (explicitTenantId) {
    return requireAuthenticatedTenantById(userId, explicitTenantId);
  }

  const { data, error } = await db
    .from("tenant_memberships")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .eq("active", true);
  if (error) throw new Error(error.message);

  const tenantIds = [...new Set((data ?? []).map((r: { tenant_id: string }) => r.tenant_id))];
  if (tenantIds.length === 0) {
    throw new TenantContextError(
      "TENANT_MEMBERSHIP_REQUIRED",
      "Active tenant membership is required.",
    );
  }
  if (tenantIds.length > 1) {
    throw new TenantContextError(
      "TENANT_CONTEXT_REQUIRED",
      "Multiple tenant memberships — specify tenant explicitly.",
    );
  }

  return requireAuthenticatedTenantById(userId, tenantIds[0] as string);
}

/** Public journey: slug → active tenant. No membership required. */
export async function requirePublicTenantBySlug(slug: string): Promise<AuthorisedTenant> {
  const ctx = await getTenantContextBySlug(slug);
  return { tenant: ctx.tenant, authority: "public_slug" };
}

/**
 * Load a row by id and assert tenant_id matches authorised tenant.
 * Returns the row or throws TENANT_DATA_ACCESS_DENIED / not found (opaque).
 */
export async function assertRowBelongsToTenant<T extends { tenant_id?: string | null }>(opts: {
  table: string;
  id: string;
  idColumn?: string;
  authorisedTenantId: string;
  select?: string;
}): Promise<T> {
  const idCol = opts.idColumn ?? "id";
  const { data, error } = await db
    .from(opts.table)
    .select(opts.select ?? "*")
    .eq(idCol, opts.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new TenantContextError("TENANT_DATA_ACCESS_DENIED", "Resource not found.");
  }
  const rowTenant = (data as { tenant_id?: string | null }).tenant_id;
  if (!rowTenant || rowTenant !== opts.authorisedTenantId) {
    throw new TenantContextError("TENANT_DATA_ACCESS_DENIED", "Resource not found.");
  }
  return data as T;
}

/** Strip/ignore client tenant_id and force authorised value on insert payloads. */
export function withForcedTenantId<T extends Record<string, unknown>>(
  payload: T,
  authorisedTenantId: string,
): T & { tenant_id: string } {
  const { tenant_id: _ignored, ...rest } = payload;
  return { ...(rest as T), tenant_id: authorisedTenantId };
}

/**
 * Scope a Postgrest filter builder conceptually — callers should chain
 * `.eq("tenant_id", authorisedTenantId)` on every tenant-owned query.
 */
export function tenantScopeFilter(authorisedTenantId: string): { tenant_id: string } {
  return { tenant_id: authorisedTenantId };
}

/** Admin-plane within tenant (Owner/Supervisor or legacy admin + membership). */
export async function requireAuthenticatedTenantAdmin(
  userId: string,
  tenantId: string,
): Promise<AuthorisedTenant> {
  const tenant = await resolveTenantById(tenantId);
  if (tenant.status !== "active") {
    throw new TenantContextError("TENANT_INACTIVE", `Tenant '${tenant.slug}' is not active.`);
  }
  await requireTenantAdmin(userId, tenant.id);
  return { tenant, authority: "admin_plane", userId };
}

/** Data-plane access (membership / GROUP SO / grants) — uses G1A helper. */
export async function requireAuthenticatedTenantData(
  userId: string,
  tenantId: string,
): Promise<AuthorisedTenant> {
  const tenant = await resolveTenantById(tenantId);
  if (tenant.status !== "active") {
    throw new TenantContextError("TENANT_INACTIVE", `Tenant '${tenant.slug}' is not active.`);
  }
  await requireTenantDataAccess(userId, tenant.id);
  return { tenant, authority: "data_plane", userId };
}

export function isTenantContextError(e: unknown): e is TenantContextError {
  return e instanceof TenantContextError;
}

/** Safe client-facing message — no cross-tenant leakage. */
export function tenantErrorMessage(e: unknown): string {
  if (e instanceof TenantContextError) {
    switch (e.code) {
      case "TENANT_NOT_FOUND":
        return "Tenant not found.";
      case "TENANT_INACTIVE":
        return "Tenant unavailable.";
      case "TENANT_CONTEXT_REQUIRED":
        return "Tenant required.";
      case "TENANT_MEMBERSHIP_REQUIRED":
      case "TENANT_ADMIN_REQUIRED":
      case "TENANT_DATA_ACCESS_DENIED":
        return "Tenant access denied.";
      default:
        return "Tenant access denied.";
    }
  }
  return e instanceof Error ? e.message : "Request failed.";
}
