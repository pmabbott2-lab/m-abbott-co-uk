import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  canAmend,
  canView,
  canViewFinanceReport,
  canViewCommissionPayouts,
  canAmendCommissionPayouts,
  type AdminAccess,
} from "@/lib/admin-access";
import {
  TenantContextError,
  assertRowBelongsToTenant,
  requireTenantMembership,
  withForcedTenantId,
} from "@/lib/tenant-assert.server";
import {
  COMMISSION_FEE_TYPES,
  feeTypesForSubject,
  findTenantRateSubject,
  rateMutationErrorMessage,
  rateSubjectArgs,
  resolveCommissionRateAsOf,
  type CommissionFeeType,
  type CommissionRateSubject,
} from "@/lib/commission-rates.server";

const FEE_TYPES = COMMISSION_FEE_TYPES;

type UntypedAdmin =
  (typeof import("@/integrations/supabase/client.server"))["supabaseAdminUntyped"];

export const RAF_BONUS_NOT_CONFIGURED_MESSAGE =
  "The Refer a Friend bonus amount is not configured for this company.";

type FinanceActing = { tenantId: string; access: AdminAccess };

/**
 * Finance acts in one verified tenant (membership-verified route slug, else the sole membership)
 * as a member of that tenant. Platform entry carries no finance authority.
 */
async function actingFinanceTenant(userId: string): Promise<FinanceActing | null> {
  const { resolveActingTenantRole } = await import("@/lib/tenant-role.server");
  const view = await resolveActingTenantRole(userId);
  if (!view.tenantId || !view.member || view.accessContext !== "membership") return null;
  return { tenantId: view.tenantId, access: view.adminAccess };
}

async function resolveFinanceTenant(userId: string): Promise<FinanceActing> {
  const acting = await actingFinanceTenant(userId);
  if (!acting) {
    throw new TenantContextError("TENANT_DATA_ACCESS_DENIED", "Tenant access denied.");
  }
  return acting;
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
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

export const FEE_TYPE_LABELS: Record<(typeof FEE_TYPES)[number], string> = {
  fee: "Fee",
  mortgage_fee: "Mortgage fee",
  insurance_fee: "Insurance fee",
  other_fee: "Other fee",
};

export const PAYOUT_STATUSES = ["received", "paid", "rejected"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  received: "Received",
  paid: "Paid",
  rejected: "Rejected",
};

/** @deprecated Lost is no longer a payout status — kept only for reading legacy rows. */
export const LOST_COMMISSION_REASONS = [
  { value: "customer_not_proceeding", label: "Customer not proceeding" },
  { value: "application_declined", label: "Application declined / withdrawn" },
  { value: "remortgaged_elsewhere", label: "Customer remortgaged elsewhere" },
  { value: "duplicate_or_error", label: "Duplicate / error entry" },
] as const;

export type LostCommissionReason = (typeof LOST_COMMISSION_REASONS)[number]["value"];

function normalizePayoutStatus(raw: string | null | undefined): PayoutStatus {
  if (raw === "pending") return "received";
  if (raw === "lost") return "rejected";
  if (raw && PAYOUT_STATUSES.includes(raw as PayoutStatus)) return raw as PayoutStatus;
  return "received";
}

const PAYOUT_STATUS_Z = z.enum(["received", "paid", "rejected"]);

export const BENEFICIARY_ROLE_LABELS: Record<string, string> = {
  advisor: "Advisor",
  introducer: "Introducer",
  referrer: "Refer a friend",
};

export type CommissionPayoutRow = {
  id: string;
  sessionId: string | null;
  caseRef: string | null;
  feeType: string | null;
  amountPence: number;
  commissionPct: number | null;
  beneficiaryRole: string;
  beneficiaryUserId: string | null;
  beneficiaryName: string;
  referralId: string | null;
  referredFriendLabel: string | null;
  payoutStatus: PayoutStatus;
  payoutNote: string | null;
  payoutAt: string | null;
  lostReason: string | null;
  createdAt: string;
};

export const listSessionFees = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    if (!canView(access, "finance_customer")) throw new Error("Forbidden");
    const { requireTenantFeature } = await import("@/lib/tenant-features.server");
    await requireTenantFeature(tenantId, "staff_finance");

    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    await assertRowBelongsToTenant({
      table: "interview_sessions",
      id: data.sessionId,
      authorisedTenantId: tenantId,
      select: "id, tenant_id",
    });
    const { data: lines, error } = await supabaseAdmin
      .from("finance_fee_lines")
      .select("*")
      .eq("session_id", data.sessionId)
      .eq("tenant_id", tenantId)
      .neq("status", "deleted")
      .order("created_at", { ascending: true });
    if (error) {
      if (isMissingTable(error)) return { lines: [], migrationRequired: true };
      throw new Error(error.message);
    }
    return { lines: lines ?? [], migrationRequired: false };
  });

export const listSessionCommissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    if (!canView(access, "finance_customer")) throw new Error("Forbidden");

    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    await assertRowBelongsToTenant({
      table: "interview_sessions",
      id: data.sessionId,
      authorisedTenantId: tenantId,
      select: "id, tenant_id",
    });
    const { data: rows, error } = await supabaseAdmin
      .from("finance_ledger")
      .select(
        "id, session_id, fee_type, amount_pence, commission_pct, beneficiary_user_id, beneficiary_role, referral_id, payout_status, payout_note, payout_at, lost_reason, created_at, note",
      )
      .eq("kind", "commission")
      .eq("session_id", data.sessionId)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true });
    if (error) {
      if (isMissingTable(error)) return { rows: [] as CommissionPayoutRow[], migrationRequired: true };
      throw new Error(error.message);
    }
    const enriched = await enrichCommissionLedgerRows(
      supabaseAdmin,
      (rows ?? []) as RawCommissionLedgerRow[],
      tenantId,
    );
    return { rows: enriched, migrationRequired: false };
  });

export const upsertDraftFee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        feeType: z.enum(FEE_TYPES),
        amountPounds: z.number().min(0),
        note: z.string().max(500).optional(),
        lineId: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    if (!canAmend(access, "finance_customer")) throw new Error("Forbidden");
    await assertRowBelongsToTenant({
      table: "interview_sessions",
      id: data.sessionId,
      authorisedTenantId: tenantId,
      select: "id, tenant_id",
    });

    // Case fees must come from Finance → Network statements → Allocate.
    // Manual draft create/edit is closed so commission only pull through from the network.
    throw new Error(
      "Manual fee entry is disabled. Allocate the fee from Finance → Network statements; it appears here as a draft to submit.",
    );
  });

export const submitSessionFees = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; count: number }> => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    if (!canAmend(access, "finance_customer")) throw new Error("Forbidden");
    await assertRowBelongsToTenant({
      table: "interview_sessions",
      id: data.sessionId,
      authorisedTenantId: tenantId,
      select: "id, tenant_id",
    });

    // A fee may only post with its economic date from a validated network statement, and the
    // database refuses every draft→posted transition until that posting path exists.
    throw new Error(
      "Posting fees is not available yet. Draft fees stay on the case until economic-date posting is enabled.",
    );
  });

export const amendPostedFee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        lineId: z.string().uuid(),
        amountPounds: z.number().min(0).optional(),
        note: z.string().max(500).optional(),
        delete: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    if (!canAmend(access, "finance_customer")) throw new Error("Forbidden");
    await assertRowBelongsToTenant({
      table: "finance_fee_lines",
      id: data.lineId,
      authorisedTenantId: tenantId,
      select: "id, tenant_id",
    });

    // Posted fees are immutable; corrections must be linked reversal events, not edits.
    throw new Error(
      "Amending or deleting posted fees is not available yet. Posted fees are unchanged.",
    );
  });

export type EnrichedLedgerRow = {
  id: string;
  created_at: string;
  kind: string;
  fee_type?: string | null;
  amount_pence: number;
  note?: string | null;
  beneficiary_role?: string | null;
  commission_pct?: number | null;
  is_reversal?: boolean | null;
  session_id?: string | null;
  customerName?: string | null;
  caseRef?: string | null;
  receiverName?: string | null;
  receiverRef?: string | null;
};

async function enrichFinanceLedgerRows(
  supabaseAdmin: Awaited<
    ReturnType<typeof import("@/integrations/supabase/client.server")>
  >["supabaseAdmin"],
  rows: Array<Record<string, unknown>>,
  tenantId: string,
): Promise<EnrichedLedgerRow[]> {
  const sessionIds = new Set<string>();
  const userIds = new Set<string>();
  for (const r of rows) {
    if (r.session_id) sessionIds.add(r.session_id as string);
    if (r.beneficiary_user_id) userIds.add(r.beneficiary_user_id as string);
  }

  const sessionMap = new Map<string, { caseRef: string | null; customerId: string | null }>();
  if (sessionIds.size > 0) {
    const { data: sessions } = await supabaseAdmin
      .from("interview_sessions")
      .select("id, case_ref, customer_id")
      .in("id", [...sessionIds])
      .eq("tenant_id", tenantId);
    for (const s of sessions ?? []) {
      sessionMap.set(s.id, { caseRef: s.case_ref ?? null, customerId: s.customer_id ?? null });
    }
  }

  const customerIds = new Set(
    [...sessionMap.values()].map((v) => v.customerId).filter(Boolean) as string[],
  );
  const customerNameMap = new Map<string, string>();
  if (customerIds.size > 0) {
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", [...customerIds]);
    for (const p of profiles ?? []) {
      customerNameMap.set(p.id, p.full_name || p.email || "Customer");
    }
  }

  const profileMap = new Map<string, string>();
  const advisorCodeMap = new Map<string, string>();
  const introCodeMap = new Map<string, string>();
  if (userIds.size > 0) {
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", [...userIds]);
    for (const p of profiles ?? []) profileMap.set(p.id, p.full_name || p.email || "Unknown");
    // Reference codes come only from this tenant's rows; a beneficiary with no row here shows none.
    const { data: adv } = await supabaseAdmin
      .from("advisor_profiles")
      .select("user_id, code")
      .in("user_id", [...userIds])
      .eq("tenant_id", tenantId);
    for (const a of adv ?? []) advisorCodeMap.set(a.user_id, a.code);
    const { data: intros } = await supabaseAdmin
      .from("introducers")
      .select("user_id, company_code")
      .in("user_id", [...userIds])
      .eq("tenant_id", tenantId);
    for (const i of intros ?? []) introCodeMap.set(i.user_id, (i as { company_code?: string }).company_code ?? "");
  }

  return rows.map((r) => {
    const sessionId = r.session_id as string | null;
    const sess = sessionId ? sessionMap.get(sessionId) : undefined;
    const customerName = sess?.customerId ? customerNameMap.get(sess.customerId) ?? null : null;
    const beneficiaryId = r.beneficiary_user_id as string | null;
    const role = r.beneficiary_role as string | null;
    let receiverRef: string | null = null;
    if (beneficiaryId && role === "advisor") receiverRef = advisorCodeMap.get(beneficiaryId) ?? null;
    if (beneficiaryId && role === "introducer") receiverRef = introCodeMap.get(beneficiaryId) ?? null;

    return {
      id: r.id as string,
      created_at: r.created_at as string,
      kind: r.kind as string,
      fee_type: r.fee_type as string | null,
      amount_pence: r.amount_pence as number,
      note: r.note as string | null,
      beneficiary_role: role,
      commission_pct: r.commission_pct as number | null,
      is_reversal: r.is_reversal as boolean | null,
      session_id: sessionId,
      customerName,
      caseRef: sess?.caseRef ?? null,
      receiverName: beneficiaryId ? profileMap.get(beneficiaryId) ?? null : null,
      receiverRef,
    };
  });
}

export const listFinanceLedger = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    if (!canViewFinanceReport(access)) throw new Error("Forbidden — owner only");

    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: rows, error } = await supabaseAdmin
      .from("finance_ledger")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      if (isMissingTable(error)) return { rows: [], migrationRequired: true };
      throw new Error(error.message);
    }
    const enriched = await enrichFinanceLedgerRows(supabaseAdmin, rows ?? [], tenantId);
    return { rows: enriched, migrationRequired: false };
  });

export const listCommissionStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        role: z.enum(["advisor", "introducer", "admin"]),
        query: z.string().max(80).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    // Admin picker only needs introducer % permission (admins earn intro commission on bookings).
    const key =
      data.role === "advisor"
        ? "finance_advisor_pct"
        : "finance_introducer_pct";
    if (!canView(access, key)) throw new Error("Forbidden");

    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: roleRows } = await supabaseAdmin
      .from("tenant_memberships")
      .select("user_id, role")
      .eq("tenant_id", tenantId)
      .eq("active", true);
    const byUser = new Map<string, Set<string>>();
    for (const r of roleRows ?? []) {
      const set = byUser.get(r.user_id) ?? new Set<string>();
      set.add(r.role);
      byUser.set(r.user_id, set);
    }

    const ids = new Set<string>();
    if (data.role === "advisor") {
      // Pure advisors (+ anyone with advisor role). Do not pull admins-only into this list.
      for (const [userId, roles] of byUser) {
        if (roles.has("adviser")) ids.add(userId);
      }
    } else if (data.role === "admin") {
      for (const [userId, roles] of byUser) {
        if (roles.has("owner") || roles.has("supervisor") || roles.has("general")) {
          ids.add(userId);
        }
      }
    } else {
      for (const [userId, roles] of byUser) {
        if (roles.has("introducer")) ids.add(userId);
      }
    }
    if (ids.size === 0) return [];

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", [...ids])
      .order("full_name", { ascending: true });

    const advisorCodeMap = new Map<string, string>();
    if (data.role === "advisor" || data.role === "admin") {
      const { data: codes } = await supabaseAdmin
        .from("advisor_profiles")
        .select("user_id, code")
        .eq("tenant_id", tenantId);
      for (const c of codes ?? []) advisorCodeMap.set(c.user_id, c.code);
    }

    const introCodeMap = new Map<string, string>();
    if (data.role === "introducer" || data.role === "admin") {
      const res = await supabaseAdmin
        .from("introducers")
        .select("user_id, company_code")
        .eq("tenant_id", tenantId);
      for (const r of res.data ?? []) {
        introCodeMap.set(r.user_id, (r as { company_code?: string }).company_code ?? "");
      }
    }

    const q = (data.query ?? "").trim().toLowerCase();
    return (profiles ?? [])
      .filter((p) => ids.has(p.id))
      .filter((p) => {
        if (!q) return true;
        const code =
          data.role === "introducer"
            ? introCodeMap.get(p.id) ?? ""
            : advisorCodeMap.get(p.id) ?? introCodeMap.get(p.id) ?? "";
        const hay = [p.full_name, p.email, code].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      })
      .map((p) => ({
        id: p.id,
        full_name: p.full_name,
        email: p.email,
        referenceCode:
          data.role === "introducer"
            ? introCodeMap.get(p.id) || null
            : advisorCodeMap.get(p.id) ?? introCodeMap.get(p.id) ?? null,
      }));
  });

type RateVersionRow = {
  id: string;
  subject_kind: "introducer" | "adviser";
  introducer_id: string | null;
  adviser_user_id: string | null;
  fee_type: CommissionFeeType;
  percentage: number | string;
  effective_from: string;
  created_at: string;
  created_by: string | null;
  reason: string | null;
  source: string;
};

const RATE_VERSION_COLUMNS =
  "id, subject_kind, introducer_id, adviser_user_id, fee_type, percentage, effective_from, created_at, created_by, reason, source";

function rateSubjectKey(
  row: Pick<RateVersionRow, "subject_kind" | "introducer_id" | "adviser_user_id">,
) {
  return row.subject_kind === "introducer"
    ? `introducer:${row.introducer_id}`
    : `adviser:${row.adviser_user_id}`;
}

/** Version rows for one tenant, ordered by effective date (oldest first). */
async function loadTenantRateVersions(
  supabaseAdmin: UntypedAdmin,
  tenantId: string,
  filter: {
    subject?: CommissionRateSubject;
    subjectKind?: "introducer" | "adviser";
    feeType?: string;
  },
): Promise<RateVersionRow[]> {
  let query = supabaseAdmin
    .from("commission_rate_versions")
    .select(RATE_VERSION_COLUMNS)
    .eq("tenant_id", tenantId);
  if (filter.subject) {
    const args = rateSubjectArgs(filter.subject);
    query = query.eq("subject_kind", args.p_subject_kind);
    query =
      filter.subject.kind === "introducer"
        ? query.eq("introducer_id", filter.subject.introducerId)
        : query.eq("adviser_user_id", filter.subject.adviserUserId);
  } else if (filter.subjectKind) {
    query = query.eq("subject_kind", filter.subjectKind);
  }
  if (filter.feeType) query = query.eq("fee_type", filter.feeType);
  const { data, error } = await query
    .order("effective_from", { ascending: true })
    .order("id", { ascending: true })
    .limit(5000);
  if (error) throw new Error(error.message);
  return (data ?? []) as RateVersionRow[];
}

/** Introducer registration id → Auth user for this tenant only. */
async function tenantIntroducerUsers(
  supabaseAdmin: UntypedAdmin,
  tenantId: string,
  introducerIds: string[],
): Promise<Map<string, { userId: string; companyName: string | null }>> {
  const map = new Map<string, { userId: string; companyName: string | null }>();
  if (introducerIds.length === 0) return map;
  const { data, error } = await supabaseAdmin
    .from("introducers")
    .select("id, user_id, company_name")
    .eq("tenant_id", tenantId)
    .in("id", introducerIds);
  if (error) throw new Error(error.message);
  for (const r of data ?? []) {
    if (r.user_id) {
      map.set(r.id as string, {
        userId: r.user_id as string,
        companyName: (r.company_name as string | null) ?? null,
      });
    }
  }
  return map;
}

export type CommissionRateHistoryRow = {
  id: string;
  fee_type: CommissionFeeType;
  pct_from: number | null;
  pct_to: number;
  effective_from: string;
  created_at: string;
  changed_by: string | null;
  user_id: string | null;
  role: "advisor" | "introducer";
  user_name: string;
  reason: string | null;
  source: string;
};

export const listCommissionRateHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        userId: z.string().uuid().optional(),
        role: z.enum(["advisor", "introducer"]).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        feeType: z.enum(FEE_TYPES).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<CommissionRateHistoryRow[]> => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    if (!data.userId) {
      if (!canViewFinanceReport(access)) throw new Error("Forbidden");
    } else {
      const key = data.role === "introducer" ? "finance_introducer_pct" : "finance_advisor_pct";
      if (!canView(access, key)) throw new Error("Forbidden");
    }

    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    let subject: CommissionRateSubject | undefined;
    if (data.userId) {
      const found = await findTenantRateSubject(
        supabaseAdmin,
        tenantId,
        data.role ?? "advisor",
        data.userId,
      );
      if (!found) return [];
      subject = found.subject;
    }
    const versions = await loadTenantRateVersions(supabaseAdmin, tenantId, {
      subject,
      subjectKind: data.role ? (data.role === "advisor" ? "adviser" : "introducer") : undefined,
      feeType: data.feeType,
    });

    const previous = new Map<string, number>();
    const withPrevious = versions.map((v) => {
      const key = `${rateSubjectKey(v)}:${v.fee_type}`;
      const pctFrom = previous.has(key) ? previous.get(key)! : null;
      previous.set(key, Number(v.percentage));
      return { v, pctFrom };
    });

    const fromMs = data.from ? Date.parse(data.from) : null;
    const toMs = data.to ? Date.parse(data.to) : null;
    const listed = withPrevious
      .filter(({ v }) => {
        const at = Date.parse(v.created_at);
        if (fromMs != null && !Number.isNaN(fromMs) && at < fromMs) return false;
        if (toMs != null && !Number.isNaN(toMs) && at > toMs) return false;
        return true;
      })
      .sort((a, b) =>
        a.v.created_at === b.v.created_at
          ? b.v.effective_from.localeCompare(a.v.effective_from)
          : b.v.created_at.localeCompare(a.v.created_at),
      )
      .slice(0, 100);

    const introducerUsers = await tenantIntroducerUsers(supabaseAdmin, tenantId, [
      ...new Set(listed.map(({ v }) => v.introducer_id).filter(Boolean)),
    ] as string[]);
    const userIdFor = (v: RateVersionRow) =>
      v.subject_kind === "adviser"
        ? v.adviser_user_id
        : (introducerUsers.get(v.introducer_id as string)?.userId ?? null);
    const userIds = [...new Set(listed.map(({ v }) => userIdFor(v)).filter(Boolean))] as string[];
    const nameById = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);
      for (const p of profiles ?? []) nameById.set(p.id, p.full_name || p.email || "Unknown");
    }

    return listed.map(({ v, pctFrom }) => {
      const userId = userIdFor(v);
      return {
        id: v.id,
        fee_type: v.fee_type,
        pct_from: pctFrom,
        pct_to: Number(v.percentage),
        effective_from: v.effective_from,
        created_at: v.created_at,
        changed_by: v.created_by,
        user_id: userId,
        role: v.subject_kind === "adviser" ? "advisor" : "introducer",
        user_name: (userId ? nameById.get(userId) : null) ?? "Unknown",
        reason: v.reason,
        source: v.source,
      };
    });
  });

export type CurrentRateValue = { pct: number; effectiveFrom: string; versionId: string } | null;

export const getCommissionRate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ userId: z.string().uuid(), role: z.enum(["advisor", "introducer"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    const key = data.role === "advisor" ? "finance_advisor_pct" : "finance_introducer_pct";
    if (!canView(access, key)) throw new Error("Forbidden");

    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const found = await findTenantRateSubject(supabaseAdmin, tenantId, data.role, data.userId);
    const current: Record<CommissionFeeType, CurrentRateValue> = {
      fee: null,
      mortgage_fee: null,
      insurance_fee: null,
      other_fee: null,
    };
    if (found) {
      const now = new Date();
      for (const feeType of feeTypesForSubject(found.subject)) {
        const version = await resolveCommissionRateAsOf(supabaseAdmin, {
          tenantId,
          subject: found.subject,
          feeType,
          eventAt: now,
        });
        current[feeType] = version
          ? {
              pct: version.percentage,
              effectiveFrom: version.effectiveFrom,
              versionId: version.versionId,
            }
          : null;
      }
    }
    return {
      subjectAvailable: Boolean(found),
      subjectUsable: Boolean(found?.usable),
      allowedFeeTypes: found ? [...feeTypesForSubject(found.subject)] : [],
      current,
      pctFee: current.fee?.pct ?? null,
      pctMortgageFee: current.mortgage_fee?.pct ?? null,
      pctInsuranceFee: current.insurance_fee?.pct ?? null,
      pctOtherFee: current.other_fee?.pct ?? null,
    };
  });

export const getRafBonusAmount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    if (!canView(access, "finance_raf")) throw new Error("Forbidden");

    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const amountPence = await getRafBonusPence(supabaseAdmin, tenantId);
    return { amountPence, configured: amountPence != null };
  });

const RATE_PCT_Z = z
  .number()
  .min(0)
  .max(100)
  .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, "At most three decimal places.");

export const setCommissionRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        role: z.enum(["advisor", "introducer"]),
        rates: z
          .object({
            fee: RATE_PCT_Z.optional(),
            mortgage_fee: RATE_PCT_Z.optional(),
            insurance_fee: RATE_PCT_Z.optional(),
            other_fee: RATE_PCT_Z.optional(),
          })
          .strict(),
        effective: z.discriminatedUnion("mode", [
          z.object({ mode: z.literal("now") }),
          z.object({
            mode: z.literal("date"),
            effectiveFrom: z.string().datetime({ offset: true }),
            confirmBackdate: z.boolean().optional(),
          }),
        ]),
        reason: z.string().trim().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    // Rates are commercial terms: the tenant Owner alone sets them (Supervisor, General Admin,
    // admin_access and platform roles view at most).
    if (!access.isOwner) throw new Error("Forbidden");

    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const found = await findTenantRateSubject(supabaseAdmin, tenantId, data.role, data.userId);
    if (!found || !found.usable) throw new Error("Not found.");

    const rates = Object.fromEntries(
      Object.entries(data.rates).filter(([, v]) => v !== undefined),
    ) as Partial<Record<CommissionFeeType, number>>;
    if (Object.keys(rates).length === 0) throw new Error("Enter at least one rate to change.");

    const { data: rows, error } = await supabaseAdmin.rpc("set_commission_rate_versions", {
      p_tenant_id: tenantId,
      p_actor_user_id: context.userId,
      ...rateSubjectArgs(found.subject),
      p_rates: rates,
      p_effective_now: data.effective.mode === "now",
      p_effective_from: data.effective.mode === "date" ? data.effective.effectiveFrom : null,
      p_backdate_confirmed:
        data.effective.mode === "date" ? Boolean(data.effective.confirmBackdate) : false,
      p_reason: data.reason ? data.reason : null,
    });
    if (error) throw new Error(rateMutationErrorMessage(String(error.message ?? "")));
    const created = (rows ?? []) as Array<{
      version_id: string;
      fee_type: CommissionFeeType;
      percentage: number | string;
      effective_from: string;
    }>;
    return {
      ok: true,
      versions: created.map((r) => ({
        versionId: r.version_id,
        feeType: r.fee_type,
        pct: Number(r.percentage),
        effectiveFrom: r.effective_from,
      })),
    };
  });

/** Commission totals for RAF referrers (admin finance_raf permission). */
export const listRafCommissionHighlights = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const acting = await actingFinanceTenant(context.userId);
    if (!acting || !canView(acting.access, "finance_raf")) {
      return { byUserId: {} as Record<string, number> };
    }
    const { tenantId } = acting;

    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: rows, error } = await supabaseAdmin
      .from("finance_ledger")
      .select("beneficiary_user_id, amount_pence")
      .eq("kind", "commission")
      .eq("beneficiary_role", "introducer")
      .eq("tenant_id", tenantId);
    if (error) {
      if (isMissingTable(error)) return { byUserId: {} };
      throw new Error(error.message);
    }
    const byUserId: Record<string, number> = {};
    for (const r of rows ?? []) {
      if (!r.beneficiary_user_id) continue;
      byUserId[r.beneficiary_user_id] = (byUserId[r.beneficiary_user_id] ?? 0) + r.amount_pence;
    }
    return { byUserId };
  });

/** The tenant's configured RAF bonus in pence, or null when this tenant has not configured one. */
export async function getRafBonusPence(
  supabaseAdmin: UntypedAdmin,
  tenantId: string,
): Promise<number | null> {
  const { data, error } = await supabaseAdmin
    .from("finance_settings")
    .select("num_value")
    .eq("key", "raf_bonus_pence")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const value = data?.num_value;
  return typeof value === "number" ? value : null;
}

/**
 * Creates a received RAF commission ledger row when an Owner/authorised admin marks a referral
 * bonus eligible. Only that explicit action calls this; read paths never do.
 */
export async function ensureRafCommissionLedgerEntry(
  referralId: string,
  createdBy?: string,
): Promise<void> {
  const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

  const { data: referral, error: refErr } = await supabaseAdmin
    .from("referrals")
    .select("id, referrer_user_id, code, referred_email, referral_code_id, tenant_id")
    .eq("id", referralId)
    .maybeSingle();
  if (refErr || !referral?.tenant_id) return;
  const tenantId = referral.tenant_id as string;

  const { data: existing, error: existingErr } = await supabaseAdmin
    .from("finance_ledger")
    .select("id")
    .eq("referral_id", referralId)
    .eq("kind", "commission")
    .eq("tenant_id", tenantId)
    .limit(1);
  if (existingErr) throw new Error(existingErr.message);
  if ((existing ?? []).length > 0) return;

  let referrerName: string | null = null;
  if (referral.referral_code_id) {
    const { data: codeRow } = await supabaseAdmin
      .from("referral_codes")
      .select("referrer_name, referrer_user_id")
      .eq("id", referral.referral_code_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    referrerName = codeRow?.referrer_name ?? null;
  }

  const amountPence = await getRafBonusPence(supabaseAdmin, tenantId);
  if (amountPence == null) throw new Error(RAF_BONUS_NOT_CONFIGURED_MESSAGE);
  const note = `RAF bonus · friend ${referral.referred_email ?? "unknown"} · code ${referral.code ?? ""}`;

  const { error } = await supabaseAdmin.from("finance_ledger").insert(withForcedTenantId({
    kind: "commission",
    fee_type: "fee",
    amount_pence: amountPence,
    is_reversal: false,
    beneficiary_user_id: referral.referrer_user_id,
    beneficiary_role: "referrer",
    referral_id: referralId,
    payout_status: "received",
    note: referrerName ? `${note} · referrer ${referrerName}` : note,
    created_by: createdBy ?? null,
  }, tenantId));
  if (error) throw new Error(error.message);
}

type RawCommissionLedgerRow = {
  id: string;
  session_id: string | null;
  fee_type: string | null;
  amount_pence: number;
  commission_pct: number | null;
  beneficiary_user_id: string | null;
  beneficiary_role: string | null;
  referral_id: string | null;
  payout_status: string | null;
  payout_note: string | null;
  payout_at: string | null;
  lost_reason: string | null;
  created_at: string;
  note?: string | null;
};

async function enrichCommissionLedgerRows(
  supabaseAdmin: Awaited<
    ReturnType<typeof import("@/integrations/supabase/client.server")>
  >["supabaseAdmin"],
  rows: RawCommissionLedgerRow[],
  tenantId: string,
): Promise<CommissionPayoutRow[]> {
  const userIds = new Set<string>();
  const sessionIds = new Set<string>();
  const referralIds = new Set<string>();
  for (const r of rows) {
    if (r.beneficiary_user_id) userIds.add(r.beneficiary_user_id);
    if (r.session_id) sessionIds.add(r.session_id);
    if (r.referral_id) referralIds.add(r.referral_id);
  }

  const profileMap = new Map<string, string>();
  if (userIds.size > 0) {
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", Array.from(userIds));
    for (const p of profiles ?? []) {
      profileMap.set(p.id, p.full_name || p.email || "Unknown");
    }
  }

  const caseRefMap = new Map<string, string>();
  if (sessionIds.size > 0) {
    const { data: sessions } = await supabaseAdmin
      .from("interview_sessions")
      .select("id, case_ref")
      .in("id", Array.from(sessionIds))
      .eq("tenant_id", tenantId);
    for (const s of sessions ?? []) {
      if (s.case_ref) caseRefMap.set(s.id, s.case_ref);
    }
  }

  const referralMap = new Map<string, string>();
  if (referralIds.size > 0) {
    const { data: refs } = await supabaseAdmin
      .from("referrals")
      .select("id, referred_email")
      .in("id", Array.from(referralIds))
      .eq("tenant_id", tenantId);
    for (const ref of refs ?? []) {
      referralMap.set(ref.id, ref.referred_email ?? "Friend");
    }
  }

  return rows.map((r) => {
    const role = r.beneficiary_role ?? "advisor";
    let beneficiaryName =
      (r.beneficiary_user_id && profileMap.get(r.beneficiary_user_id)) || "";
    if (!beneficiaryName && role === "referrer" && r.note) {
      const match = String(r.note).match(/referrer ([^·]+)/i);
      beneficiaryName = match?.[1]?.trim() ?? "RAF referrer";
    }
    if (!beneficiaryName) beneficiaryName = BENEFICIARY_ROLE_LABELS[role] ?? role;

    return {
      id: r.id,
      sessionId: r.session_id,
      caseRef: r.session_id ? caseRefMap.get(r.session_id) ?? null : null,
      feeType: r.fee_type,
      amountPence: r.amount_pence,
      commissionPct: r.commission_pct != null ? Number(r.commission_pct) : null,
      beneficiaryRole: role,
      beneficiaryUserId: r.beneficiary_user_id,
      beneficiaryName,
      referralId: r.referral_id,
      referredFriendLabel: r.referral_id ? referralMap.get(r.referral_id) ?? null : null,
      payoutStatus: normalizePayoutStatus(r.payout_status),
      payoutNote: r.payout_note ?? null,
      payoutAt: r.payout_at ?? null,
      lostReason: r.lost_reason ?? null,
      createdAt: r.created_at,
    };
  });
}

/** Read-only commission statement for the signed-in user (advisor, introducer, or RAF referrer). */
export const listMyCommissionStatement = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        payoutStatus: PAYOUT_STATUS_Z.optional(),
        viewAsUserId: z.string().uuid().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { tenantId, access } = await resolveFinanceTenant(context.userId);

    let beneficiaryUserId = context.userId;
    if (data.viewAsUserId) {
      if (!access.isOwner && !access.isSupervisor) throw new Error("Forbidden");
      await requireTenantMembership(data.viewAsUserId, tenantId);
      beneficiaryUserId = data.viewAsUserId;
    }

    let query = supabaseAdmin
      .from("finance_ledger")
      .select(
        "id, session_id, fee_type, amount_pence, commission_pct, beneficiary_user_id, beneficiary_role, referral_id, payout_status, payout_note, payout_at, lost_reason, created_at, note",
      )
      .eq("kind", "commission")
      .eq("beneficiary_user_id", beneficiaryUserId)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(2000);

    if (data.payoutStatus) query = query.eq("payout_status", data.payoutStatus);

    const { data: rows, error } = await query;
    if (error) {
      if (isMissingTable(error)) return { rows: [] as CommissionPayoutRow[], migrationRequired: true };
      throw new Error(error.message);
    }

    const enriched = await enrichCommissionLedgerRows(
      supabaseAdmin,
      (rows ?? []) as RawCommissionLedgerRow[],
      tenantId,
    );
    return { rows: enriched, migrationRequired: false };
  });

export const listCommissionPayouts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        beneficiaryRole: z.enum(["advisor", "introducer", "referrer"]).optional(),
        payoutStatus: PAYOUT_STATUS_Z.optional(),
        beneficiaryUserId: z.string().uuid().optional(),
        caseRefQuery: z.string().max(64).optional(),
        sessionId: z.string().uuid().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    if (!canViewCommissionPayouts(access)) throw new Error("Forbidden");

    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    let sessionFilterIds: string[] | null = null;
    if (data.sessionId) {
      await assertRowBelongsToTenant({
        table: "interview_sessions",
        id: data.sessionId,
        authorisedTenantId: tenantId,
        select: "id, tenant_id",
      });
      sessionFilterIds = [data.sessionId];
    } else if (data.caseRefQuery?.trim()) {
      const q = data.caseRefQuery.trim();
      const { data: sessions, error: sessErr } = await supabaseAdmin
        .from("interview_sessions")
        .select("id")
        .ilike("case_ref", `%${q}%`)
        .eq("tenant_id", tenantId)
        .limit(100);
      if (sessErr) throw new Error(sessErr.message);
      sessionFilterIds = (sessions ?? []).map((s) => s.id);
      if (sessionFilterIds.length === 0) {
        return { rows: [] as CommissionPayoutRow[], migrationRequired: false };
      }
    }

    let query = supabaseAdmin
      .from("finance_ledger")
      .select(
        "id, session_id, fee_type, amount_pence, commission_pct, beneficiary_user_id, beneficiary_role, referral_id, payout_status, payout_note, payout_at, lost_reason, created_at, note",
      )
      .eq("kind", "commission")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(sessionFilterIds ? 200 : 500);

    if (sessionFilterIds) query = query.in("session_id", sessionFilterIds);
    if (data.beneficiaryRole) query = query.eq("beneficiary_role", data.beneficiaryRole);
    if (data.payoutStatus && !sessionFilterIds) query = query.eq("payout_status", data.payoutStatus);
    if (data.beneficiaryUserId) query = query.eq("beneficiary_user_id", data.beneficiaryUserId);

    const { data: rows, error } = await query;
    if (error) {
      if (isMissingTable(error)) return { rows: [] as CommissionPayoutRow[], migrationRequired: true };
      throw new Error(error.message);
    }

    const enriched = await enrichCommissionLedgerRows(
      supabaseAdmin,
      (rows ?? []) as RawCommissionLedgerRow[],
      tenantId,
    );

    return { rows: enriched, migrationRequired: false };
  });

export const updateCommissionPayoutStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        ledgerId: z.string().uuid(),
        payoutStatus: PAYOUT_STATUS_Z,
        payoutNote: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    if (!canAmendCommissionPayouts(access)) throw new Error("Forbidden");
    await assertRowBelongsToTenant({
      table: "finance_ledger",
      id: data.ledgerId,
      authorisedTenantId: tenantId,
      select: "id, tenant_id",
    });

    return await applyCommissionPayoutStatusPatch(data, context.userId, tenantId);
  });

export const updateSessionCommissionPayoutStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        ledgerId: z.string().uuid(),
        payoutStatus: PAYOUT_STATUS_Z,
        payoutNote: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    if (!canAmend(access, "finance_customer")) throw new Error("Forbidden");
    await assertRowBelongsToTenant({
      table: "interview_sessions",
      id: data.sessionId,
      authorisedTenantId: tenantId,
      select: "id, tenant_id",
    });

    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: row, error } = await supabaseAdmin
      .from("finance_ledger")
      .select("id, session_id, kind")
      .eq("id", data.ledgerId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row || row.kind !== "commission" || row.session_id !== data.sessionId) {
      throw new Error("Commission row not found for this case");
    }

    return await applyCommissionPayoutStatusPatch(data, context.userId, tenantId);
  });

async function applyCommissionPayoutStatusPatch(
  data: {
    ledgerId: string;
    payoutStatus: PayoutStatus;
    payoutNote?: string;
  },
  userId: string,
  tenantId: string,
) {
    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: row, error: readErr } = await supabaseAdmin
      .from("finance_ledger")
      .select("id, kind, referral_id, beneficiary_role")
      .eq("id", data.ledgerId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!row || row.kind !== "commission") throw new Error("Commission row not found");

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      payout_status: data.payoutStatus,
      payout_note: data.payoutNote ?? null,
      lost_reason: null,
      payout_at: data.payoutStatus === "received" ? null : now,
      payout_by: data.payoutStatus === "received" ? null : userId,
    };

    const { error } = await supabaseAdmin
      .from("finance_ledger")
      .update(patch)
      .eq("id", data.ledgerId)
      .eq("tenant_id", tenantId);
    if (error) {
      if (isMissingTable(error)) {
        throw new Error("Run supabase/RUN_COMMISSION_PAYOUTS.sql in Supabase first.");
      }
      throw new Error(error.message);
    }

    if (row.referral_id && row.beneficiary_role === "referrer") {
      const bonusMap: Record<PayoutStatus, string> = {
        received: "eligible",
        paid: "paid",
        rejected: "rejected",
      };
      await supabaseAdmin
        .from("referrals")
        .update({ bonus_status: bonusMap[data.payoutStatus], updated_at: now })
        .eq("id", row.referral_id)
        .eq("tenant_id", tenantId);
    }

    return { ok: true };
}

export type FinanceAuditRow = {
  id: string;
  audit_type: string;
  summary: string;
  role: string | null;
  fee_type: string | null;
  created_at: string;
};

export const listFinanceAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    if (!canViewFinanceReport(access)) throw new Error("Forbidden");

    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data, error } = await supabaseAdmin
      .from("finance_audit_log")
      .select("id, audit_type, summary, role, fee_type, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error && !isMissingTable(error)) throw new Error(error.message);
    return (data ?? []) as FinanceAuditRow[];
  });

export type CommissionArrangementRow = {
  userId: string;
  name: string;
  role: "advisor" | "introducer";
  referenceCode: string | null;
  /** Null means no rate is set for that fee type (distinct from an explicit 0%). */
  pctFee: number | null;
  pctMortgageFee: number | null;
  pctInsuranceFee: number | null;
  pctOtherFee: number | null;
};

export const listCurrentCommissionArrangements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ role: z.enum(["all", "advisor", "introducer"]).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { tenantId, access } = await resolveFinanceTenant(context.userId);
    if (!canViewFinanceReport(access)) throw new Error("Forbidden");

    const roleFilter = data.role ?? "all";
    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const versions = await loadTenantRateVersions(supabaseAdmin, tenantId, {
      subjectKind:
        roleFilter === "all" ? undefined : roleFilter === "advisor" ? "adviser" : "introducer",
    });

    // Current = latest version effective now, per subject and fee type.
    const nowMs = Date.now();
    const currentBySubject = new Map<
      string,
      { row: RateVersionRow; pct: Partial<Record<CommissionFeeType, number>> }
    >();
    for (const v of versions) {
      if (Date.parse(v.effective_from) > nowMs) continue;
      const key = rateSubjectKey(v);
      const entry = currentBySubject.get(key) ?? { row: v, pct: {} };
      entry.pct[v.fee_type] = Number(v.percentage);
      currentBySubject.set(key, entry);
    }

    const introducerUsers = await tenantIntroducerUsers(supabaseAdmin, tenantId, [
      ...new Set([...currentBySubject.values()].map((e) => e.row.introducer_id).filter(Boolean)),
    ] as string[]);
    const userIdFor = (v: RateVersionRow) =>
      v.subject_kind === "adviser"
        ? v.adviser_user_id
        : (introducerUsers.get(v.introducer_id as string)?.userId ?? null);

    const userIds = [
      ...new Set([...currentBySubject.values()].map((e) => userIdFor(e.row)).filter(Boolean)),
    ] as string[];
    const nameMap = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);
      for (const p of profiles ?? []) nameMap.set(p.id, p.full_name || p.email || "Unknown");
    }

    const advisorCodes = new Map<string, string>();
    const introCodes = new Map<string, string>();
    const { data: adv } = await supabaseAdmin
      .from("advisor_profiles")
      .select("user_id, code")
      .eq("tenant_id", tenantId);
    for (const a of adv ?? []) advisorCodes.set(a.user_id, a.code);
    const { data: intros } = await supabaseAdmin
      .from("introducers")
      .select("id, company_code")
      .eq("tenant_id", tenantId);
    for (const i of intros ?? [])
      introCodes.set(i.id, (i as { company_code?: string }).company_code ?? "");

    const rows: CommissionArrangementRow[] = [];
    for (const { row, pct } of currentBySubject.values()) {
      const userId = userIdFor(row);
      if (!userId) continue;
      const role = row.subject_kind === "adviser" ? "advisor" : "introducer";
      rows.push({
        userId,
        name:
          nameMap.get(userId) ??
          (role === "introducer"
            ? introducerUsers.get(row.introducer_id as string)?.companyName
            : null) ??
          "Unknown",
        role,
        referenceCode:
          role === "advisor"
            ? (advisorCodes.get(userId) ?? null)
            : introCodes.get(row.introducer_id as string) || null,
        pctFee: pct.fee ?? null,
        pctMortgageFee: pct.mortgage_fee ?? null,
        pctInsuranceFee: pct.insurance_fee ?? null,
        pctOtherFee: pct.other_fee ?? null,
      });
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  });
