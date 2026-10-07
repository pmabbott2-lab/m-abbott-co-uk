/**
 * Gate G7F-4S4C4-B4a — tenant commission rate versions.
 *
 * A rate belongs to one tenant's commercial subject: an introducer registration
 * (tenant_id, introducer_id) or an adviser capacity (tenant_id, user_id, role 'adviser').
 * The applicable rate is the version effective at the event time; no version means
 * "no rate set", which is distinct from an explicit 0% version. There is no fallback to
 * another tenant, a global user rate, the current rate or any default.
 */
import type { supabaseAdminUntyped } from "@/integrations/supabase/client.server";

export const COMMISSION_FEE_TYPES = ["fee", "mortgage_fee", "insurance_fee", "other_fee"] as const;
export type CommissionFeeType = (typeof COMMISSION_FEE_TYPES)[number];

/** Introducers earn on fee and mortgage fee only; insurance and other stay adviser-exclusive. */
export const INTRODUCER_FEE_TYPES: readonly CommissionFeeType[] = ["fee", "mortgage_fee"];

export type CommissionRateSubject =
  | { kind: "introducer"; introducerId: string }
  | { kind: "adviser"; adviserUserId: string };

export type RateVersion = {
  versionId: string;
  percentage: number;
  effectiveFrom: string;
};

type Db = typeof supabaseAdminUntyped;

export function rateSubjectArgs(subject: CommissionRateSubject) {
  return subject.kind === "introducer"
    ? {
        p_subject_kind: "introducer",
        p_introducer_id: subject.introducerId,
        p_adviser_user_id: null,
      }
    : {
        p_subject_kind: "adviser",
        p_introducer_id: null,
        p_adviser_user_id: subject.adviserUserId,
      };
}

/** The version effective at `eventAt` for exactly this tenant, subject and fee type, or null. */
export async function resolveCommissionRateAsOf(
  db: Db,
  opts: {
    tenantId: string;
    subject: CommissionRateSubject;
    feeType: CommissionFeeType;
    eventAt: Date | string;
  },
): Promise<RateVersion | null> {
  const eventMs =
    opts.eventAt instanceof Date
      ? opts.eventAt.getTime()
      : typeof opts.eventAt === "string" && opts.eventAt
        ? Date.parse(opts.eventAt)
        : Number.NaN;
  if (!Number.isFinite(eventMs)) throw new Error("commission_rate_resolve_invalid");
  const eventAt = new Date(eventMs).toISOString();
  const { data, error } = await db.rpc("resolve_commission_rate_as_of", {
    p_tenant_id: opts.tenantId,
    ...rateSubjectArgs(opts.subject),
    p_fee_type: opts.feeType,
    p_event_at: eventAt,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{
    version_id: string;
    percentage: number | string;
    effective_from: string;
  }>;
  if (rows.length === 0) return null;
  if (rows.length !== 1) throw new Error("commission_rate_ambiguous");
  return {
    versionId: rows[0]!.version_id,
    percentage: Number(rows[0]!.percentage),
    effectiveFrom: rows[0]!.effective_from,
  };
}

export type TenantRateSubject = {
  subject: CommissionRateSubject;
  /** Auth user behind the subject (introducer registrations always carry one). */
  userId: string;
  /** False when the registration or capacity is disabled, removed or deactivated. */
  usable: boolean;
};

/**
 * The commercial subject of `userId` in `tenantId` for `role`, read only from that tenant's rows.
 * Advisor: the user's adviser membership in the tenant. Introducer: the user's registration in the
 * tenant (unique per tenant and user). Null when the tenant holds no such subject.
 */
export async function findTenantRateSubject(
  db: Db,
  tenantId: string,
  role: "advisor" | "introducer",
  userId: string,
): Promise<TenantRateSubject | null> {
  if (role === "advisor") {
    const { data, error } = await db
      .from("tenant_memberships")
      .select("user_id, active")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .eq("role", "adviser")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      subject: { kind: "adviser", adviserUserId: userId },
      userId,
      usable: data.active === true,
    };
  }
  const { data, error } = await db
    .from("introducers")
    .select("id, user_id, active, deleted_at")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    subject: { kind: "introducer", introducerId: data.id as string },
    userId,
    usable: data.active === true && !data.deleted_at,
  };
}

export function feeTypesForSubject(subject: CommissionRateSubject): readonly CommissionFeeType[] {
  return subject.kind === "introducer" ? INTRODUCER_FEE_TYPES : COMMISSION_FEE_TYPES;
}

export const RATE_ERROR_MESSAGES: Array<[string, string]> = [
  ["commission_rate_forbidden", "Forbidden"],
  ["commission_rate_subject_not_found", "Not found."],
  ["commission_rate_tenant_inactive", "Not found."],
  ["commission_rate_no_change", "No rate changed."],
  [
    "commission_rate_effective_not_after_latest",
    "The effective date must be after the latest rate already recorded for this fee type.",
  ],
  [
    "commission_rate_backdate_unconfirmed",
    "That effective date is in the past. Confirm the backdated rate to continue.",
  ],
  ["commission_rate_backdate_reason_required", "A backdated rate needs a reason."],
  ["commission_rate_effective_invalid", "Choose when the rate takes effect."],
  ["commission_rate_fee_type_not_allowed", "Introducers earn on fee and mortgage fee only."],
  [
    "commission_rate_percentage_invalid",
    "Rates must be between 0 and 100 with at most three decimal places.",
  ],
];

export function rateMutationErrorMessage(message: string): string {
  for (const [code, text] of RATE_ERROR_MESSAGES) {
    if (message.includes(code)) return text;
  }
  return "Could not save the commission rate.";
}
