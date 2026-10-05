/**
 * Staff/admin management of an introducer registration.
 *
 * Direction is always: authenticated staff → canonical acting tenant → admin
 * authority → the introducer registration in THAT tenant. A registration id or
 * user id only identifies the row; it never authorises. Email, company code,
 * slug and global user_roles are never used to find the target, and there is no
 * fallback to another tenant's registration or to a user_id-only row. A target
 * outside the acting tenant is indistinguishable from a missing one.
 */

export type ManagedIntroducerRegistration = {
  id: string;
  userId: string;
  tenantId: string;
  active: boolean;
  deletedAt: string | null;
};

type RegistrationRow = {
  id: string;
  user_id: string;
  tenant_id: string | null;
  active: boolean | null;
  deleted_at: string | null;
};

/** Main-admin ceiling (Owner / Admin Supervisor / General Admin), platform read_only refused. */
export async function requireManagedIntroducerRegistration(input: {
  actingUserId: string;
  introducerId?: string | null;
  introducerUserId?: string | null;
}): Promise<ManagedIntroducerRegistration> {
  const { RESOURCE_NOT_FOUND_MESSAGE } = await import("@/lib/tenant-assert.server");
  const { resolveActingTenantRole } = await import("@/lib/tenant-role.server");
  const { assertTenantViewMayMutate } = await import("@/lib/tenant-role");
  const view = await resolveActingTenantRole(input.actingUserId);
  if (!view.isMainAdmin || !view.tenantId) throw new Error("Forbidden");
  assertTenantViewMayMutate(view);
  const tenantId = view.tenantId;

  if (!input.introducerId && !input.introducerUserId) throw new Error(RESOURCE_NOT_FOUND_MESSAGE);

  const { supabaseAdminUntyped: db } = await import("@/integrations/supabase/client.server");
  let query = db
    .from("introducers")
    .select("id, user_id, tenant_id, active, deleted_at")
    .eq("tenant_id", tenantId);
  if (input.introducerId) query = query.eq("id", input.introducerId);
  if (input.introducerUserId) query = query.eq("user_id", input.introducerUserId);
  const { data, error } = await query.limit(2);
  if (error) {
    console.error("managed introducer registration lookup failed", error.message);
    throw new Error(RESOURCE_NOT_FOUND_MESSAGE);
  }
  const rows = (data ?? []) as RegistrationRow[];
  const row = rows.length === 1 ? rows[0]! : null;
  if (
    !row ||
    row.tenant_id !== tenantId ||
    (input.introducerId && row.id !== input.introducerId) ||
    (input.introducerUserId && row.user_id !== input.introducerUserId)
  ) {
    throw new Error(RESOURCE_NOT_FOUND_MESSAGE);
  }
  return {
    id: row.id,
    userId: row.user_id,
    tenantId,
    active: row.active === true,
    deletedAt: row.deleted_at,
  };
}

/**
 * user_roles is global: the legacy introducer role row may only be removed when
 * the user keeps no live introducer registration or membership in another tenant.
 * Fails closed (reports standing) when it cannot tell.
 */
export async function introducerStandingOutsideTenant(
  userId: string,
  tenantId: string,
): Promise<boolean> {
  const { supabaseAdminUntyped: db } = await import("@/integrations/supabase/client.server");
  const [regs, members] = await Promise.all([
    db
      .from("introducers")
      .select("tenant_id")
      .eq("user_id", userId)
      .neq("tenant_id", tenantId)
      .is("deleted_at", null),
    db
      .from("tenant_memberships")
      .select("tenant_id")
      .eq("user_id", userId)
      .eq("role", "introducer")
      .eq("active", true)
      .neq("tenant_id", tenantId),
  ]);
  if (regs.error || members.error) return true;
  return (regs.data ?? []).length > 0 || (members.data ?? []).length > 0;
}
