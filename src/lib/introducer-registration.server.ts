/**
 * Current-user introducer registration.
 *
 * Direction is always: Auth identity → acting tenant (canonical tenant model) →
 * the introducer registration keyed by (user_id, tenant_id). The tenant is never
 * derived from an introducer row, email, phone, company code, slug, referral
 * cookie, customer relationship or global user_roles, and there is no fallback
 * to another tenant's registration or to a user_id-only row.
 */
import type { TenantRoleView } from "@/lib/tenant-role";

export const INTRODUCER_NOT_AUTHORISED_MESSAGE = "Not an introducer account";
export const INTRODUCER_REGISTRATION_MISSING_MESSAGE = "Introducer profile not set up yet.";
export const INTRODUCER_REGISTRATION_INACTIVE_MESSAGE = "This introducer account is not active.";

export type ActingIntroducerRegistration = {
  id: string;
  tenantId: string;
  /** Registration owner: the signed-in introducer, or the view-as target. */
  userId: string;
  actingUserId: string;
  viewAsMode: boolean;
  /** active = true and not binned (soft delete stamps active=false + deleted_at). */
  active: boolean;
  view: TenantRoleView;
};

type RegistrationRow = {
  id: string;
  user_id: string;
  tenant_id: string | null;
  active: boolean | null;
  deleted_at: string | null;
};

export async function requireActingIntroducerRegistration(input: {
  actingUserId: string;
  /** Owner/supervisor Introducer view: target must be an introducer of the SAME acting tenant. */
  viewAsIntroducerUserId?: string | null;
}): Promise<ActingIntroducerRegistration> {
  const { resolveActingTenantRole, loadTenantRoleForTenantId } =
    await import("@/lib/tenant-role.server");
  const view = await resolveActingTenantRole(input.actingUserId);
  const tenantId = view.tenantId;
  const viewAsMode = Boolean(input.viewAsIntroducerUserId);

  let targetUserId = input.actingUserId;
  if (viewAsMode) {
    if (!tenantId || (!view.adminAccess.isOwner && !view.adminAccess.isSupervisor)) {
      throw new Error("Forbidden");
    }
    targetUserId = input.viewAsIntroducerUserId!;
    const targetView = await loadTenantRoleForTenantId(targetUserId, tenantId);
    if (!targetView.isIntroducer) throw new Error(INTRODUCER_NOT_AUTHORISED_MESSAGE);
  } else if (!tenantId || !view.member || !view.isIntroducer) {
    throw new Error(INTRODUCER_NOT_AUTHORISED_MESSAGE);
  }

  const { supabaseAdminUntyped: db } = await import("@/integrations/supabase/client.server");
  const { data, error } = await db
    .from("introducers")
    .select("id, user_id, tenant_id, active, deleted_at")
    .eq("user_id", targetUserId)
    .eq("tenant_id", tenantId)
    .limit(2);
  if (error) {
    console.error("introducer registration lookup failed", error.message);
    throw new Error(INTRODUCER_REGISTRATION_MISSING_MESSAGE);
  }
  const rows = (data ?? []) as RegistrationRow[];
  const row = rows.length === 1 ? rows[0]! : null;
  if (!row || row.user_id !== targetUserId || row.tenant_id !== tenantId) {
    throw new Error(INTRODUCER_REGISTRATION_MISSING_MESSAGE);
  }

  return {
    id: row.id,
    tenantId,
    userId: targetUserId,
    actingUserId: input.actingUserId,
    viewAsMode,
    active: row.active === true && !row.deleted_at,
    view,
  };
}

/** New business (leads, booking links, bookings) requires an active registration. Never reactivates. */
export async function requireActiveActingIntroducerRegistration(input: {
  actingUserId: string;
  viewAsIntroducerUserId?: string | null;
}): Promise<ActingIntroducerRegistration> {
  const registration = await requireActingIntroducerRegistration(input);
  if (!registration.active) throw new Error(INTRODUCER_REGISTRATION_INACTIVE_MESSAGE);
  return registration;
}
