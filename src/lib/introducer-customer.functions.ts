import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ResourceCapability } from "@/lib/tenant-assert.server";

type AdminDb = (typeof import("@/integrations/supabase/client.server"))["supabaseAdminUntyped"];

export const COMMISSION_REFRESH_DISABLED_MESSAGE =
  "Commission refresh is not available. Historical commission is unchanged.";

export type CustomerIntroducerInfo = {
  customerId: string;
  introducerId: string | null;
  companyCode: string | null;
  companyName: string | null;
  effectiveFrom: string | null;
  /** True when the introducer row is a staff advisor/admin attribution (not an external firm). */
  isStaff: boolean;
};

/** Introducer attribution is looked up and amended by the acting tenant's Owner only. */
function ownerCapability(mutate: boolean): ResourceCapability {
  return { mutate, allocation: "none", allow: (v) => v.adminAccess.isOwner };
}

/** A session named alongside a customer must be that customer's live session in the tenant. */
async function assertCustomerSessionInTenant(
  db: AdminDb,
  sessionId: string,
  customerId: string,
  tenantId: string,
): Promise<void> {
  const { RESOURCE_NOT_FOUND_MESSAGE } = await import("@/lib/tenant-assert.server");
  const { data, error } = await db
    .from("interview_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(RESOURCE_NOT_FOUND_MESSAGE);
}

export const lookupIntroducerByCode = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ companyCode: z.string().regex(/^\d{4}$/) }).parse(d))
  .handler(async ({ data, context }) => {
    const { resolveActingTenantForList } = await import("@/lib/tenant-assert.server");
    const { tenantId } = await resolveActingTenantForList(context.userId, ownerCapability(false));
    const { supabaseAdminUntyped: supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    const { resolveTenantIntroducerByCode } = await import("@/lib/introducer-attribution");
    const intro = await resolveTenantIntroducerByCode(supabaseAdmin, tenantId, data.companyCode);
    return { companyCode: intro.companyCode, companyName: intro.companyName };
  });

export const getCustomerIntroducer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ customerId: z.string().uuid(), sessionId: z.string().uuid().optional() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<CustomerIntroducerInfo> => {
    const { authoriseTenantCustomer } = await import("@/lib/tenant-assert.server");
    const { staffCustomerCapability } = await import("@/lib/sessions.functions");
    const { tenantId } = await authoriseTenantCustomer({
      userId: context.userId,
      customerId: data.customerId,
      capability: staffCustomerCapability(false),
    });
    const { supabaseAdminUntyped: supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    if (data.sessionId) {
      await assertCustomerSessionInTenant(supabaseAdmin, data.sessionId, data.customerId, tenantId);
    }

    const empty: CustomerIntroducerInfo = {
      customerId: data.customerId,
      introducerId: null,
      companyCode: null,
      companyName: null,
      effectiveFrom: null,
      isStaff: false,
    };
    const { getTenantAttribution } = await import("@/lib/introducer-attribution");
    const attribution = await getTenantAttribution(supabaseAdmin, tenantId, data.customerId);
    if (!attribution) return empty;

    const { data: intro, error } = await supabaseAdmin
      .from("introducers")
      .select("id, company_code, company_name, user_id")
      .eq("id", attribution.introducerId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!intro) return empty;

    let isStaff = false;
    if (intro.user_id) {
      const { loadTenantRoleForTenantId } = await import("@/lib/tenant-role.server");
      const targetView = await loadTenantRoleForTenantId(intro.user_id as string, tenantId);
      isStaff = targetView.isAdvisor || targetView.isMainAdmin;
    }

    return {
      customerId: data.customerId,
      introducerId: attribution.introducerId,
      companyCode: (intro.company_code as string | null) ?? null,
      companyName: (intro.company_name as string | null) ?? null,
      effectiveFrom: attribution.effectiveFrom,
      isStaff,
    };
  });

function amendmentErrorMessage(message: string, notFound: string, noIntroducer: string): string {
  if (message.includes("attribution_introducer_not_found")) return noIntroducer;
  if (
    message.includes("attribution_customer_not_found") ||
    message.includes("attribution_session_not_found") ||
    message.includes("attribution_tenant_inactive")
  ) {
    return notFound;
  }
  return "Could not amend the introducer.";
}

export const amendCustomerIntroducer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        customerId: z.string().uuid(),
        sessionId: z.string().uuid().optional(),
        companyCode: z.string().regex(/^\d{4}$/),
        note: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { authoriseTenantCustomer, RESOURCE_NOT_FOUND_MESSAGE } =
      await import("@/lib/tenant-assert.server");
    const { tenantId } = await authoriseTenantCustomer({
      userId: context.userId,
      customerId: data.customerId,
      capability: ownerCapability(true),
    });
    const { supabaseAdminUntyped: supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    if (data.sessionId) {
      await assertCustomerSessionInTenant(supabaseAdmin, data.sessionId, data.customerId, tenantId);
    }
    const { resolveTenantIntroducerByCode, NO_ACTIVE_INTRODUCER_FOR_CODE_MESSAGE } =
      await import("@/lib/introducer-attribution");
    const intro = await resolveTenantIntroducerByCode(supabaseAdmin, tenantId, data.companyCode);

    const { data: rows, error } = await supabaseAdmin.rpc("amend_customer_introducer_attribution", {
      p_tenant_id: tenantId,
      p_customer_id: data.customerId,
      p_introducer_id: intro.id,
      p_changed_by: context.userId,
      p_session_id: data.sessionId ?? null,
      p_note: data.note ?? null,
    });
    if (error) {
      throw new Error(
        amendmentErrorMessage(
          String(error.message ?? ""),
          RESOURCE_NOT_FOUND_MESSAGE,
          NO_ACTIVE_INTRODUCER_FOR_CODE_MESSAGE,
        ),
      );
    }
    const result = ((rows ?? []) as Array<{ changed: boolean; effective_from: string | null }>)[0];
    if (!result) throw new Error("Could not amend the introducer.");

    if (result.changed && data.sessionId) {
      const effective = result.effective_from ? new Date(result.effective_from) : new Date();
      const { error: logErr } = await supabaseAdmin.from("customer_contact_log").insert({
        session_id: data.sessionId,
        author_id: context.userId,
        entry_type: "note",
        tenant_id: tenantId,
        body: `Introducer amended to ${intro.companyName ?? intro.companyCode} (${intro.companyCode}). Applies from ${effective.toLocaleDateString("en-GB")}; historical commission is unchanged.`,
      });
      if (logErr) console.error("contact log", logErr);
    }

    return { ok: true, changed: Boolean(result.changed) };
  });

/** Backdated commission reattribution is disabled: it rewrote ledger rows across tenants. */
export const refreshCustomerIntroducerCommission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ customerId: z.string().uuid(), sessionId: z.string().uuid().optional() }).parse(d),
  )
  .handler(async (): Promise<{ ok: boolean; adjusted: number }> => {
    throw new Error(COMMISSION_REFRESH_DISABLED_MESSAGE);
  });
