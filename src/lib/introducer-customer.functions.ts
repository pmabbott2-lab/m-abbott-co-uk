import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveAdminAccess } from "@/lib/admin.functions";
import { canAmendIntroducer, canRefreshIntroducerCommission } from "@/lib/admin-access";

function isMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    error.code === "PGRST204" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

async function logFinanceAudit(
  supabaseAdmin: Awaited<
    ReturnType<typeof import("@/integrations/supabase/client.server")>
  >["supabaseAdmin"],
  row: {
    audit_type: string;
    subject_user_id?: string | null;
    customer_id?: string | null;
    session_id?: string | null;
    role?: string | null;
    fee_type?: string | null;
    summary: string;
    detail?: Record<string, unknown>;
    changed_by: string;
  },
) {
  const { error } = await supabaseAdmin.from("finance_audit_log").insert({
    audit_type: row.audit_type,
    subject_user_id: row.subject_user_id ?? null,
    customer_id: row.customer_id ?? null,
    session_id: row.session_id ?? null,
    role: row.role ?? null,
    fee_type: row.fee_type ?? null,
    summary: row.summary,
    detail: row.detail ?? null,
    changed_by: row.changed_by,
  });
  if (error && !isMissing(error)) console.error("finance_audit_log", error);
}

export type CustomerIntroducerInfo = {
  customerId: string;
  introducerId: string | null;
  companyCode: string | null;
  companyName: string | null;
  effectiveFrom: string | null;
  /** True when the introducer row is a staff advisor/admin attribution (not an external firm). */
  isStaff: boolean;
};

export const lookupIntroducerByCode = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ companyCode: z.string().regex(/^\d{4}$/) }).parse(d))
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!access.isAdmin && !(await context.supabase.from("user_roles").select("role").eq("user_id", context.userId).eq("role", "advisor")).data?.length) {
      throw new Error("Forbidden");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: intro, error } = await supabaseAdmin
      .from("introducers")
      .select("id, company_name, company_code, active, deleted_at")
      .eq("company_code", data.companyCode)
      .is("deleted_at", null)
      .maybeSingle();
    if (error && !isMissing(error)) throw new Error(error.message);
    if (!intro || !intro.active) throw new Error(`No active introducer found for code ${data.companyCode}.`);
    return {
      introducerId: intro.id as string,
      companyCode: (intro as { company_code?: string }).company_code ?? data.companyCode,
      companyName: (intro as { company_name?: string | null }).company_name ?? null,
    };
  });

export const getCustomerIntroducer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ customerId: z.string().uuid(), sessionId: z.string().uuid().optional() }).parse(d),
  )
  .handler(async ({ data }): Promise<CustomerIntroducerInfo> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveIntroducerIdForCustomer } = await import("@/lib/introducer-attribution");
    const introducerId = await resolveIntroducerIdForCustomer(
      supabaseAdmin,
      data.customerId,
      data.sessionId ?? null,
    );

    if (!introducerId) {
      return {
        customerId: data.customerId,
        introducerId: null,
        companyCode: null,
        companyName: null,
        effectiveFrom: null,
        isStaff: false,
      };
    }

    const { data: intro } = await supabaseAdmin
      .from("introducers")
      .select("id, company_code, company_name, user_id")
      .eq("id", introducerId)
      .maybeSingle();

    const { data: link } = await supabaseAdmin
      .from("customer_introducer_links")
      .select("effective_from")
      .eq("customer_id", data.customerId)
      .maybeSingle();

    let isStaff = false;
    const introUserId = (intro as { user_id?: string | null } | null)?.user_id ?? null;
    if (introUserId) {
      const { data: roles } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", introUserId);
      isStaff = (roles ?? []).some((r) => r.role === "advisor" || r.role === "admin");
    }

    return {
      customerId: data.customerId,
      introducerId,
      companyCode: (intro as { company_code?: string | null })?.company_code ?? null,
      companyName: (intro as { company_name?: string | null })?.company_name ?? null,
      effectiveFrom: (link as { effective_from?: string | null })?.effective_from ?? null,
      isStaff,
    };
  });

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
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!canAmendIntroducer(access)) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: intro, error: introErr } = await supabaseAdmin
      .from("introducers")
      .select("id, company_name, company_code")
      .eq("company_code", data.companyCode)
      .is("deleted_at", null)
      .maybeSingle();
    if (introErr && !isMissing(introErr)) throw new Error(introErr.message);
    if (!intro) throw new Error(`No introducer found for code ${data.companyCode}.`);

    const { data: prevLink } = await supabaseAdmin
      .from("customer_introducer_links")
      .select("introducer_id")
      .eq("customer_id", data.customerId)
      .maybeSingle();

    const now = new Date().toISOString();
    const { error: linkErr } = await supabaseAdmin.from("customer_introducer_links").upsert(
      {
        customer_id: data.customerId,
        introducer_id: intro.id,
        source: "amended",
        effective_from: now,
        updated_at: now,
      },
      { onConflict: "customer_id" },
    );
    if (linkErr && !isMissing(linkErr)) throw new Error(linkErr.message);

    const { error: histErr } = await supabaseAdmin.from("introducer_amendment_history").insert({
      customer_id: data.customerId,
      session_id: data.sessionId ?? null,
      previous_introducer_id: prevLink?.introducer_id ?? null,
      new_introducer_id: intro.id,
      company_code: intro.company_code,
      company_name: intro.company_name,
      effective_from: now,
      commission_refreshed: false,
      changed_by: context.userId,
      note: data.note ?? null,
    });
    if (histErr && !isMissing(histErr)) throw new Error(histErr.message);

    const prevName = prevLink?.introducer_id
      ? (
          await supabaseAdmin
            .from("introducers")
            .select("company_name, company_code")
            .eq("id", prevLink.introducer_id)
            .maybeSingle()
        ).data
      : null;

    await logFinanceAudit(supabaseAdmin, {
      audit_type: "introducer_amendment",
      customer_id: data.customerId,
      session_id: data.sessionId ?? null,
      summary: `Introducer amended to ${intro.company_name ?? intro.company_code} (${intro.company_code})`,
      detail: {
        previous: prevName
          ? `${prevName.company_name ?? ""} (${prevName.company_code ?? ""})`.trim()
          : "None",
        new: `${intro.company_name ?? ""} (${intro.company_code ?? ""})`.trim(),
        effectiveFrom: now,
        commissionRefresh: false,
      },
      changed_by: context.userId,
    });

    if (data.sessionId) {
      const { appendContactLog } = await import("@/lib/booking.functions");
      await appendContactLogPublic(
        supabaseAdmin,
        data.sessionId,
        context.userId,
        `Introducer amended to ${intro.company_name ?? intro.company_code} (${intro.company_code}). Commission from ${new Date(now).toLocaleDateString("en-GB")} only unless owner refreshes.`,
      );
    }

    return { ok: true, introducerId: intro.id as string };
  });

async function appendContactLogPublic(
  supabaseAdmin: Awaited<
    ReturnType<typeof import("@/integrations/supabase/client.server")>
  >["supabaseAdmin"],
  sessionId: string,
  authorId: string,
  body: string,
) {
  const { error } = await supabaseAdmin.from("customer_contact_log").insert({
    session_id: sessionId,
    author_id: authorId,
    entry_type: "note",
    body,
  });
  if (error && !isMissing(error)) console.error("contact log", error);
}

export const refreshCustomerIntroducerCommission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ customerId: z.string().uuid(), sessionId: z.string().uuid().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!canRefreshIntroducerCommission(access)) throw new Error("Owner only");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveIntroducerIdForCustomer } = await import("@/lib/introducer-attribution");

    const newIntroducerId = await resolveIntroducerIdForCustomer(
      supabaseAdmin,
      data.customerId,
      data.sessionId ?? null,
    );
    if (!newIntroducerId) throw new Error("No introducer linked to this customer.");

    const { data: intro } = await supabaseAdmin
      .from("introducers")
      .select("user_id, company_name, company_code")
      .eq("id", newIntroducerId)
      .maybeSingle();
    if (!intro?.user_id) throw new Error("Introducer has no user account.");

    const { data: sessions } = await supabaseAdmin
      .from("interview_sessions")
      .select("id")
      .eq("customer_id", data.customerId)
      .is("deleted_at", null);
    const sessionIds = (sessions ?? []).map((s) => s.id);
    if (sessionIds.length === 0) return { ok: true, adjusted: 0 };

    const { data: ledgerRows, error } = await supabaseAdmin
      .from("finance_ledger")
      .select("*")
      .in("session_id", sessionIds)
      .eq("kind", "commission")
      .eq("beneficiary_role", "introducer");
    if (error && !isMissing(error)) throw new Error(error.message);

    let adjusted = 0;
    const now = new Date().toISOString();

    for (const row of ledgerRows ?? []) {
      if (row.beneficiary_user_id === intro.user_id) continue;

      await supabaseAdmin.from("finance_ledger").insert({
        session_id: row.session_id,
        fee_line_id: row.fee_line_id,
        kind: "commission",
        fee_type: row.fee_type,
        amount_pence: -row.amount_pence,
        is_reversal: true,
        beneficiary_user_id: row.beneficiary_user_id,
        beneficiary_role: "introducer",
        commission_pct: row.commission_pct,
        note: "Commission refresh — reversal (introducer amended)",
        created_by: context.userId,
      });

      await supabaseAdmin.from("finance_ledger").insert({
        session_id: row.session_id,
        fee_line_id: row.fee_line_id,
        kind: "commission",
        fee_type: row.fee_type,
        amount_pence: row.amount_pence,
        is_reversal: false,
        beneficiary_user_id: intro.user_id,
        beneficiary_role: "introducer",
        commission_pct: row.commission_pct,
        payout_status: row.payout_status ?? "pending",
        note: "Commission refresh — reattributed to amended introducer",
        created_by: context.userId,
      });
      adjusted++;
    }

    await supabaseAdmin.from("introducer_amendment_history").insert({
      customer_id: data.customerId,
      session_id: data.sessionId ?? null,
      new_introducer_id: newIntroducerId,
      company_code: intro.company_code,
      company_name: intro.company_name,
      effective_from: now,
      commission_refreshed: true,
      changed_by: context.userId,
      note: `Commission refreshed — ${adjusted} entries reattributed`,
    });

    await logFinanceAudit(supabaseAdmin, {
      audit_type: "commission_refresh",
      customer_id: data.customerId,
      session_id: data.sessionId ?? null,
      summary: `Commission backdated to ${intro.company_name ?? intro.company_code} (${adjusted} entries)`,
      detail: { adjusted, introducerId: newIntroducerId },
      changed_by: context.userId,
    });

    if (data.sessionId) {
      await appendContactLogPublic(
        supabaseAdmin,
        data.sessionId,
        context.userId,
        `Owner refreshed introducer commission — ${adjusted} ledger entries reattributed to ${intro.company_name ?? intro.company_code}.`,
      );
    }

    return { ok: true, adjusted };
  });
