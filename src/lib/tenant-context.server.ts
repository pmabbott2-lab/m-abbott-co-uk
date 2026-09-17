/**
 * Gate G2 — application tenant context (server-only).
 *
 * Security identity is tenants.id (UUID). Slug / company_code resolve to a
 * tenant but NEVER authorise access alone.
 *
 * FAIL CLOSED: no silent default to Mortgage Easy (001).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Generated Database types lag G1/G2 tables (tenants, memberships, helpers).
 * Use an untyped admin surface here until types are regenerated in a later gate.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as any;

export type TenantStatus = "provisioning" | "active" | "suspended" | "archived";
export type TenantType = "GROUP" | "EXTERNAL";
export type TenantMemberRole =
  | "owner"
  | "supervisor"
  | "general"
  | "adviser"
  | "introducer"
  | "customer";

export type TenantRecord = {
  id: string;
  companyCode: string;
  slug: string;
  companyName: string;
  status: TenantStatus;
  tenantType: TenantType;
};

export type TenantContext = {
  tenant: TenantRecord;
  /** How the tenant was resolved for this request (never a security grant). */
  resolvedBy: "slug" | "company_code" | "tenant_id";
};

export class TenantContextError extends Error {
  readonly code:
    | "TENANT_NOT_FOUND"
    | "TENANT_INACTIVE"
    | "TENANT_CONTEXT_REQUIRED"
    | "TENANT_MEMBERSHIP_REQUIRED"
    | "TENANT_ADMIN_REQUIRED"
    | "TENANT_DATA_ACCESS_DENIED";

  constructor(
    code: TenantContextError["code"],
    message: string,
  ) {
    super(message);
    this.name = "TenantContextError";
    this.code = code;
  }
}

function mapTenant(row: {
  id: string;
  company_code: string;
  slug: string;
  company_name: string;
  status: string;
  tenant_type: string;
}): TenantRecord {
  return {
    id: row.id,
    companyCode: row.company_code,
    slug: row.slug,
    companyName: row.company_name,
    status: row.status as TenantStatus,
    tenantType: row.tenant_type as TenantType,
  };
}

function assertActive(tenant: TenantRecord): void {
  if (tenant.status !== "active") {
    throw new TenantContextError(
      "TENANT_INACTIVE",
      `Tenant '${tenant.slug}' is not active (status=${tenant.status}).`,
    );
  }
}

/** Resolve tenant by public URL slug. Does not grant membership. */
export async function resolveTenantBySlug(slug: string): Promise<TenantRecord> {
  const normalised = slug.trim().toLowerCase();
  if (!normalised) {
    throw new TenantContextError("TENANT_NOT_FOUND", "Tenant slug is required.");
  }

  const { data, error } = await db
    .from("tenants")
    .select("id, company_code, slug, company_name, status, tenant_type")
    .eq("slug", normalised)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    throw new TenantContextError("TENANT_NOT_FOUND", `Unknown tenant slug '${normalised}'.`);
  }
  return mapTenant(data);
}

/** Resolve tenant by company_code (001/002). Not a security boundary. */
export async function resolveTenantByCompanyCode(companyCode: string): Promise<TenantRecord> {
  const code = companyCode.trim();
  const { data, error } = await db
    .from("tenants")
    .select("id, company_code, slug, company_name, status, tenant_type")
    .eq("company_code", code)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new TenantContextError("TENANT_NOT_FOUND", `Unknown company_code '${code}'.`);
  }
  return mapTenant(data);
}

export async function resolveTenantById(tenantId: string): Promise<TenantRecord> {
  const { data, error } = await db
    .from("tenants")
    .select("id, company_code, slug, company_name, status, tenant_type")
    .eq("id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new TenantContextError("TENANT_NOT_FOUND", "Unknown tenant_id.");
  }
  return mapTenant(data);
}

/**
 * Establish tenant context from a slug (typical path segment).
 * Requires active tenant. Never falls back to 001.
 */
export async function getTenantContextBySlug(slug: string): Promise<TenantContext> {
  const tenant = await resolveTenantBySlug(slug);
  assertActive(tenant);
  return { tenant, resolvedBy: "slug" };
}

export async function requireTenantContext(
  ctx: TenantContext | null | undefined,
): Promise<TenantContext> {
  if (!ctx?.tenant?.id) {
    throw new TenantContextError(
      "TENANT_CONTEXT_REQUIRED",
      "Tenant context is required for this operation.",
    );
  }
  assertActive(ctx.tenant);
  return ctx;
}

/** True if user has any active membership row for the tenant. */
export async function hasTenantMembership(userId: string, tenantId: string): Promise<boolean> {
  const { data, error } = await db.rpc("has_tenant_membership", {
    p_user_id: userId,
    p_tenant_id: tenantId,
  });
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function requireTenantMembership(userId: string, tenantId: string): Promise<void> {
  const ok = await hasTenantMembership(userId, tenantId);
  if (!ok) {
    throw new TenantContextError(
      "TENANT_MEMBERSHIP_REQUIRED",
      "Active tenant membership is required.",
    );
  }
}

/** Admin plane — uses G1A can_administer_tenant (owner/supervisor/platform grants). */
export async function canAdministerTenant(userId: string, tenantId: string): Promise<boolean> {
  const { data, error } = await db.rpc("can_administer_tenant", {
    p_user_id: userId,
    p_tenant_id: tenantId,
  });
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function requireTenantAdmin(userId: string, tenantId: string): Promise<void> {
  const ok = await canAdministerTenant(userId, tenantId);
  if (!ok) {
    throw new TenantContextError("TENANT_ADMIN_REQUIRED", "Tenant administration access denied.");
  }
}

/** Data plane — uses G1A can_access_tenant_data (membership / GROUP SO / grants). */
export async function canAccessTenantData(userId: string, tenantId: string): Promise<boolean> {
  const { data, error } = await db.rpc("can_access_tenant_data", {
    p_user_id: userId,
    p_tenant_id: tenantId,
  });
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function requireTenantDataAccess(userId: string, tenantId: string): Promise<void> {
  const ok = await canAccessTenantData(userId, tenantId);
  if (!ok) {
    throw new TenantContextError("TENANT_DATA_ACCESS_DENIED", "Tenant data access denied.");
  }
}

/**
 * List active membership roles for a user in a tenant.
 * Empty array if none — never invents 001 fallback.
 */
export async function listTenantMembershipRoles(
  userId: string,
  tenantId: string,
): Promise<TenantMemberRole[]> {
  const { data, error } = await db
    .from("tenant_memberships")
    .select("role")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .eq("active", true);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: { role: string }) => r.role as TenantMemberRole);
}

/** Platform root has no tenant context — callers must not invent one. */
export function platformRootContext(): null {
  return null;
}
