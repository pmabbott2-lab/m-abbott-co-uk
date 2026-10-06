/**
 * Network commission statements — monthly intake, AI parse, allocate to customers.
 * Server functions only; uses service role for writes.
 *
 * G7F-4S4C4-B1d — every entry point resolves the canonical acting tenant and
 * scopes all reads/writes to it. A statementId / lineId / sessionId / period
 * is never authority on its own: unknown, foreign and tenantless resources all
 * fail closed with the same "Not found.". New rows are stamped with the acting
 * tenant. The global UNIQUE(period_month) remains a B4 structural blocker, so
 * same-month collisions across tenants fail closed with a generic message and
 * never expose the other tenant's statement.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { canAmend, canView, canViewCommissionPayouts, type AdminAccess } from "@/lib/admin-access";
import type { ResourceCapability } from "@/lib/tenant-assert.server";

const FEE_TYPES = ["fee", "mortgage_fee", "insurance_fee", "other_fee"] as const;

/**
 * Shown when a statement cannot be opened for the acting tenant because the
 * global UNIQUE(period_month) constraint is already occupied (by any tenant).
 * Deliberately generic: never reveals the foreign statement id, tenant, creator
 * or any financial data. Full per-tenant same-month support is B4.
 */
const PERIOD_MONTH_UNAVAILABLE_MESSAGE =
  "This month can't be opened here yet. Please contact support if this continues.";

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

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const msg = (error.message ?? "").toLowerCase();
  return code === "23505" || msg.includes("duplicate key") || msg.includes("unique constraint");
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
  return access.isOwner || access.isSupervisor || canAmend(access, "finance_network_statements");
}

function canValidateNetwork(access: AdminAccess): boolean {
  return access.isOwner || access.isSupervisor || canAmend(access, "finance_network_validate");
}

// Canonical acting-tenant/ResourceCapability wrappers. The capability outcomes
// mirror the pre-B1d role checks exactly; B1d only binds them to the acting
// tenant (and, for mutate, to a view that may mutate — platform read-only is
// rejected by resolveActingTenantForList before any resource is touched).
function networkViewCapability(): ResourceCapability {
  return { mutate: false, allocation: "none", allow: (v) => canViewNetwork(v.adminAccess) };
}

function networkAmendCapability(): ResourceCapability {
  return { mutate: true, allocation: "none", allow: (v) => canAmendNetwork(v.adminAccess) };
}

function networkValidateCapability(): ResourceCapability {
  return { mutate: true, allocation: "none", allow: (v) => canValidateNetwork(v.adminAccess) };
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
    const { resolveActingTenantForList } = await import("@/lib/tenant-assert.server");
    const { tenantId } = await resolveActingTenantForList(context.userId, networkViewCapability());

    const { supabaseAdminUntyped: supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("network_commission_statements")
      .select("id, period_month, status, notes, validated_at, created_at")
      .eq("tenant_id", tenantId)
      .order("period_month", { ascending: false });
    if (error) {
      if (isMissing(error)) return { months: [], migrationRequired: true as const };
      throw new Error(error.message);
    }

    // Offer current + previous 17 months even if no row yet.
    const options: {
      periodMonth: string;
      label: string;
      statementId: string | null;
      status: string | null;
    }[] = [];
    const rows = (data ?? []) as Array<{ id: string; period_month: string; status: string | null }>;
    const byPeriod = new Map(rows.map((r) => [String(r.period_month).slice(0, 10), r]));
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
    const { resolveActingTenantForList, withForcedTenantId } =
      await import("@/lib/tenant-assert.server");
    const { tenantId } = await resolveActingTenantForList(context.userId, networkAmendCapability());

    const period = monthStart(data.periodMonth);
    const { supabaseAdminUntyped: supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    // Same-tenant lookup only: never read another tenant's same-month statement.
    const { data: existing } = await supabaseAdmin
      .from("network_commission_statements")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("period_month", period)
      .maybeSingle();
    if (existing) return { statement: existing, created: false };

    const { data: inserted, error } = await supabaseAdmin
      .from("network_commission_statements")
      .insert(
        withForcedTenantId(
          {
            period_month: period,
            status: "draft",
            created_by: context.userId,
          },
          tenantId,
        ),
      )
      .select("*")
      .single();
    if (error) {
      if (isMissing(error))
        throw new Error("Run supabase/RUN_NETWORK_COMMISSION.sql in Supabase first.");
      // B4 blocker: global UNIQUE(period_month). Another tenant already holds
      // this month. Fail closed with a generic message — do not fetch, return,
      // reassign or reveal the other tenant's statement.
      if (isUniqueViolation(error)) throw new Error(PERIOD_MONTH_UNAVAILABLE_MESSAGE);
      throw new Error(error.message);
    }
    return { statement: inserted, created: true };
  });

export const getNetworkStatementDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ statementId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { resolveActingTenantForList, RESOURCE_NOT_FOUND_MESSAGE } =
      await import("@/lib/tenant-assert.server");
    const { tenantId } = await resolveActingTenantForList(context.userId, networkViewCapability());

    const { supabaseAdminUntyped: supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    const { data: statement, error } = await supabaseAdmin
      .from("network_commission_statements")
      .select("*")
      .eq("id", data.statementId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    // Unknown, foreign and tenantless statements are indistinguishable here.
    if (!statement) throw new Error(RESOURCE_NOT_FOUND_MESSAGE);

    // Ownership proven above; lines are additionally constrained to the tenant.
    const { data: lines, error: lineErr } = await supabaseAdmin
      .from("network_commission_lines")
      .select("*")
      .eq("statement_id", data.statementId)
      .eq("tenant_id", tenantId)
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
    const { resolveActingTenantForList, RESOURCE_NOT_FOUND_MESSAGE, withForcedTenantId } =
      await import("@/lib/tenant-assert.server");
    const { tenantId } = await resolveActingTenantForList(context.userId, networkAmendCapability());

    const { supabaseAdminUntyped: supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    // Prove the statement belongs to the acting tenant before any work.
    const { data: statement } = await supabaseAdmin
      .from("network_commission_statements")
      .select("id, status, tenant_id")
      .eq("id", data.statementId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!statement) throw new Error(RESOURCE_NOT_FOUND_MESSAGE);
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
      await supabaseAdmin
        .from("network_commission_lines")
        .delete()
        .eq("statement_id", data.statementId)
        .eq("tenant_id", tenantId);
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
      .filter(Boolean) as Array<Record<string, unknown>>;

    if (!rows.length) throw new Error("AI found lines but none had a usable amount.");

    // Every new line is stamped with the acting tenant.
    const { error: insErr } = await supabaseAdmin
      .from("network_commission_lines")
      .insert(rows.map((r) => withForcedTenantId(r, tenantId)));
    if (insErr) throw new Error(insErr.message);

    await supabaseAdmin
      .from("network_commission_statements")
      .update({
        raw_source: data.rawText.slice(0, 200_000),
        status: "draft",
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.statementId)
      .eq("tenant_id", tenantId);

    // Best-effort auto-match — candidates are restricted to the acting tenant.
    // A global profile/case_ref match is never used as authority, and foreign
    // customer/session rows are never attached or exposed.
    const { data: inserted } = await supabaseAdmin
      .from("network_commission_lines")
      .select("id, customer_email, case_ref, customer_name")
      .eq("statement_id", data.statementId)
      .eq("tenant_id", tenantId);

    for (const line of inserted ?? []) {
      let customerId: string | null = null;
      let sessionId: string | null = null;

      if (line.customer_email) {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("email", line.customer_email)
          .maybeSingle();
        const candidate = profile?.id ?? null;
        if (candidate) {
          // Only accept the candidate if they are related to the acting tenant
          // (a session in this tenant, else an active membership here).
          const { data: sess } = await supabaseAdmin
            .from("interview_sessions")
            .select("id")
            .eq("customer_id", candidate)
            .eq("tenant_id", tenantId)
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (sess) {
            customerId = candidate;
            sessionId = sess.id;
          } else {
            const { data: mem } = await supabaseAdmin
              .from("tenant_memberships")
              .select("id")
              .eq("user_id", candidate)
              .eq("tenant_id", tenantId)
              .eq("active", true)
              .limit(1)
              .maybeSingle();
            if (mem) customerId = candidate;
          }
        }
      }
      if (!customerId && line.case_ref) {
        const { data: session } = await supabaseAdmin
          .from("interview_sessions")
          .select("id, customer_id")
          .eq("case_ref", line.case_ref)
          .eq("tenant_id", tenantId)
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
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
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
          .eq("id", line.id)
          .eq("tenant_id", tenantId);
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
    const { resolveActingTenantForList, RESOURCE_NOT_FOUND_MESSAGE, withForcedTenantId } =
      await import("@/lib/tenant-assert.server");
    const { tenantId } = await resolveActingTenantForList(context.userId, networkAmendCapability());

    const { supabaseAdminUntyped: supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    // Prove the line belongs to the acting tenant, and that its statement does
    // too (line.tenant_id and statement.tenant_id must agree with acting).
    const { data: line } = await supabaseAdmin
      .from("network_commission_lines")
      .select("*, network_commission_statements!inner(id, status, tenant_id)")
      .eq("id", data.lineId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!line) throw new Error(RESOURCE_NOT_FOUND_MESSAGE);
    const stmt = (
      line as { network_commission_statements?: { status?: string; tenant_id?: string | null } }
    ).network_commission_statements;
    if (!stmt || stmt.tenant_id !== tenantId) throw new Error(RESOURCE_NOT_FOUND_MESSAGE);
    if (stmt.status === "locked") throw new Error("Statement is locked.");

    let sessionId = data.sessionId ?? (line.matched_session_id as string | null) ?? null;
    let customerId = data.customerId ?? (line.matched_customer_id as string | null) ?? null;

    if (!sessionId && customerId) {
      const { data: latest } = await supabaseAdmin
        .from("interview_sessions")
        .select("id")
        .eq("customer_id", customerId)
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      sessionId = latest?.id ?? null;
    }
    if (!sessionId) throw new Error("Select a customer case/session to allocate this line.");

    // The session must belong to the acting tenant. A supplied foreign/unknown
    // session id is indistinguishable: both are "Not found.".
    const { data: session } = await supabaseAdmin
      .from("interview_sessions")
      .select("id, customer_id, tenant_id")
      .eq("id", sessionId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!session) throw new Error(RESOURCE_NOT_FOUND_MESSAGE);
    customerId = session.customer_id;

    const feeType = FEE_TYPES.includes(line.fee_type as (typeof FEE_TYPES)[number])
      ? line.fee_type
      : "fee";
    const amountPence = Number(line.amount_received_pence ?? 0);
    if (amountPence <= 0) throw new Error("Line has no amount to allocate.");

    const { data: feeLine, error: feeErr } = await supabaseAdmin
      .from("finance_fee_lines")
      .insert(
        withForcedTenantId(
          {
            session_id: sessionId,
            fee_type: feeType,
            amount_pence: amountPence,
            note: `Network statement ${String(line.statement_id).slice(0, 8)} · ${line.case_ref ?? line.customer_name ?? "line"}`,
            status: "draft",
            created_by: context.userId,
          },
          tenantId,
        ),
      )
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
      .eq("id", data.lineId)
      .eq("tenant_id", tenantId);

    // Draft fee line on the customer case — submit from case finance to drive payable commissions.
    return { ok: true, feeLineId: feeLine.id, sessionId, customerId, draft: true };
  });

export const annotateNetworkLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ lineId: z.string().uuid(), annotation: z.string().max(2000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { resolveActingTenantForList, RESOURCE_NOT_FOUND_MESSAGE } =
      await import("@/lib/tenant-assert.server");
    const { tenantId } = await resolveActingTenantForList(context.userId, networkAmendCapability());

    const { supabaseAdminUntyped: supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    // Prove line ownership through its own tenant and its owned statement.
    const { data: line } = await supabaseAdmin
      .from("network_commission_lines")
      .select("id, statement_id, tenant_id, network_commission_statements!inner(id, tenant_id)")
      .eq("id", data.lineId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!line) throw new Error(RESOURCE_NOT_FOUND_MESSAGE);
    const stmt = (line as { network_commission_statements?: { tenant_id?: string | null } })
      .network_commission_statements;
    if (!stmt || stmt.tenant_id !== tenantId) throw new Error(RESOURCE_NOT_FOUND_MESSAGE);

    const { error } = await supabaseAdmin
      .from("network_commission_lines")
      .update({ annotation: data.annotation, updated_at: new Date().toISOString() })
      .eq("id", data.lineId)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);

    if (line.statement_id) {
      await supabaseAdmin
        .from("network_commission_statements")
        .update({ status: "annotated", updated_at: new Date().toISOString() })
        .eq("id", line.statement_id)
        .eq("tenant_id", tenantId)
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
    const { resolveActingTenantForList, RESOURCE_NOT_FOUND_MESSAGE } =
      await import("@/lib/tenant-assert.server");
    const { tenantId, view } = await resolveActingTenantForList(
      context.userId,
      networkValidateCapability(),
    );

    const { supabaseAdminUntyped: supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    // Prove the statement belongs to the acting tenant before any status change.
    const { data: statement } = await supabaseAdmin
      .from("network_commission_statements")
      .select("id, tenant_id")
      .eq("id", data.statementId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!statement) throw new Error(RESOURCE_NOT_FOUND_MESSAGE);

    if (data.action === "unlock") {
      if (!view.adminAccess.isOwner && !view.adminAccess.isSupervisor) {
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
        .eq("id", data.statementId)
        .eq("tenant_id", tenantId);
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
      .eq("id", data.statementId)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { ok: true, status: "validated" };
  });
