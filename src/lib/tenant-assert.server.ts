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
import type { TenantMemberRole, TenantRoleView } from "@/lib/tenant-role";
import { resolveActingTenantRole } from "@/lib/tenant-role.server";

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

// ---------------------------------------------------------------------------
// Gate G7F-4S4C2 — canonical tenant/resource authorisation.
//
// identity (verified JWT) → acting tenant → resource tenant → role/allocation → operation.
// The acting tenant comes only from resolveActingTenantRole(userId) with NO tenant argument:
// a membership-verified URL/Referer slug, an active Enter Company session, or the caller's
// sole membership. Ambiguous context is denied. The resource tenant is always derived on the
// server from authoritative rows; browser-supplied tenant ids are never consulted.
// Unknown, other-tenant and tenantless resources all fail with the same "Not found.".
// ---------------------------------------------------------------------------

export const RESOURCE_NOT_FOUND_MESSAGE = "Not found.";
export const RESOURCE_FORBIDDEN_MESSAGE = "Forbidden";
export const GLOBAL_PROFILE_LOCKED_MESSAGE =
  "These contact details can't be changed from this company account.";

export type ResourceCapability = {
  mutate: boolean;
  allow: (view: TenantRoleView) => boolean;
  allocation: "adviser_must_be_allocated" | "none";
};

export type ActingTenant = { tenantId: string; view: TenantRoleView };

export type AuthorisedSession = ActingTenant & {
  row: {
    id: string;
    tenant_id: string;
    customer_id: string | null;
    case_ref: string | null;
    deleted_at: string | null;
  };
};

export type AuthorisedCustomer = ActingTenant & {
  customerId: string;
  /** Live sessions of this customer in the acting tenant only. */
  sessionIds: string[];
};

function resourceNotFound(): Error {
  return new Error(RESOURCE_NOT_FOUND_MESSAGE);
}

function resourceForbidden(): Error {
  return new Error(RESOURCE_FORBIDDEN_MESSAGE);
}

async function roleHelpers() {
  const { assertTenantViewMayMutate, platformAccessMayRead } = await import("@/lib/tenant-role");
  return { assertTenantViewMayMutate, platformAccessMayRead };
}

/** Adviser whose authority in this tenant is allocation-bound (not admin, not platform entry). */
async function isAllocationBoundAdviser(view: TenantRoleView): Promise<boolean> {
  const { platformAccessMayRead } = await roleHelpers();
  if (view.isMainAdmin || view.adminAccess.isOwner || view.adminAccess.isSupervisor) return false;
  if (platformAccessMayRead(view)) return false;
  return view.isAdvisor;
}

async function adviserAllocatedToAnySession(
  adviserId: string,
  sessionIds: string[],
): Promise<boolean> {
  if (sessionIds.length === 0) return false;
  const { data: alloc, error: allocErr } = await db
    .from("session_advisors")
    .select("session_id")
    .eq("advisor_id", adviserId)
    .in("session_id", sessionIds)
    .limit(1);
  if (allocErr) throw new Error(allocErr.message);
  if ((alloc ?? []).length > 0) return true;
  const { data: appt, error: apptErr } = await db
    .from("appointments")
    .select("id")
    .eq("advisor_id", adviserId)
    .in("session_id", sessionIds)
    .limit(1);
  if (apptErr) throw new Error(apptErr.message);
  return (appt ?? []).length > 0;
}

/**
 * Verified acting tenant for the caller. Never accepts a tenant id/slug argument.
 * 0 or 2+ memberships without a verified slug/Enter Company context → denied.
 */
export async function resolveActingTenant(userId: string): Promise<ActingTenant> {
  const view = await resolveActingTenantRole(userId);
  if (!view.tenantId) {
    throw new TenantContextError("TENANT_CONTEXT_REQUIRED", "Tenant required.");
  }
  if (view.accessContext === "none" || (!view.member && view.accessContext !== "platform_access")) {
    throw new TenantContextError("TENANT_DATA_ACCESS_DENIED", "Tenant access denied.");
  }
  return { tenantId: view.tenantId, view };
}

/** List/search entry points: one verified acting tenant plus the capability check. */
export async function resolveActingTenantForList(
  userId: string,
  capability: ResourceCapability,
): Promise<ActingTenant> {
  const acting = await resolveActingTenant(userId);
  if (!capability.allow(acting.view)) throw resourceForbidden();
  if (capability.mutate) {
    const { assertTenantViewMayMutate } = await roleHelpers();
    assertTenantViewMayMutate(acting.view);
  }
  return acting;
}

async function loadSessionTenantRow(sessionId: string): Promise<AuthorisedSession["row"] | null> {
  const { data, error } = await db
    .from("interview_sessions")
    .select("id, tenant_id, customer_id, case_ref, deleted_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AuthorisedSession["row"] | null) ?? null;
}

/**
 * Canonical single-resource check (session kind). Role is checked in the acting tenant before
 * the resource is loaded, so the outcome for an unknown id and a foreign id is identical.
 */
export async function authoriseTenantResource(opts: {
  userId: string;
  kind: "session";
  id: string;
  capability: ResourceCapability;
  includeDeleted?: boolean;
}): Promise<AuthorisedSession> {
  const acting = await resolveActingTenantForList(opts.userId, opts.capability);
  const row = await loadSessionTenantRow(opts.id);
  if (!row || !row.tenant_id || row.tenant_id !== acting.tenantId) throw resourceNotFound();
  if (row.deleted_at && !opts.includeDeleted) throw resourceNotFound();
  if (
    opts.capability.allocation === "adviser_must_be_allocated" &&
    (await isAllocationBoundAdviser(acting.view)) &&
    !(await adviserAllocatedToAnySession(opts.userId, [row.id]))
  ) {
    throw resourceForbidden();
  }
  return { ...acting, row: row as AuthorisedSession["row"] };
}

/**
 * Bulk variant: every id must be known, tenant-bound, in the acting tenant and authorised.
 * Any failure rejects the whole batch before the caller mutates anything; no id is named.
 */
export async function authoriseTenantResources(opts: {
  userId: string;
  kind: "session";
  ids: string[];
  capability: ResourceCapability;
  includeDeleted?: boolean;
}): Promise<ActingTenant & { rows: AuthorisedSession["row"][] }> {
  const acting = await resolveActingTenantForList(opts.userId, opts.capability);
  const ids = [...new Set(opts.ids)];
  if (ids.length === 0) throw resourceNotFound();
  const { data, error } = await db
    .from("interview_sessions")
    .select("id, tenant_id, customer_id, case_ref, deleted_at")
    .in("id", ids);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as AuthorisedSession["row"][];
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) {
    const row = byId.get(id);
    if (!row || !row.tenant_id || row.tenant_id !== acting.tenantId) throw resourceNotFound();
    if (row.deleted_at && !opts.includeDeleted) throw resourceNotFound();
  }
  if (
    opts.capability.allocation === "adviser_must_be_allocated" &&
    (await isAllocationBoundAdviser(acting.view))
  ) {
    for (const id of ids) {
      if (!(await adviserAllocatedToAnySession(opts.userId, [id]))) throw resourceForbidden();
    }
  }
  return { ...acting, rows: ids.map((id) => byId.get(id)!) };
}

/** Live sessions of a customer in one tenant (tenantless sessions are never included). */
async function customerSessionIdsInTenant(customerId: string, tenantId: string): Promise<string[]> {
  const { data, error } = await db
    .from("interview_sessions")
    .select("id")
    .eq("customer_id", customerId)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
}

async function hasActiveCustomerMembership(customerId: string, tenantId: string): Promise<boolean> {
  const { data, error } = await db
    .from("tenant_memberships")
    .select("id")
    .eq("user_id", customerId)
    .eq("tenant_id", tenantId)
    .eq("role", "customer")
    .eq("active", true)
    .limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * Every tenant this human has a relationship with, from authoritative rows:
 * active memberships (any role), sessions (live or binned) and introducer links.
 * A tenantless session or link makes the footprint indeterminate.
 */
export async function customerTenantFootprint(
  customerId: string,
): Promise<{ tenantIds: Set<string>; indeterminate: boolean }> {
  const tenantIds = new Set<string>();
  let indeterminate = false;

  const { data: memberships, error: mErr } = await db
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("user_id", customerId)
    .eq("active", true);
  if (mErr) throw new Error(mErr.message);
  for (const m of (memberships ?? []) as Array<{ tenant_id: string | null }>) {
    if (m.tenant_id) tenantIds.add(m.tenant_id);
  }

  const { data: sessions, error: sErr } = await db
    .from("interview_sessions")
    .select("tenant_id")
    .eq("customer_id", customerId);
  if (sErr) throw new Error(sErr.message);
  for (const s of (sessions ?? []) as Array<{ tenant_id: string | null }>) {
    if (s.tenant_id) tenantIds.add(s.tenant_id);
    else indeterminate = true;
  }

  const { data: links, error: lErr } = await db
    .from("customer_introducer_links")
    .select("introducer_id, tenant_id")
    .eq("customer_id", customerId);
  if (lErr) throw new Error(lErr.message);
  const linkRows = (links ?? []) as Array<{
    introducer_id: string | null;
    tenant_id: string | null;
  }>;
  const introducerIds = linkRows
    .filter((l) => !l.tenant_id && l.introducer_id)
    .map((l) => l.introducer_id as string);
  const introducerTenant = new Map<string, string | null>();
  if (introducerIds.length > 0) {
    const { data: intros, error: iErr } = await db
      .from("introducers")
      .select("id, tenant_id")
      .in("id", introducerIds);
    if (iErr) throw new Error(iErr.message);
    for (const i of (intros ?? []) as Array<{ id: string; tenant_id: string | null }>) {
      introducerTenant.set(i.id, i.tenant_id);
    }
  }
  for (const l of linkRows) {
    const t = l.tenant_id ?? (l.introducer_id ? introducerTenant.get(l.introducer_id) : null);
    if (t) tenantIds.add(t);
    else indeterminate = true;
  }

  return { tenantIds, indeterminate };
}

/**
 * Canonical customer check. Relation to the acting tenant = an active customer membership or a
 * live session in that tenant. No fallback to another tenant or to tenantless sessions.
 * Relationships the customer has with other tenants are neither read nor reported here.
 */
export async function authoriseTenantCustomer(opts: {
  userId: string;
  customerId: string;
  capability: ResourceCapability;
}): Promise<AuthorisedCustomer> {
  const acting = await resolveActingTenantForList(opts.userId, opts.capability);
  const sessionIds = await customerSessionIdsInTenant(opts.customerId, acting.tenantId);
  if (
    sessionIds.length === 0 &&
    !(await hasActiveCustomerMembership(opts.customerId, acting.tenantId))
  ) {
    throw resourceNotFound();
  }
  if (
    opts.capability.allocation === "adviser_must_be_allocated" &&
    (await isAllocationBoundAdviser(acting.view)) &&
    !(await adviserAllocatedToAnySession(opts.userId, sessionIds))
  ) {
    throw new Error("This customer is not allocated to you.");
  }
  return { ...acting, customerId: opts.customerId, sessionIds };
}

/**
 * BD-7a interim: profiles is global. A tenant may change it only when the acting tenant is
 * provably this human's only tenant. The refusal message never mentions other tenants.
 */
export async function assertCustomerGlobalProfileEditable(
  customerId: string,
  actingTenantId: string,
): Promise<void> {
  const footprint = await customerTenantFootprint(customerId);
  const onlyActing =
    !footprint.indeterminate &&
    footprint.tenantIds.size === 1 &&
    footprint.tenantIds.has(actingTenantId);
  if (!onlyActing) throw new Error(GLOBAL_PROFILE_LOCKED_MESSAGE);
}

/**
 * Interim guard for callers that still write customer-keyed shared rows with no tenant of their
 * own (first-wins customer_introducer_links, tenantless case sessions, unscoped session picks).
 * Refuses when any authoritative row ties this human to a tenant other than the acting one.
 * Tenantless rows do not count: those callers create them themselves until S4C3/S4C4.
 */
export async function assertNoOtherTenantCustomerRelationship(
  customerId: string,
  actingTenantId: string,
): Promise<void> {
  const footprint = await customerTenantFootprint(customerId);
  for (const tenantId of footprint.tenantIds) {
    if (tenantId !== actingTenantId) throw resourceForbidden();
  }
}

/** Target user must hold one of `roles` (active) in `tenantId`; otherwise "Not found.". */
export async function requireTargetMemberInTenant(
  targetUserId: string,
  tenantId: string,
  roles: TenantMemberRole[],
): Promise<void> {
  if (roles.length === 0) throw resourceNotFound();
  const { data, error } = await db
    .from("tenant_memberships")
    .select("id")
    .eq("user_id", targetUserId)
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .in("role", roles)
    .limit(1);
  if (error) throw new Error(error.message);
  if ((data ?? []).length === 0) throw resourceNotFound();
}

const IN_CHUNK = 150;

/** Session id → tenant_id for the given ids (chunked). */
export async function loadSessionTenantMap(
  sessionIds: Array<string | null | undefined>,
): Promise<Map<string, string | null>> {
  const ids = [...new Set(sessionIds.filter((id): id is string => Boolean(id)))];
  const map = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await db
      .from("interview_sessions")
      .select("id, tenant_id")
      .in("id", ids.slice(i, i + IN_CHUNK));
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as Array<{ id: string; tenant_id: string | null }>) {
      map.set(r.id, r.tenant_id);
    }
  }
  return map;
}

/**
 * List companion: keep rows whose effective tenant is `tenantId`. Effective tenant = the row's
 * own tenant_id, else its session's tenant. Conflicting or underivable tenants are dropped.
 */
export async function scopeRowsToTenant<T>(
  rows: T[],
  tenantId: string,
  opts: {
    tenantOf?: (row: T) => string | null | undefined;
    sessionOf?: (row: T) => string | null | undefined;
  },
): Promise<T[]> {
  const sessionTenant = opts.sessionOf
    ? await loadSessionTenantMap(rows.map((r) => opts.sessionOf!(r)))
    : new Map<string, string | null>();
  return rows.filter((row) => {
    const own = opts.tenantOf?.(row) ?? null;
    const sid = opts.sessionOf?.(row) ?? null;
    const viaSession = sid ? (sessionTenant.get(sid) ?? null) : null;
    if (own && viaSession && own !== viaSession) return false;
    const effective = own ?? viaSession;
    return effective === tenantId;
  });
}

/** Ids of the tenant's sessions matching the optional filters (paged; tenantless excluded). */
export async function listTenantSessionIds(
  tenantId: string,
  opts?: { caseOnly?: boolean; includeDeleted?: boolean },
): Promise<string[]> {
  const out: string[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    let q = db.from("interview_sessions").select("id").eq("tenant_id", tenantId);
    if (opts?.caseOnly) q = q.not("case_ref", "is", null);
    if (!opts?.includeDeleted) q = q.is("deleted_at", null);
    const { data, error } = await q.order("id", { ascending: true }).range(from, from + page - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ id: string }>;
    for (const r of rows) out.push(r.id);
    if (rows.length < page) break;
  }
  return out;
}

/** Run `fetch` over `ids` in IN-list sized chunks and concatenate the rows. */
export async function selectInChunks<T>(
  ids: string[],
  fetchChunk: (chunk: string[]) => Promise<T[]>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    out.push(...(await fetchChunk(ids.slice(i, i + IN_CHUNK))));
  }
  return out;
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
