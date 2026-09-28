/**
 * G7F-3B1 privileged MFA status + MFA audit events (server only).
 *
 * Authority model:
 *  - MFA_ENROLLED / MFA_VERIFIED_LOGIN are authoritative: written only when the request's
 *    getClaims-verified context is aal2 with a fresh TOTP AMR entry AND the Auth admin API
 *    lists the factor as verified for this user. A browser report alone writes nothing.
 *  - MFA_CHALLENGE_FAILED is informational: Supabase Auth keeps no failed-attempt record the
 *    server can check, so it is stored as client_reported / authoritative:false, for
 *    privileged users only, at most once per user per 15 minutes, never with the entered code.
 * Recording is independent of PRIVILEGED_MFA_MODE; it never grants or denies anything.
 */
import { supabaseAdmin, supabaseAdminUntyped as db } from "@/integrations/supabase/client.server";
import { writePlatformAuditEvent } from "@/lib/platform-audit.server";
import { resolvePlatformAuthority } from "@/lib/platform-authority.server";
import type { PlatformAuthorityView, PlatformRole } from "@/lib/platform-authority";
import {
  isVerifiedAuthContext,
  latestTotpAmrTimestamp,
  parseAmrClaim,
  platformPrivilegedMfaRequired,
  PRIVILEGED_FRESH_AUTH_MAX_AGE_SEC,
  type AuthAssuranceContext,
  type PrivilegedMfaMode,
  type VerifiedAuthContext,
} from "@/lib/privileged-mfa";
import {
  evaluateFreshPrivilegedAuthForRequest,
  getPrivilegedMfaMode,
  type AuthAssuranceInput,
} from "@/lib/privileged-mfa.server";
import { getRequestAuthAssurance } from "@/lib/request-auth-context.server";

export const MFA_EVENT_FRESH_MAX_AGE_SEC = PRIVILEGED_FRESH_AUTH_MAX_AGE_SEC.platformAuthorityChange;
export const MFA_ENROLMENT_EVIDENCE_WINDOW_SEC = 15 * 60;
export const MFA_CHALLENGE_FAILED_THROTTLE_MS = 15 * 60 * 1000;
const AUDIT_SOURCE = "g7f3b1_privileged_mfa";

export type PrivilegedMfaStatus = {
  userId: string;
  platformRoles: PlatformRole[];
  isSuperOwner: boolean;
  isSuperAdmin: boolean;
  isBreakGlass: boolean;
  privilegedMfaRequired: boolean;
  mode: PrivilegedMfaMode;
  enforced: boolean;
  /** True only when the request's claims were verified by getClaims. */
  claimsVerified: boolean;
  /** Verified-claims aal; null when claims are unverified. */
  aal: string | null;
  /** Seconds since the last TOTP AMR entry when within the 5-minute window, else null. */
  recentMfaAgeSec: number | null;
  /** Enforce mode only: privileged user without verified aal2 must complete MFA. */
  continuationBlocked: boolean;
};

function resolveAuth(auth: AuthAssuranceInput): AuthAssuranceContext | null {
  return auth === undefined ? getRequestAuthAssurance() : auth;
}

function platformRolesOf(view: PlatformAuthorityView): PlatformRole[] {
  const roles: PlatformRole[] = [];
  if (view.isSuperOwner) roles.push("super_owner");
  if (view.isSuperAdmin) roles.push("super_admin");
  return roles;
}

export async function resolvePrivilegedMfaStatus(input: {
  userId: string;
  auth?: AuthAssuranceInput;
}): Promise<PrivilegedMfaStatus> {
  const view = await resolvePlatformAuthority(input.userId);
  const platformRoles = platformRolesOf(view);
  const required = platformPrivilegedMfaRequired({ platformRoles, isBreakGlass: view.isBreakGlass });
  const mode = getPrivilegedMfaMode();
  const ctx = resolveAuth(input.auth);
  const verified = isVerifiedAuthContext(ctx) && ctx.userId === input.userId;
  const aal = verified ? (ctx as VerifiedAuthContext).aal : null;
  const fresh = evaluateFreshPrivilegedAuthForRequest(ctx, {
    maxAgeSec: MFA_EVENT_FRESH_MAX_AGE_SEC,
    userId: input.userId,
  });
  return {
    userId: input.userId,
    platformRoles,
    isSuperOwner: view.isSuperOwner,
    isSuperAdmin: view.isSuperAdmin,
    isBreakGlass: view.isBreakGlass,
    privilegedMfaRequired: required,
    mode,
    enforced: mode === "enforce",
    claimsVerified: verified,
    aal,
    recentMfaAgeSec: fresh.satisfied ? fresh.mfaProofAgeSec : null,
    continuationBlocked: mode === "enforce" && required && aal !== "aal2",
  };
}

export type PrivilegedMfaEventKind = "enrolled" | "verified" | "challenge_failed";

export type RecordMfaEventResult =
  | { recorded: true; eventType: "MFA_ENROLLED" | "MFA_VERIFIED_LOGIN" | "MFA_CHALLENGE_FAILED" }
  | {
      recorded: false;
      reason:
        | "claims_unverified"
        | "not_privileged"
        | "fresh_mfa_missing"
        | "factor_not_verified"
        | "enrolment_not_recent"
        | "duplicate"
        | "throttled"
        | "lookup_failed";
    };

type AdminFactor = { id: string; factor_type: string; status: string; friendly_name?: string; updated_at: string };

async function listVerifiedTotpFactorsAdmin(userId: string): Promise<AdminFactor[] | null> {
  const { data, error } = await supabaseAdmin.auth.admin.mfa.listFactors({ userId });
  if (error || !data) return null;
  return (data.factors as AdminFactor[]).filter((f) => f.factor_type === "totp" && f.status === "verified");
}

async function auditEventExists(
  eventType: string,
  actingUserId: string,
  metadataMatch: Record<string, unknown>,
  sinceIso?: string,
): Promise<boolean | null> {
  let q = db
    .from("security_audit_events")
    .select("id")
    .eq("event_type", eventType)
    .eq("acting_user_id", actingUserId)
    .contains("metadata", metadataMatch);
  if (sinceIso) q = q.gte("created_at", sinceIso);
  const { data, error } = await q.limit(1);
  if (error) return null;
  return Array.isArray(data) && data.length > 0;
}

const challengeFailedLastWrite = new Map<string, number>();

export function resetMfaEventThrottleForTests(): void {
  challengeFailedLastWrite.clear();
}

export async function recordPrivilegedMfaEventImpl(input: {
  userId: string;
  event: PrivilegedMfaEventKind;
  factorId?: string | null;
  auth?: AuthAssuranceInput;
  nowMs?: number;
}): Promise<RecordMfaEventResult> {
  const ctx = resolveAuth(input.auth);
  if (!isVerifiedAuthContext(ctx) || ctx.userId !== input.userId) {
    return { recorded: false, reason: "claims_unverified" };
  }
  const view = await resolvePlatformAuthority(input.userId);
  const platformRoles = platformRolesOf(view);
  if (!platformPrivilegedMfaRequired({ platformRoles, isBreakGlass: view.isBreakGlass })) {
    return { recorded: false, reason: "not_privileged" };
  }
  const nowMs = input.nowMs ?? Date.now();
  const baseMeta = {
    source: AUDIT_SOURCE,
    platform_roles: platformRoles,
    break_glass: view.isBreakGlass,
    session_id: ctx.sessionId,
  };

  if (input.event === "challenge_failed") {
    const last = challengeFailedLastWrite.get(input.userId);
    if (last !== undefined && nowMs - last < MFA_CHALLENGE_FAILED_THROTTLE_MS) {
      return { recorded: false, reason: "throttled" };
    }
    const since = new Date(nowMs - MFA_CHALLENGE_FAILED_THROTTLE_MS).toISOString();
    const recent = await auditEventExists("MFA_CHALLENGE_FAILED", input.userId, { source: AUDIT_SOURCE }, since);
    if (recent === null) return { recorded: false, reason: "lookup_failed" };
    challengeFailedLastWrite.set(input.userId, nowMs);
    if (recent) return { recorded: false, reason: "throttled" };
    await writePlatformAuditEvent({
      eventType: "MFA_CHALLENGE_FAILED",
      actingUserId: input.userId,
      subjectUserId: input.userId,
      metadata: { ...baseMeta, authoritative: false, client_reported: true },
    });
    return { recorded: true, eventType: "MFA_CHALLENGE_FAILED" };
  }

  const fresh = evaluateFreshPrivilegedAuthForRequest(ctx, {
    maxAgeSec: MFA_EVENT_FRESH_MAX_AGE_SEC,
    userId: input.userId,
  });
  if (!fresh.satisfied) return { recorded: false, reason: "fresh_mfa_missing" };
  const factors = await listVerifiedTotpFactorsAdmin(input.userId);
  if (factors === null) return { recorded: false, reason: "lookup_failed" };

  if (input.event === "enrolled") {
    const factor = input.factorId ? factors.find((f) => f.id === input.factorId) : undefined;
    if (!factor) return { recorded: false, reason: "factor_not_verified" };
    const verifiedAtMs = Date.parse(factor.updated_at);
    if (!Number.isFinite(verifiedAtMs) || nowMs - verifiedAtMs > MFA_ENROLMENT_EVIDENCE_WINDOW_SEC * 1000) {
      return { recorded: false, reason: "enrolment_not_recent" };
    }
    const exists = await auditEventExists("MFA_ENROLLED", input.userId, { factor_id: factor.id });
    if (exists === null) return { recorded: false, reason: "lookup_failed" };
    if (exists) return { recorded: false, reason: "duplicate" };
    await writePlatformAuditEvent({
      eventType: "MFA_ENROLLED",
      actingUserId: input.userId,
      subjectUserId: input.userId,
      metadata: {
        ...baseMeta,
        authoritative: true,
        evidence: "verified_claims_aal2_recent_mfa_factor_verified",
        factor_id: factor.id,
        factor_friendly_name: factor.friendly_name ?? null,
        mfa_age_sec: fresh.mfaProofAgeSec,
      },
    });
    return { recorded: true, eventType: "MFA_ENROLLED" };
  }

  if (factors.length === 0) return { recorded: false, reason: "factor_not_verified" };
  const amr = parseAmrClaim(ctx.amr);
  const mfaAt = amr.status === "ok" ? latestTotpAmrTimestamp(amr.entries) : null;
  const exists = await auditEventExists("MFA_VERIFIED_LOGIN", input.userId, {
    session_id: ctx.sessionId,
    mfa_at: mfaAt,
  });
  if (exists === null) return { recorded: false, reason: "lookup_failed" };
  if (exists) return { recorded: false, reason: "duplicate" };
  await writePlatformAuditEvent({
    eventType: "MFA_VERIFIED_LOGIN",
    actingUserId: input.userId,
    subjectUserId: input.userId,
    metadata: {
      ...baseMeta,
      authoritative: true,
      evidence: "verified_claims_aal2_recent_mfa_factor_verified",
      mfa_at: mfaAt,
      mfa_age_sec: fresh.mfaProofAgeSec,
    },
  });
  return { recorded: true, eventType: "MFA_VERIFIED_LOGIN" };
}
