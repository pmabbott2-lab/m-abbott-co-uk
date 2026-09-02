import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveAdminAccess } from "@/lib/admin.functions";
import { canView, canAmend } from "@/lib/admin-access";
import { computeActionableFromDate, normalizeLenderKey, researchLenderLeadTimeDays } from "@/lib/lender-remortgage.server";

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const msg = (error.message ?? "").toLowerCase();
  return code === "42P01" || code === "42703" || msg.includes("does not exist") || msg.includes("schema cache");
}

export type CaseMortgageDetails = {
  sessionId: string;
  currentLender: string | null;
  productExpiryDate: string | null;
  amountBorrowedPence: number | null;
  houseValuationPence: number | null;
  currentRatePct: number | null;
  monthlyPaymentPence: number | null;
  actionableFromDate: string | null;
  actionableNote: string | null;
  actionableRefreshedAt: string | null;
  updatedAt: string | null;
};

export const getCaseMortgageDetails = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!canView(access, "customers")) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("case_mortgage_details")
      .select("*")
      .eq("session_id", data.sessionId)
      .maybeSingle();
    if (error) {
      if (isMissingTable(error)) return { details: null, migrationRequired: true };
      throw new Error(error.message);
    }
    if (!row) return { details: null, migrationRequired: false };

    return {
      migrationRequired: false,
      details: {
        sessionId: row.session_id,
        currentLender: row.current_lender ?? null,
        productExpiryDate: row.product_expiry_date ?? null,
        amountBorrowedPence: row.amount_borrowed_pence ?? null,
        houseValuationPence: row.house_valuation_pence ?? null,
        currentRatePct: row.current_rate_pct != null ? Number(row.current_rate_pct) : null,
        monthlyPaymentPence: row.monthly_payment_pence ?? null,
        actionableFromDate: row.actionable_from_date ?? null,
        actionableNote: row.actionable_note ?? null,
        actionableRefreshedAt: row.actionable_refreshed_at ?? null,
        updatedAt: row.updated_at ?? null,
      } satisfies CaseMortgageDetails,
    };
  });

export const upsertCaseMortgageDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        currentLender: z.string().max(200).optional().nullable(),
        productExpiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
        amountBorrowedPounds: z.number().min(0).optional().nullable(),
        houseValuationPounds: z.number().min(0).optional().nullable(),
        currentRatePct: z.number().min(0).max(30).optional().nullable(),
        monthlyPaymentPounds: z.number().min(0).optional().nullable(),
        actionableFromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!canAmend(access, "customers")) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();

    let actionableFromDate = data.actionableFromDate ?? null;
    let actionableNote: string | null = null;
    let actionableRefreshedAt: string | null = null;

    if (!actionableFromDate && data.productExpiryDate && data.currentLender?.trim()) {
      const leadDays = await resolveLeadTimeDays(supabaseAdmin, data.currentLender.trim());
      actionableFromDate = computeActionableFromDate(data.productExpiryDate, leadDays);
      actionableNote =
        "Indicative - lender may allow booking ~" +
        leadDays +
        " days before ERC/product end. Confirm with lender.";
      actionableRefreshedAt = now;
    }

    const patch = {
      session_id: data.sessionId,
      current_lender: data.currentLender?.trim() || null,
      product_expiry_date: data.productExpiryDate ?? null,
      amount_borrowed_pence:
        data.amountBorrowedPounds != null ? Math.round(data.amountBorrowedPounds * 100) : null,
      house_valuation_pence:
        data.houseValuationPounds != null ? Math.round(data.houseValuationPounds * 100) : null,
      current_rate_pct: data.currentRatePct ?? null,
      monthly_payment_pence:
        data.monthlyPaymentPounds != null ? Math.round(data.monthlyPaymentPounds * 100) : null,
      actionable_from_date: actionableFromDate,
      actionable_note: actionableNote,
      actionable_refreshed_at: actionableRefreshedAt,
      updated_by: context.userId,
      updated_at: now,
    };

    const { error } = await supabaseAdmin.from("case_mortgage_details").upsert(patch, {
      onConflict: "session_id",
    });
    if (error) {
      if (isMissingTable(error)) throw new Error("Run supabase/RUN_JOURNEY_FINANCE_CASE.sql first.");
      throw new Error(error.message);
    }

    return { ok: true };
  });

async function resolveLeadTimeDays(
  supabaseAdmin: Awaited<
    ReturnType<typeof import("@/integrations/supabase/client.server")>
  >["supabaseAdmin"],
  lenderName: string,
): Promise<number> {
  const key = normalizeLenderKey(lenderName);
  const { data: cached } = await supabaseAdmin
    .from("lender_remortgage_policies")
    .select("lead_time_days")
    .eq("lender_key", key)
    .maybeSingle();
  if (cached?.lead_time_days != null) return Number(cached.lead_time_days);

  const researched = await researchLenderLeadTimeDays(lenderName);
  await supabaseAdmin.from("lender_remortgage_policies").upsert(
    {
      lender_key: key,
      lender_display_name: lenderName,
      lead_time_days: researched.leadTimeDays,
      source: "ai",
      notes: researched.notes,
      refreshed_at: new Date().toISOString(),
    },
    { onConflict: "lender_key" },
  );
  return researched.leadTimeDays;
}
