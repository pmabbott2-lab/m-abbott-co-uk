/**
 * Network commission statements — monthly intake, AI parse, allocate to customers.
 * Server functions only; uses service role for writes.
 *
 * G7F-4S4C4-B1d — every entry point resolves the canonical acting tenant and
 * scopes all reads/writes to it. A statementId / lineId / sessionId / period
 * is never authority on its own: unknown, foreign and tenantless resources all
 * fail closed with the same "Not found.". New rows are stamped with the acting
 * tenant.
 *
 * G7F-4S4C4-B4b1 — one statement per tenant and month. Allocation, deallocation,
 * skip, dates, re-parse, validation and unlock run as single database operations
 * that re-check the actor in the acting tenant. The economic date of a network
 * fee is the line transaction date, else the staff-confirmed statement received
 * date; it is never inferred. Validation reconciles and freezes; it never posts.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { canAmend, canView, canViewCommissionPayouts, type AdminAccess } from "@/lib/admin-access";
import type { ResourceCapability } from "@/lib/tenant-assert.server";

const FEE_TYPES = ["fee", "mortgage_fee", "insurance_fee", "other_fee"] as const;

const STATEMENT_UNAVAILABLE_MESSAGE = "This month can't be opened right now. Please try again.";

const VALIDATION_BLOCKER_MESSAGES: Record<string, string> = {
  statement_not_open: "the statement is already validated",
  no_lines: "the statement has no lines",
  line_tenant_mismatch: "a line does not belong to this company",
  line_unresolved: "every line must be allocated or skipped",
  skip_reason_missing: "every skipped line needs a reason",
  declared_total_missing: "enter the statement's declared total",
  total_mismatch: "the line amounts do not add up to the declared total",
  allocation_inconsistent: "an allocated line does not match its draft fee",
  duplicate_allocation: "a line has more than one active fee",
  economic_date_missing: "an allocated fee has no economic date",
  received_date_unconfirmed: "the statement received date is not confirmed",
  economic_date_mismatch: "an allocated fee's date no longer matches its source",
  session_unavailable: "an allocated case is no longer available",
};

const NETWORK_ERROR_MESSAGES: Record<string, string> = {
  network_finance_forbidden: "Forbidden",
  network_statement_frozen: "This statement is validated. An Owner must unlock it before changes.",
  network_line_superseded: "This line was replaced by a newer parse. Reload the statement.",
  network_allocation_session_required: "Select a customer case/session to allocate this line.",
  network_line_already_allocated:
    "This line is already allocated to a different case. Deallocate it first.",
  network_line_skipped: "This line is skipped. Remove the skip before allocating.",
  network_line_amount_invalid: "Line has no amount to allocate.",
  network_allocation_date_required:
    "This line has no transaction date and the statement received date is not confirmed. Add one before allocating.",
  network_line_not_allocated: "This line is not allocated.",
  network_deallocation_reason_required: "Give a reason for deallocating this line.",
  network_deallocation_fee_not_draft: "This fee is no longer a draft and cannot be deallocated.",
  network_line_allocated_immutable: "Deallocate this line before changing it.",
  network_line_date_invalid: "Enter a valid transaction date that is not in the future.",
  network_skip_reason_required: "Give a reason for skipping this line.",
  network_line_skip_invalid: "This line can't be skipped or unskipped in its current state.",
  network_received_date_unconfirmed: "Confirm the received date before saving it.",
  network_received_date_invalid: "Enter a valid received date that is not in the future.",
  network_received_date_in_use:
    "Allocated lines use the received date. Deallocate them before changing it.",
  network_declared_total_invalid: "Enter a declared total of zero or more.",
  network_reparse_active_allocation:
    "Deallocate every allocated line before re-parsing this statement.",
  network_lines_invalid: "The parsed statement lines are not valid.",
  network_statement_not_validated: "This statement is not validated.",
  network_unlock_reason_required: "Give a reason for unlocking this statement.",
  network_unlock_posted_fee: "This statement has posted fees and cannot be unlocked.",
};

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

/** Database operation errors map to fixed messages; anything else stays generic. */
function networkError(
  error: { code?: string; message?: string } | null,
  notFoundMessage: string,
): Error {
  const raw = String(error?.message ?? "");
  if (raw === "network_resource_not_found") return new Error(notFoundMessage);
  if (raw.startsWith("network_validation_blocked")) {
    const codes = raw.split(":")[1]?.split(",").filter(Boolean) ?? [];
    const reasons = codes.map((c) => VALIDATION_BLOCKER_MESSAGES[c]).filter(Boolean);
    return new Error(
      reasons.length
        ? `This statement can't be validated yet: ${reasons.join("; ")}.`
        : "This statement can't be validated yet.",
    );
  }
  const known = NETWORK_ERROR_MESSAGES[raw];
  if (known) return new Error(known);
  return new Error("The network statement change could not be completed.");
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

function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** A real calendar date in YYYY-MM-DD that is not after today (London); otherwise null. */
function statedDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return null;
  return value <= londonToday() ? value : null;
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => statedDate(v) === v, "Enter a valid date that is not in the future.");

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
    const findOwn = async () => {
      const { data: existing, error } = await supabaseAdmin
        .from("network_commission_statements")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("period_month", period)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return existing;
    };
    const existing = await findOwn();
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
      // One statement per tenant and month: a concurrent open of the same month wins.
      if (isUniqueViolation(error)) {
        const raced = await findOwn();
        if (raced) return { statement: raced, created: false };
        throw new Error(STATEMENT_UNAVAILABLE_MESSAGE);
      }
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

    // Ownership proven above; current (not superseded) lines, constrained to the tenant.
    const { data: lines, error: lineErr } = await supabaseAdmin
      .from("network_commission_lines")
      .select("*")
      .eq("statement_id", data.statementId)
      .eq("tenant_id", tenantId)
      .is("superseded_at", null)
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
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { resolveActingTenantForList, RESOURCE_NOT_FOUND_MESSAGE } =
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
Return {"lines":[{"customerName":string|null,"customerEmail":string|null,"caseRef":string|null,"feeType":"fee"|"mortgage_fee"|"insurance_fee"|"other_fee","amountPounds":number,"transactionDate":string|null,"networkProduct":string|null,"notes":string|null}]}
Rules:
- amountPounds is the commission/fee amount received from the network (positive number, pounds).
- transactionDate is the date printed on that line for the transaction/payment, as YYYY-MM-DD. Use null when the line shows no date. Never use the statement month, a header date or today's date in its place.
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
        transactionDate?: string | null;
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

    // Parser dates are provisional until the statement is validated; an unusable date is dropped,
    // never replaced.
    const rows = aiLines
      .map((line) => {
        const amountPounds = Number(line.amountPounds ?? 0);
        if (!Number.isFinite(amountPounds) || amountPounds <= 0) return null;
        const feeType = FEE_TYPES.includes(line.feeType as (typeof FEE_TYPES)[number])
          ? (line.feeType as (typeof FEE_TYPES)[number])
          : "fee";
        return {
          customer_name: line.customerName?.trim() || null,
          customer_email: line.customerEmail?.trim()?.toLowerCase() || null,
          case_ref: line.caseRef?.trim() || null,
          fee_type: feeType,
          amount_received_pence: Math.round(amountPounds * 100),
          network_product: line.networkProduct?.trim() || null,
          transaction_date: statedDate(line.transactionDate),
          raw_json: line,
          annotation: line.notes?.trim() || null,
        };
      })
      .filter(Boolean) as Array<Record<string, unknown>>;

    if (!rows.length) throw new Error("AI found lines but none had a usable amount.");

    const { error: replaceErr } = await supabaseAdmin.rpc("replace_network_statement_lines", {
      p_tenant_id: tenantId,
      p_actor_user_id: context.userId,
      p_statement_id: data.statementId,
      p_lines: rows,
      p_raw_source: data.rawText.slice(0, 200_000),
    });
    if (replaceErr) throw networkError(replaceErr, RESOURCE_NOT_FOUND_MESSAGE);

    // Best-effort auto-match — candidates are restricted to the acting tenant.
    // A global profile/case_ref match is never used as authority, and foreign
    // customer/session rows are never attached or exposed.
    const { data: inserted } = await supabaseAdmin
      .from("network_commission_lines")
      .select("id, customer_email, case_ref, customer_name")
      .eq("statement_id", data.statementId)
      .eq("tenant_id", tenantId)
      .is("superseded_at", null);

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
          .eq("tenant_id", tenantId)
          .is("superseded_at", null)
          .eq("allocation_status", "unmatched");
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
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { resolveActingTenantForList, RESOURCE_NOT_FOUND_MESSAGE } =
      await import("@/lib/tenant-assert.server");
    const { tenantId } = await resolveActingTenantForList(context.userId, networkAmendCapability());

    const { supabaseAdminUntyped: supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    let sessionId = data.sessionId ?? null;
    if (!sessionId && data.customerId) {
      const { data: latest } = await supabaseAdmin
        .from("interview_sessions")
        .select("id")
        .eq("customer_id", data.customerId)
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!latest) throw new Error(RESOURCE_NOT_FOUND_MESSAGE);
      sessionId = latest.id as string;
    }

    // Line, statement and session are proven in the acting tenant inside the operation; a
    // foreign or unknown id is "Not found.". A repeat for the same case returns the same fee.
    const { data: rows, error } = await supabaseAdmin.rpc("allocate_network_line", {
      p_tenant_id: tenantId,
      p_actor_user_id: context.userId,
      p_line_id: data.lineId,
      p_session_id: sessionId,
    });
    if (error) throw networkError(error, RESOURCE_NOT_FOUND_MESSAGE);
    const row = (
      rows as Array<{
        fee_line_id: string;
        created: boolean;
        fee_event_date: string;
        fee_event_source: string;
      }> | null
    )?.[0];
    if (!row) throw new Error(RESOURCE_NOT_FOUND_MESSAGE);
    return {
      ok: true,
      feeLineId: row.fee_line_id,
      created: row.created,
      feeEventDate: row.fee_event_date,
      feeEventSource: row.fee_event_source,
      draft: true,
    };
  });

export const deallocateNetworkLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ lineId: z.string().uuid(), reason: z.string().trim().min(1).max(500) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { resolveActingTenantForList, RESOURCE_NOT_FOUND_MESSAGE } =
      await import("@/lib/tenant-assert.server");
    const { tenantId } = await resolveActingTenantForList(context.userId, networkAmendCapability());

    const { supabaseAdminUntyped: supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    const { data: feeLineId, error } = await supabaseAdmin.rpc("deallocate_network_line", {
      p_tenant_id: tenantId,
      p_actor_user_id: context.userId,
      p_line_id: data.lineId,
      p_reason: data.reason,
    });
    if (error) throw networkError(error, RESOURCE_NOT_FOUND_MESSAGE);
    return { ok: true, voidedFeeLineId: feeLineId as string };
  });

export const setNetworkLineSkip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        lineId: z.string().uuid(),
        skip: z.boolean(),
        reason: z.string().trim().max(500).optional(),
      })
      .refine((v) => !v.skip || Boolean(v.reason), "Give a reason for skipping this line.")
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { resolveActingTenantForList, RESOURCE_NOT_FOUND_MESSAGE } =
      await import("@/lib/tenant-assert.server");
    const { tenantId } = await resolveActingTenantForList(context.userId, networkAmendCapability());

    const { supabaseAdminUntyped: supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    const { data: status, error } = await supabaseAdmin.rpc("set_network_line_skip", {
      p_tenant_id: tenantId,
      p_actor_user_id: context.userId,
      p_line_id: data.lineId,
      p_skip: data.skip,
      p_reason: data.reason ?? null,
    });
    if (error) throw networkError(error, RESOURCE_NOT_FOUND_MESSAGE);
    return { ok: true, status: status as string };
  });

export const setNetworkLineTransactionDate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ lineId: z.string().uuid(), transactionDate: isoDate.nullable() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { resolveActingTenantForList, RESOURCE_NOT_FOUND_MESSAGE } =
      await import("@/lib/tenant-assert.server");
    const { tenantId } = await resolveActingTenantForList(context.userId, networkAmendCapability());

    const { supabaseAdminUntyped: supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("set_network_line_transaction_date", {
      p_tenant_id: tenantId,
      p_actor_user_id: context.userId,
      p_line_id: data.lineId,
      p_transaction_date: data.transactionDate,
    });
    if (error) throw networkError(error, RESOURCE_NOT_FOUND_MESSAGE);
    return { ok: true };
  });

export const confirmNetworkStatementReceivedDate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        statementId: z.string().uuid(),
        receivedDate: isoDate,
        confirmed: z.literal(true),
        evidence: z.string().trim().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { resolveActingTenantForList, RESOURCE_NOT_FOUND_MESSAGE } =
      await import("@/lib/tenant-assert.server");
    const { tenantId } = await resolveActingTenantForList(context.userId, networkAmendCapability());

    const { supabaseAdminUntyped: supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("confirm_network_statement_received_date", {
      p_tenant_id: tenantId,
      p_actor_user_id: context.userId,
      p_statement_id: data.statementId,
      p_received_date: data.receivedDate,
      p_confirmed: data.confirmed,
      p_evidence: data.evidence || null,
    });
    if (error) throw networkError(error, RESOURCE_NOT_FOUND_MESSAGE);
    return { ok: true };
  });

export const setNetworkStatementDeclaredTotal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ statementId: z.string().uuid(), declaredTotalPence: z.number().int().min(0) })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { resolveActingTenantForList, RESOURCE_NOT_FOUND_MESSAGE } =
      await import("@/lib/tenant-assert.server");
    const { tenantId } = await resolveActingTenantForList(context.userId, networkAmendCapability());

    const { supabaseAdminUntyped: supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("set_network_statement_declared_total", {
      p_tenant_id: tenantId,
      p_actor_user_id: context.userId,
      p_statement_id: data.statementId,
      p_declared_total_pence: data.declaredTotalPence,
    });
    if (error) throw networkError(error, RESOURCE_NOT_FOUND_MESSAGE);
    return { ok: true };
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
    // Prove line ownership through its own tenant; its statement is owned by the same tenant.
    const { data: line } = await supabaseAdmin
      .from("network_commission_lines")
      .select("id, statement_id, tenant_id")
      .eq("id", data.lineId)
      .eq("tenant_id", tenantId)
      .is("superseded_at", null)
      .maybeSingle();
    if (!line) throw new Error(RESOURCE_NOT_FOUND_MESSAGE);

    // A validated statement refuses the change (frozen).
    const { error } = await supabaseAdmin
      .from("network_commission_lines")
      .update({ annotation: data.annotation, updated_at: new Date().toISOString() })
      .eq("id", data.lineId)
      .eq("tenant_id", tenantId);
    if (error) throw networkError(error, RESOURCE_NOT_FOUND_MESSAGE);

    const { error: stmtErr } = await supabaseAdmin
      .from("network_commission_statements")
      .update({ status: "annotated", updated_at: new Date().toISOString() })
      .eq("id", line.statement_id)
      .eq("tenant_id", tenantId)
      .eq("status", "draft");
    if (stmtErr) throw networkError(stmtErr, RESOURCE_NOT_FOUND_MESSAGE);
    return { ok: true };
  });

export const validateNetworkStatement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        statementId: z.string().uuid(),
        action: z.enum(["validate", "unlock"]),
        reason: z.string().trim().max(500).optional(),
      })
      .refine(
        (v) => v.action !== "unlock" || Boolean(v.reason),
        "Give a reason for unlocking this statement.",
      )
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

    if (data.action === "unlock") {
      if (!view.adminAccess.isOwner) {
        throw new Error("Only an Owner can unlock a validated statement.");
      }
      const { error } = await supabaseAdmin.rpc("unlock_network_statement", {
        p_tenant_id: tenantId,
        p_actor_user_id: context.userId,
        p_statement_id: data.statementId,
        p_reason: data.reason ?? null,
      });
      if (error) throw networkError(error, RESOURCE_NOT_FOUND_MESSAGE);
      return { ok: true, status: "draft" };
    }

    // Reconciles and freezes; nothing is posted.
    const { error } = await supabaseAdmin.rpc("validate_network_statement", {
      p_tenant_id: tenantId,
      p_actor_user_id: context.userId,
      p_statement_id: data.statementId,
    });
    if (error) throw networkError(error, RESOURCE_NOT_FOUND_MESSAGE);
    return { ok: true, status: "validated" };
  });
