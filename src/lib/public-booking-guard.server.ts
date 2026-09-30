import { publicAppointmentInput, type PublicBookingPlan } from "@/lib/public-booking-contract";
import type { ActiveIntroducer } from "@/lib/booking-availability.server";

/** One message for every lead failure so a public caller cannot probe lead existence. */
export const PUBLIC_LEAD_ERROR =
  "This booking link is no longer valid. Please contact the person who sent it.";
/** One message for every adviser failure (foreign, customer, inactive, not bookable, unknown). */
export const PUBLIC_ADVISER_ERROR =
  "That adviser is not available. Please choose another time or adviser.";

const BOOKABLE_LEAD_STATUSES = new Set(["new", "contacted"]);

export class PublicBookingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicBookingError";
  }
}

export type ResolvePublicBookingTenant = (opts: {
  tenantSlug: string | null;
  introducerId: string | null;
  actingUserId: string | null;
}) => Promise<string>;

/**
 * A public lead id is a bearer link: honoured only for an unbooked lead that belongs to the
 * same active referral introducer and the same booking tenant.
 */
export async function assertPublicLeadBinding(opts: {
  leadId: string;
  introducer: ActiveIntroducer | null;
  tenantId: string;
}): Promise<string> {
  const { leadId, introducer, tenantId } = opts;
  if (!introducer || !introducer.tenant_id || introducer.tenant_id !== tenantId) {
    throw new PublicBookingError(PUBLIC_LEAD_ERROR);
  }
  const { supabaseAdminUntyped: supabaseAdmin } =
    await import("@/integrations/supabase/client.server");
  const { data: lead, error } = await supabaseAdmin
    .from("introducer_leads")
    .select("id, tenant_id, introducer_id, status, appointment_id")
    .eq("id", leadId)
    .maybeSingle();
  if (error || !lead) throw new PublicBookingError(PUBLIC_LEAD_ERROR);
  const row = lead as {
    id: string;
    tenant_id: string | null;
    introducer_id: string | null;
    status: string | null;
    appointment_id: string | null;
  };
  if (
    row.tenant_id !== tenantId ||
    row.introducer_id !== introducer.id ||
    row.appointment_id ||
    !BOOKABLE_LEAD_STATUSES.has(row.status ?? "")
  ) {
    throw new PublicBookingError(PUBLIC_LEAD_ERROR);
  }
  return row.id;
}

/** A publicly chosen adviser must be in the tenant's public bookable pool. */
export async function assertPublicAdvisorBookable(
  advisorId: string,
  tenantId: string,
): Promise<string> {
  const { listBookableAdvisorsForTenant } = await import("@/lib/booking-availability.server");
  let pool: Array<{ id: string }>;
  try {
    pool = await listBookableAdvisorsForTenant(tenantId);
  } catch {
    throw new PublicBookingError(PUBLIC_ADVISER_ERROR);
  }
  if (!pool.some((a) => a.id === advisorId)) {
    throw new PublicBookingError(PUBLIC_ADVISER_ERROR);
  }
  return advisorId;
}

/**
 * Validate client-shaped booking input and build the only payload the public endpoints may pass
 * to the trusted booking implementation. `actingUserId` must come from verified auth context or
 * from an account created by the same request, never from input.
 */
export async function planPublicBooking(
  raw: unknown,
  ctx: { actingUserId: string | null; resolveTenantId: ResolvePublicBookingTenant },
): Promise<PublicBookingPlan> {
  const input = publicAppointmentInput.parse(raw);

  const { resolveActiveIntroducerBySlug } = await import("@/lib/booking-availability.server");
  const introducer = await resolveActiveIntroducerBySlug(input.slug);

  // Tenant comes from the route, the referral or the verified caller — never from a
  // caller-chosen adviser.
  const tenantId = await ctx.resolveTenantId({
    tenantSlug: input.tenantSlug?.trim() || null,
    introducerId: introducer?.id ?? null,
    actingUserId: ctx.actingUserId,
  });

  const leadId = input.leadId
    ? await assertPublicLeadBinding({ leadId: input.leadId, introducer, tenantId })
    : undefined;

  const advisorId =
    input.advisorId && !input.preferAnyAdvisor
      ? await assertPublicAdvisorBookable(input.advisorId, tenantId)
      : undefined;

  return {
    slug: input.slug,
    tenantSlug: input.tenantSlug,
    tenant_id: tenantId,
    leadId,
    advisorId,
    preferAnyAdvisor: input.preferAnyAdvisor,
    channel: input.channel,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    customerEmail: input.customerEmail,
    startsAt: input.startsAt,
    notes: input.notes,
    sendSms: input.sendSms,
  };
}
