/**
 * Customer ↔ introducer attribution, one row per (tenant, customer).
 *
 * Every read and write names the tenant. Another tenant's attribution is never read, created,
 * overwritten or used to block; nothing is inferred from email, phone or name. The only automatic
 * writer is createTenantAttributionIfEligible (booking); Owner amendments go through the
 * amend_customer_introducer_attribution RPC.
 */

type SupabaseAdmin = Awaited<
  ReturnType<typeof import("@/integrations/supabase/client.server")>
>["supabaseAdmin"];
type AdminDb = (typeof import("@/integrations/supabase/client.server"))["supabaseAdminUntyped"];

export const NO_ACTIVE_INTRODUCER_FOR_CODE_MESSAGE = "No active introducer found for that code.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMPANY_CODE_PATTERN = /^\d{4}$/;
const AUTOMATIC_SOURCES = new Set(["booking"]);

export type TenantAttribution = {
  introducerId: string;
  effectiveFrom: string | null;
  source: string | null;
};

/** The acting tenant's attribution for this customer, or null. */
export async function getTenantAttribution(
  db: AdminDb,
  tenantId: string,
  customerId: string,
): Promise<TenantAttribution | null> {
  const { data, error } = await db
    .from("customer_introducer_links")
    .select("introducer_id, effective_from, source")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.introducer_id) return null;
  return {
    introducerId: data.introducer_id as string,
    effectiveFrom: (data.effective_from as string | null) ?? null,
    source: (data.source as string | null) ?? null,
  };
}

/**
 * Booking-tenant state captured before a booking writes anything, so the booking being made
 * never counts against itself. Reads only this tenant's rows for this customer.
 */
export type TenantCustomerSnapshot =
  | {
      ok: true;
      tenantId: string;
      customerId: string;
      hasTenantAttribution: boolean;
      /** A case (case_ref) or any appointment already exists for this customer in this tenant. */
      substantive: boolean;
    }
  | { ok: false; tenantId: string; customerId: string };

export async function snapshotTenantCustomerState(
  db: AdminDb,
  customerId: string,
  tenantId: string,
): Promise<TenantCustomerSnapshot> {
  const failed = { ok: false as const, tenantId, customerId };
  try {
    const { data: links, error: linkErr } = await db
      .from("customer_introducer_links")
      .select("customer_id")
      .eq("tenant_id", tenantId)
      .eq("customer_id", customerId)
      .limit(1);
    if (linkErr) return failed;

    // Live and binned sessions alike: a binned case still means the customer was not new here.
    const { data: sessions, error: sessErr } = await db
      .from("interview_sessions")
      .select("id, case_ref")
      .eq("tenant_id", tenantId)
      .eq("customer_id", customerId);
    if (sessErr) return failed;
    const sessionRows = (sessions ?? []) as Array<{ id: string; case_ref: string | null }>;
    const hasCase = sessionRows.some((s) => Boolean(s.case_ref));

    let hasAppointment = false;
    if (sessionRows.length > 0) {
      const { data: appts, error: apptErr } = await db
        .from("appointments")
        .select("id")
        .in(
          "session_id",
          sessionRows.map((s) => s.id),
        )
        .limit(1);
      if (apptErr) return failed;
      hasAppointment = (appts ?? []).length > 0;
    }

    return {
      ok: true,
      tenantId,
      customerId,
      hasTenantAttribution: (links ?? []).length > 0,
      substantive: hasCase || hasAppointment,
    };
  } catch {
    return failed;
  }
}

/**
 * First attribution for a customer who is new to this tenant. Skips (never throws) when the
 * snapshot is missing or for another customer/tenant, the introducer is not an active
 * introducer of this tenant, the tenant already attributes this customer, or the customer
 * already had a case or appointment here. An existing row is never modified.
 */
export async function createTenantAttributionIfEligible(
  db: AdminDb,
  opts: {
    customerId: string;
    tenantId: string;
    introducerId: string;
    source: "booking";
    snapshot: TenantCustomerSnapshot;
  },
): Promise<boolean> {
  try {
    const { snapshot } = opts;
    if (
      !snapshot.ok ||
      snapshot.tenantId !== opts.tenantId ||
      snapshot.customerId !== opts.customerId ||
      !AUTOMATIC_SOURCES.has(opts.source)
    ) {
      return false;
    }

    const { data: intro, error: introErr } = await db
      .from("introducers")
      .select("id")
      .eq("id", opts.introducerId)
      .eq("tenant_id", opts.tenantId)
      .eq("active", true)
      .is("deleted_at", null)
      .maybeSingle();
    if (introErr || !intro) return false;

    if (snapshot.hasTenantAttribution || snapshot.substantive) return false;

    const { error } = await db.from("customer_introducer_links").upsert(
      {
        tenant_id: opts.tenantId,
        customer_id: opts.customerId,
        introducer_id: opts.introducerId,
        source: opts.source,
      },
      { onConflict: "tenant_id,customer_id", ignoreDuplicates: true },
    );
    if (error) {
      console.error("createTenantAttributionIfEligible failed", error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("createTenantAttributionIfEligible failed", e);
    return false;
  }
}

/** The one active introducer of this tenant with this company code; anything else fails closed. */
export async function resolveTenantIntroducerByCode(
  db: AdminDb,
  tenantId: string,
  companyCode: string,
): Promise<{ id: string; companyCode: string; companyName: string | null }> {
  if (!UUID_PATTERN.test(tenantId) || !COMPANY_CODE_PATTERN.test(companyCode)) {
    throw new Error(NO_ACTIVE_INTRODUCER_FOR_CODE_MESSAGE);
  }
  const { data, error } = await db
    .from("introducers")
    .select("id, company_code, company_name")
    .eq("tenant_id", tenantId)
    .eq("company_code", companyCode)
    .eq("active", true)
    .is("deleted_at", null)
    .limit(2);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{
    id: string;
    company_code: string | null;
    company_name: string | null;
  }>;
  if (rows.length !== 1) throw new Error(NO_ACTIVE_INTRODUCER_FOR_CODE_MESSAGE);
  return {
    id: rows[0].id,
    companyCode: rows[0].company_code ?? companyCode,
    companyName: rows[0].company_name ?? null,
  };
}

/**
 * Introducer attributed to this customer at `asOf` in the session's tenant. The tenant comes
 * only from a session of this customer; without one (or for a tenantless session) the answer is
 * null rather than another tenant's attribution.
 */
export async function resolveIntroducerIdForCustomerAtDate(
  supabaseAdmin: SupabaseAdmin,
  customerId: string,
  asOf: Date,
  sessionId?: string | null,
): Promise<string | null> {
  if (!sessionId) return null;
  const db = supabaseAdmin as AdminDb;
  const { data: session } = await db
    .from("interview_sessions")
    .select("tenant_id")
    .eq("id", sessionId)
    .eq("customer_id", customerId)
    .maybeSingle();
  const tenantId = (session?.tenant_id as string | null | undefined) ?? null;
  if (!tenantId) return null;

  const { data: history } = await db
    .from("introducer_amendment_history")
    .select("new_introducer_id")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .lte("effective_from", asOf.toISOString())
    .order("effective_from", { ascending: false })
    .limit(1);
  if (history?.[0]?.new_introducer_id) return history[0].new_introducer_id as string;

  const { data: link } = await db
    .from("customer_introducer_links")
    .select("introducer_id, effective_from, created_at")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .maybeSingle();
  if (!link?.introducer_id) return null;
  // created_at marks the first attribution in this tenant; amendments never move it.
  const created = (link.created_at as string | null) ?? null;
  if (!created || new Date(created).getTime() > asOf.getTime()) return null;
  const eff = (link.effective_from as string | null) ?? null;
  if (!eff || new Date(eff).getTime() <= asOf.getTime()) return link.introducer_id as string;

  // Amended after asOf: the earliest later amendment records who was attributed before it.
  const { data: later } = await db
    .from("introducer_amendment_history")
    .select("previous_introducer_id")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .gt("effective_from", asOf.toISOString())
    .order("effective_from", { ascending: true })
    .limit(1);
  return (later?.[0]?.previous_introducer_id as string | null | undefined) ?? null;
}
