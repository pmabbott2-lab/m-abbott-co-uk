/**
 * Network commission statements — monthly intake, AI parse, allocate to customers.
 * Server functions only; uses service role for writes.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveAdminAccess } from "@/lib/admin.functions";
import {
  canAmend,
  canView,
  canViewCommissionPayouts,
  type AdminAccess,
} from "@/lib/admin-access";

const FEE_TYPES = ["fee", "mortgage_fee", "insurance_fee", "other_fee"] as const;

function isMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const msg = (error.message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

function canViewNetwork(access: AdminAccess): boolean {
  return (
    access.isOwner ||
    access.isSupervisor ||
    canView(access, "finance_network_statements") ||
    canViewCommissionPayouts(access)
  );
}

function canAmendNetwork(access: AdminAccess): boolean {
  return (
    access.isOwner ||
    access.isSupervisor ||
    canAmend(access, "finance_network_statements")
  );
}

function canValidateNetwork(access: AdminAccess): boolean {
  return (
    access.isOwner ||
    access.isSupervisor ||
    canAmend(access, "finance_network_validate")
  );
}

function monthStart(period: string): string {
  // Accept YYYY-MM or YYYY-MM-DD
  const m = period.match(/^(\d{4})-(\d{2})/);
  if (!m) throw new Error("Period must be YYYY-MM");
  return `${m[1]}-${m[2]}-01`;
}

function periodLabel(periodMonth: string): string {
  const d = new Date(periodMonth);
  if (Number.isNaN(d.getTime())) return periodMonth;
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

export const listNetworkStatementMonths = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!canViewNetwork(access)) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("network_commission_statements")
      .select("id, period_month, status, notes, validated_at, created_at")
      .order("period_month", { ascending: false });
    if (error) {
      if (isMissing(error)) return { months: [], migrationRequired: true as const };
      throw new Error(error.message);
    }

    // Offer current + previous 17 months even if no row yet.
    const options: { periodMonth: string; label: string; statementId: string | null; status: string | null }[] = [];
    const byPeriod = new Map((data ?? []).map((r) => [String(r.period_month).slice(0, 10), r]));
    const now = new Date();
    for (let i = 0; i < 18; i += 1) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const key = d.toISOString().slice(0, 10);
      const existing = byPeriod.get(key);
      options.push({
        periodMonth: key,
        label: periodLabel(key),
        statementId: existing?.id ?? null,
        status: existing?.status ?? null,
      });
    }
    return { months: options, migrationRequired: false as const };
  });

export const getOrCreateNetworkStatement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ periodMonth: z.string().min(7).max(10) }).parse(d))
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!canAmendNetwork(access)) throw new Error("Forbidden");

    const period = monthStart(data.periodMonth);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin
      .from("network_commission_statements")
      .select("*")
      .eq("period_month", period)
      .maybeSingle();
    if (existing) return { statement: existing, created: false };

    const { data: inserted, error } = await supabaseAdmin
      .from("network_commission_statements")
      .insert({
        period_month: period,
        status: "draft",
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error) {
      if (isMissing(error)) throw new Error("Run supabase/RUN_NETWORK_COMMISSION.sql in Supabase first.");
      throw new Error(error.message);
    }
    return { statement: inserted, created: true };
  });

export const getNetworkStatementDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ statementId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!canViewNetwork(access)) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: statement, error } = await supabaseAdmin
      .from("network_commission_statements")
      .select("*")
      .eq("id", data.statementId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!statement) throw new Error("Statement not found");

    const { data: lines, error: lineErr } = await supabaseAdmin
      .from("network_commission_lines")
      .select("*")
      .eq("statement_id", data.statementId)
      .order("line_no", { ascending: true });
    if (lineErr) throw new Error(lineErr.message);

    return { statement, lines: lines ?? [] };
  });

export const parseNetworkStatementWithAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        statementId: z.string().uuid(),
        rawText: z.string().min(20).max(200_000),
        replaceExisting: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!canAmendNetwork(access)) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: statement } = await supabaseAdmin
      .from("network_commission_statements")
      .select("id, status")
      .eq("id", data.statementId)
      .maybeSingle();
    if (!statement) throw new Error("Statement not found");
    if (statement.status === "locked" || statement.status === "validated") {
      throw new Error("This statement is validated/locked — unlock before re-parsing.");
    }

    const { chatCompletion } = await import("@/lib/openai.server");
    const content = await chatCompletion({
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You extract mortgage network commission statement lines into JSON.
Return {"lines":[{"customerName":string|null,"customerEmail":string|null,"caseRef":string|null,"feeType":"fee"|"mortgage_fee"|"insurance_fee"|"other_fee","amountPounds":number,"networkProduct":string|null,"notes":string|null}]}
Rules:
- amountPounds is the commission/fee amount received from the network (positive number, pounds).
- Prefer feeType "fee" for procuration / advice / main case fee. Use mortgage_fee, insurance_fee, other_fee when clearly labelled.
- Skip totals, headers, and subtotals.
- caseRef is any case/policy/application reference if present.`,
        },
        { role: "user", content: data.rawText.slice(0, 180_000) },
      ],
    });

    let parsed: {
      lines?: Array<{
        customerName?: string | null;
        customerEmail?: string | null;
        caseRef?: string | null;
        feeType?: string | null;
        amountPounds?: number | null;
        networkProduct?: string | null;
        notes?: string | null;
      }>;
    };
    try {
      parsed = JSON.parse(content) as typeof parsed;
    } catch {
      throw new Error("AI returned invalid JSON — try pasting a clearer statement extract.");
    }

    const aiLines = parsed.lines ?? [];
    if (!aiLines.length) throw new Error("No commission lines found in the statement text.");

    if (data.replaceExisting !== false) {
      await supabaseAdmin.from("network_commission_lines").delete().eq("statement_id", data.statementId);
    }

    const rows = aiLines
      .map((line, idx) => {
        const amountPounds = Number(line.amountPounds ?? 0);
        if (!Number.isFinite(amountPounds) || amountPounds <= 0) return null;
        const feeType = FEE_TYPES.includes(line.feeType as (typeof FEE_TYPES)[number])
          ? (line.feeType as (typeof FEE_TYPES)[number])
          : "fee";
        return {
          statement_id: data.statementId,
          line_no: idx + 1,
          customer_name: line.customerName?.trim() || null,
          customer_email: line.customerEmail?.trim()?.toLowerCase() || null,
          case_ref: line.caseRef?.trim() || null,
          fee_type: feeType,
          amount_received_pence: Math.round(amountPounds * 100),
          network_product: line.networkProduct?.trim() || null,
          raw_json: line,
          allocation_status: "unmatched",
          annotation: line.notes?.trim() || null,
        };
      })
      .filter(Boolean);

    if (!rows.length) throw new Error("AI found lines but none had a usable amount.");

    const { error: insErr } = await supabaseAdmin.from("network_commission_lines").insert(rows);
    if (insErr) throw new Error(insErr.message);

    await supabaseAdmin
      .from("network_commission_statements")
      .update({
        raw_source: data.rawText.slice(0, 200_000),
        status: "draft",
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.statementId);

    // Best-effort auto-match by email / case ref.
    const { data: inserted } = await supabaseAdmin
      .from("network_commission_lines")
      .select("id, customer_email, case_ref, customer_name")
      .eq("statement_id", data.statementId);

    for (const line of inserted ?? []) {
      let customerId: string | null = null;
      let sessionId: string | null = null;

      if (line.customer_email) {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("email", line.customer_email)
          .maybeSingle();
        customerId = profile?.id ?? null;
      }
      if (!customerId && line.case_ref) {
        const { data: session } = await supabaseAdmin
          .from("interview_sessions")
          .select("id, customer_id")
          .eq("case_ref", line.case_ref)
          .maybeSingle();
        if (session?.customer_id) {
          customerId = session.customer_id;
          sessionId = session.id;
        }
      }
      if (customerId && !sessionId) {
        const { data: latest } = await supabaseAdmin
          .from("interview_sessions")
          .select("id")
          .eq("customer_id", customerId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        sessionId = latest?.id ?? null;
      }
      if (customerId) {
        await supabaseAdmin
          .from("network_commission_lines")
          .update({
            matched_customer_id: customerId,
            matched_session_id: sessionId,
            allocation_status: "matched",
            updated_at: new Date().toISOString(),
          })
          .eq("id", line.id);
      }
    }

    return { ok: true, lineCount: rows.length };
  });

export const allocateNetworkLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        lineId: z.string().uuid(),
        sessionId: z.string().uuid().optional(),
        customerId: z.string().uuid().optional(),
        postFees: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!canAmendNetwork(access)) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: line } = await supabaseAdmin
      .from("network_commission_lines")
      .select("*, network_commission_statements!inner(id, status)")
      .eq("id", data.lineId)
      .maybeSingle();
    if (!line) throw new Error("Line not found");
    const stmtStatus = (line as { network_commission_statements?: { status?: string } })
      .network_commission_statements?.status;
    if (stmtStatus === "locked") throw new Error("Statement is locked.");

    let sessionId = data.sessionId ?? (line.matched_session_id as string | null);
    let customerId = data.customerId ?? (line.matched_customer_id as string | null);

    if (!sessionId && customerId) {
      const { data: latest } = await supabaseAdmin
        .from("interview_sessions")
        .select("id")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      sessionId = latest?.id ?? null;
    }
    if (!sessionId) throw new Error("Select a customer case/session to allocate this line.");

    const { data: session } = await supabaseAdmin
      .from("interview_sessions")
      .select("id, customer_id")
      .eq("id", sessionId)
      .maybeSingle();
    if (!session) throw new Error("Session not found");
    customerId = session.customer_id;

    const feeType = FEE_TYPES.includes(line.fee_type as (typeof FEE_TYPES)[number])
      ? line.fee_type
      : "fee";
    const amountPence = Number(line.amount_received_pence ?? 0);
    if (amountPence <= 0) throw new Error("Line has no amount to allocate.");

    const { data: feeLine, error: feeErr } = await supabaseAdmin
      .from("finance_fee_lines")
      .insert({
        session_id: sessionId,
        fee_type: feeType,
        amount_pence: amountPence,
        note: `Network statement ${String(line.statement_id).slice(0, 8)} · ${line.case_ref ?? line.customer_name ?? "line"}`,
        status: "draft",
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (feeErr) throw new Error(feeErr.message);

    await supabaseAdmin
      .from("network_commission_lines")
      .update({
        matched_customer_id: customerId,
        matched_session_id: sessionId,
        fee_line_id: feeLine.id,
        allocation_status: "allocated",
        allocated_by: context.userId,
        allocated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.lineId);

    // Draft fee line on the customer case — submit from case finance to drive payable commissions.
    return { ok: true, feeLineId: feeLine.id, sessionId, customerId, draft: true };
  });

export const annotateNetworkLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ lineId: z.string().uuid(), annotation: z.string().max(2000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!canAmendNetwork(access)) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("network_commission_lines")
      .update({ annotation: data.annotation, updated_at: new Date().toISOString() })
      .eq("id", data.lineId);
    if (error) throw new Error(error.message);

    const { data: line } = await supabaseAdmin
      .from("network_commission_lines")
      .select("statement_id")
      .eq("id", data.lineId)
      .maybeSingle();
    if (line?.statement_id) {
      await supabaseAdmin
        .from("network_commission_statements")
        .update({ status: "annotated", updated_at: new Date().toISOString() })
        .eq("id", line.statement_id)
        .in("status", ["draft", "annotated"]);
    }
    return { ok: true };
  });

export const validateNetworkStatement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        statementId: z.string().uuid(),
        action: z.enum(["validate", "unlock"]),
        notes: z.string().max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!canValidateNetwork(access)) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.action === "unlock") {
      if (!access.isOwner && !access.isSupervisor) {
        throw new Error("Only owner or supervisor can unlock a validated statement.");
      }
      const { error } = await supabaseAdmin
        .from("network_commission_statements")
        .update({
          status: "draft",
          validated_by: null,
          validated_at: null,
          notes: data.notes ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.statementId);
      if (error) throw new Error(error.message);
      return { ok: true, status: "draft" };
    }

    const { error } = await supabaseAdmin
      .from("network_commission_statements")
      .update({
        status: "validated",
        validated_by: context.userId,
        validated_at: new Date().toISOString(),
        notes: data.notes ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.statementId);
    if (error) throw new Error(error.message);
    return { ok: true, status: "validated" };
  });
