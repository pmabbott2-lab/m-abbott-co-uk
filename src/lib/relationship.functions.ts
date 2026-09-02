import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveAdminAccess } from "@/lib/admin.functions";
import { canViewRelationship } from "@/lib/admin-access";
import { journeyStageFromMilestones, JOURNEY_MILESTONE_KEYS } from "@/lib/sessions.functions";
import {
  computeActionableFromDate,
  normalizeLenderKey,
  researchLenderLeadTimeDays,
} from "@/lib/lender-remortgage.server";

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const msg = (error.message ?? "").toLowerCase();
  return code === "42P01" || code === "42703" || msg.includes("does not exist") || msg.includes("schema cache");
}

export type RelationshipPipelineRow = {
  sessionId: string;
  caseRef: string | null;
  customerId: string | null;
  customerName: string;
  advisorNames: string[];
  currentLender: string | null;
  productExpiryDate: string | null;
  actionableFromDate: string | null;
  actionableNote: string | null;
  monthlyPaymentPence: number | null;
  journeyStage: string;
};

export const listRelationshipPipeline = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        withinDays: z.number().int().min(1).max(730).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!canViewRelationship(access)) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: details, error } = await supabaseAdmin
      .from("case_mortgage_details")
      .select(
        "session_id, current_lender, product_expiry_date, actionable_from_date, actionable_note, monthly_payment_pence",
      )
      .not("product_expiry_date", "is", null)
      .order("product_expiry_date", { ascending: true })
      .limit(500);
    if (error) {
      if (isMissingTable(error)) return { rows: [] as RelationshipPipelineRow[], migrationRequired: true };
      throw new Error(error.message);
    }

    const sessionIds = (details ?? []).map((d) => d.session_id);
    if (!sessionIds.length) return { rows: [], migrationRequired: false };

    const { data: sessions } = await supabaseAdmin
      .from("interview_sessions")
      .select("id, case_ref, customer_id, deleted_at")
      .in("id", sessionIds);
    const sessionMap = new Map((sessions ?? []).filter((s) => !s.deleted_at).map((s) => [s.id, s]));

    const customerIds = [...new Set((sessions ?? []).map((s) => s.customer_id).filter(Boolean))] as string[];
    const profileMap = new Map<string, string>();
    if (customerIds.length) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name")
        .in("id", customerIds);
      for (const p of profiles ?? []) profileMap.set(p.id, p.full_name ?? "Customer");
    }

    const { data: milestones } = await supabaseAdmin
      .from("customer_journey_milestones")
      .select("session_id, milestone_key")
      .in("session_id", sessionIds);
    const milestoneMap = new Map<string, string[]>();
    for (const m of milestones ?? []) {
      const list = milestoneMap.get(m.session_id) ?? [];
      list.push(m.milestone_key);
      milestoneMap.set(m.session_id, list);
    }

    const { data: allocations } = await supabaseAdmin
      .from("session_advisors")
      .select("session_id, advisor_id")
      .in("session_id", sessionIds);
    const advisorIds = [...new Set((allocations ?? []).map((a) => a.advisor_id))];
    const advisorNameMap = new Map<string, string>();
    if (advisorIds.length) {
      const { data: advisors } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name")
        .in("id", advisorIds);
      for (const a of advisors ?? []) advisorNameMap.set(a.id, a.full_name ?? "Advisor");
    }
    const sessionAdvisorMap = new Map<string, string[]>();
    for (const a of allocations ?? []) {
      const names = sessionAdvisorMap.get(a.session_id) ?? [];
      names.push(advisorNameMap.get(a.advisor_id) ?? "Advisor");
      sessionAdvisorMap.set(a.session_id, names);
    }

    const withinDays = data.withinDays ?? 365;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + withinDays);

    const rows: RelationshipPipelineRow[] = [];
    for (const d of details ?? []) {
      const session = sessionMap.get(d.session_id);
      if (!session?.case_ref) continue;
      if (d.product_expiry_date && new Date(d.product_expiry_date) > cutoff) continue;

      const completed = (milestoneMap.get(d.session_id) ?? []).filter((k) =>
        (JOURNEY_MILESTONE_KEYS as readonly string[]).includes(k),
      ) as Array<typeof JOURNEY_MILESTONE_KEYS[number]>;

      rows.push({
        sessionId: d.session_id,
        caseRef: session.case_ref,
        customerId: session.customer_id,
        customerName: session.customer_id
          ? profileMap.get(session.customer_id) ?? "Customer"
          : "Customer",
        advisorNames: sessionAdvisorMap.get(d.session_id) ?? [],
        currentLender: d.current_lender ?? null,
        productExpiryDate: d.product_expiry_date ?? null,
        actionableFromDate: d.actionable_from_date ?? null,
        actionableNote: d.actionable_note ?? null,
        monthlyPaymentPence: d.monthly_payment_pence ?? null,
        journeyStage: journeyStageFromMilestones(completed),
      });
    }

    return { rows, migrationRequired: false };
  });

export const refreshRelationshipActionableDates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!canViewRelationship(access)) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("case_mortgage_details")
      .select("session_id, current_lender, product_expiry_date")
      .not("product_expiry_date", "is", null)
      .not("current_lender", "is", null);
    if (error) {
      if (isMissingTable(error)) throw new Error("Run supabase/RUN_JOURNEY_FINANCE_CASE.sql first.");
      throw new Error(error.message);
    }

    const now = new Date().toISOString();
    let updated = 0;

    for (const row of rows ?? []) {
      const lender = row.current_lender?.trim();
      const expiry = row.product_expiry_date;
      if (!lender || !expiry) continue;

      const key = normalizeLenderKey(lender);
      let leadDays = 90;
      let notes = "Weekly refresh — verify with lender.";

      const researched = await researchLenderLeadTimeDays(lender);
      leadDays = researched.leadTimeDays;
      notes = researched.notes;

      await supabaseAdmin.from("lender_remortgage_policies").upsert(
        {
          lender_key: key,
          lender_display_name: lender,
          lead_time_days: leadDays,
          source: "ai",
          notes,
          refreshed_at: now,
        },
        { onConflict: "lender_key" },
      );

      const actionableFrom = computeActionableFromDate(expiry, leadDays);
      await supabaseAdmin
        .from("case_mortgage_details")
        .update({
          actionable_from_date: actionableFrom,
          actionable_note: `Indicative — book from ~${leadDays} days before ERC/product end. ${notes}`,
          actionable_refreshed_at: now,
          updated_at: now,
        })
        .eq("session_id", row.session_id);
      updated += 1;
    }

    return { ok: true, updated };
  });
