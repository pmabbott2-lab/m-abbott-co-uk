/**
 * G7F-3A server-side privileged MFA enforcement (server-only).
 *
 * Mode: PRIVILEGED_MFA_MODE server env (disabled | audit | enforce). Never read from VITE_*,
 * request input, cookies or headers — the browser cannot choose the mode.
 *   disabled: evaluate from trusted context only; no denial, no audit writes.
 *   audit:    evaluate; write audit events for would-deny / fresh-auth success; never deny.
 *   enforce:  deny (throw PrivilegedMfaRequiredError) unless policy is satisfied.
 *
 * Independent of TEMP_SUSPEND_LOGIN_MFA / SKIP_LOGIN_MFA / VITE_SKIP_LOGIN_MFA, which only
 * control the client login UX and are not security switches.
 */
import {
  evaluateBoundAuthSession,
  evaluateFreshPrivilegedAuth,
  evaluatePlatformAal2,
  isVerifiedAuthContext,
  parsePrivilegedMfaMode,
  privilegedMfaShouldDeny,
  type AuthAssuranceContext,
  type PrivilegedMfaAction,
  type PrivilegedMfaEvaluation,
  type PrivilegedMfaMode,
  type VerifiedAuthContext,
} from "@/lib/privileged-mfa";
import { getRequestAuthAssurance } from "@/lib/request-auth-context.server";

export class PrivilegedMfaRequiredError extends Error {
  readonly code: "PRIVILEGED_AAL_REQUIRED" | "PRIVILEGED_REAUTH_REQUIRED";
  readonly reason: string | null;
  constructor(code: PrivilegedMfaRequiredError["code"], reason: string | null) {
    super(
      code === "PRIVILEGED_REAUTH_REQUIRED"
        ? "Re-verify with your authenticator app to continue."
        : "Authenticator verification is required for platform administration.",
    );
    this.name = "PrivilegedMfaRequiredError";
    this.code = code;
    this.reason = reason;
  }
}

export function getPrivilegedMfaMode(): PrivilegedMfaMode {
  return parsePrivilegedMfaMode(process.env.PRIVILEGED_MFA_MODE);
}

/**
 * undefined → the current request's context (set by requireSupabaseAuth).
 * null → explicitly no context.
 */
export type AuthAssuranceInput = AuthAssuranceContext | null | undefined;

function resolveAuth(auth: AuthAssuranceInput): AuthAssuranceContext | null {
  return auth === undefined ? getRequestAuthAssurance() : auth;
}

/** Returns verified claims or throws. Unverified JWT fallback is rejected. */
export function requireVerifiedAuthClaims(auth?: AuthAssuranceInput): VerifiedAuthContext {
  const ctx = resolveAuth(auth);
  if (!isVerifiedAuthContext(ctx)) {
    throw new PrivilegedMfaRequiredError(
      "PRIVILEGED_AAL_REQUIRED",
      ctx ? "claims_unverified" : "claims_missing",
    );
  }
  return ctx;
}

/** Verified session id for server-side binding (never the unverified fallback). */
export function getVerifiedAuthSessionId(auth?: AuthAssuranceInput): string | null {
  const ctx = resolveAuth(auth);
  return isVerifiedAuthContext(ctx) ? ctx.sessionId : null;
}

export type PrivilegedMfaCheck = {
  action: PrivilegedMfaAction;
  userId?: string | null;
  tenantId?: string | null;
  targetUserId?: string | null;
  target?: string | null;
};

export type PrivilegedMfaDecision = PrivilegedMfaEvaluation & {
  mode: PrivilegedMfaMode;
  denied: boolean;
};

const AUDIT_THROTTLE_MS = 5 * 60 * 1000;
const auditThrottle = new Map<string, number>();

function throttled(key: string): boolean {
  const now = Date.now();
  const last = auditThrottle.get(key);
  if (last !== undefined && now - last < AUDIT_THROTTLE_MS) return true;
  auditThrottle.set(key, now);
  if (auditThrottle.size > 5000) auditThrottle.clear();
  return false;
}

async function writeMfaAudit(
  eventType: "PRIVILEGED_AAL_DENIED" | "PRIVILEGED_REAUTH_REQUIRED" | "PRIVILEGED_REAUTH_SUCCEEDED",
  check: PrivilegedMfaCheck,
  mode: PrivilegedMfaMode,
  evaluation: PrivilegedMfaEvaluation,
  actingUserId: string | null,
): Promise<void> {
  try {
    const { writePlatformAuditEvent } = await import("@/lib/platform-audit.server");
    await writePlatformAuditEvent({
      eventType,
      actingUserId,
      subjectUserId: check.targetUserId ?? null,
      tenantId: check.tenantId ?? null,
      metadata: {
        source: "g7f3a_privileged_mfa",
        mode,
        enforced: mode === "enforce",
        action: check.action,
        target: check.target ?? null,
        result_reason: evaluation.reason,
        aal: evaluation.aal,
        session_id: evaluation.sessionId,
        mfa_proof_age_sec: evaluation.mfaProofAgeSec,
      },
    });
  } catch {
    /* audit must not block the request; enforcement decision is independent */
  }
}

export type PrivilegedMfaCheckKind = "aal" | "fresh" | "bound_session";

/** Audit (audit/enforce modes) and return the mode decision. Never throws. */
export async function recordPrivilegedMfaEvaluation(
  kind: PrivilegedMfaCheckKind,
  check: PrivilegedMfaCheck,
  evaluation: PrivilegedMfaEvaluation,
  auth?: AuthAssuranceInput,
): Promise<PrivilegedMfaDecision> {
  const ctx = resolveAuth(auth);
  const mode = getPrivilegedMfaMode();
  const denied = privilegedMfaShouldDeny(mode, evaluation);
  if (mode !== "disabled") {
    const actingUserId = (isVerifiedAuthContext(ctx) ? ctx.userId : null) ?? check.userId ?? null;
    if (!evaluation.satisfied) {
      const eventType = kind === "fresh" ? "PRIVILEGED_REAUTH_REQUIRED" : "PRIVILEGED_AAL_DENIED";
      const key = `${eventType}:${actingUserId}:${check.action}:${evaluation.reason}`;
      if (mode === "enforce" || kind === "fresh" || !throttled(key)) {
        await writeMfaAudit(eventType, check, mode, evaluation, actingUserId);
      }
    } else if (kind === "fresh") {
      await writeMfaAudit("PRIVILEGED_REAUTH_SUCCEEDED", check, mode, evaluation, actingUserId);
    }
  }
  return { ...evaluation, mode, denied };
}

async function decideOrThrow(
  kind: PrivilegedMfaCheckKind,
  check: PrivilegedMfaCheck,
  evaluation: PrivilegedMfaEvaluation,
  ctx: AuthAssuranceContext | null,
): Promise<PrivilegedMfaDecision> {
  const decision = await recordPrivilegedMfaEvaluation(kind, check, evaluation, ctx);
  if (decision.denied) {
    throw new PrivilegedMfaRequiredError(
      kind === "fresh" ? "PRIVILEGED_REAUTH_REQUIRED" : "PRIVILEGED_AAL_REQUIRED",
      evaluation.reason,
    );
  }
  return decision;
}

/** Evaluation only (no audit, no denial) against the trusted request context. */
export function evaluateFreshPrivilegedAuthForRequest(
  auth: AuthAssuranceInput,
  opts: { maxAgeSec: number; bindSessionId?: string | null; userId?: string | null },
): PrivilegedMfaEvaluation {
  return evaluateFreshPrivilegedAuth(resolveAuth(auth), {
    maxAgeSec: opts.maxAgeSec,
    nowSec: Math.floor(Date.now() / 1000),
    bindSessionId: opts.bindSessionId,
    expectedUserId: opts.userId,
  });
}

/** Platform privileged request: verified claims + aal2. Denies only in enforce mode. */
export async function requirePlatformAal2(
  auth: AuthAssuranceInput,
  check: PrivilegedMfaCheck,
): Promise<PrivilegedMfaDecision> {
  const ctx = resolveAuth(auth);
  const evaluation = evaluatePlatformAal2(ctx, { expectedUserId: check.userId });
  return decideOrThrow("aal", check, evaluation, ctx);
}

/**
 * High-risk action: verified aal2 + TOTP AMR within maxAgeSec (+ optional exact session binding).
 * Denies only in enforce mode.
 */
export async function requireFreshPrivilegedAuth(
  auth: AuthAssuranceInput,
  opts: PrivilegedMfaCheck & { maxAgeSec: number; bindSessionId?: string | null },
): Promise<PrivilegedMfaDecision> {
  const ctx = resolveAuth(auth);
  const evaluation = evaluateFreshPrivilegedAuthForRequest(ctx, opts);
  return decideOrThrow("fresh", opts, evaluation, ctx);
}

/**
 * Bound-session check (G7D row / BG platform session): verified aal2 and claims session_id
 * equal to the stored auth_session_id. Returns false only when enforce mode must treat the
 * session as invalid; never throws, so callers keep their null/inactive contract.
 */
export async function checkBoundAuthSession(
  auth: AuthAssuranceInput,
  input: PrivilegedMfaCheck & { userId: string; storedAuthSessionId: string | null },
): Promise<boolean> {
  const ctx = resolveAuth(auth);
  const evaluation = evaluateBoundAuthSession(ctx, input.storedAuthSessionId, {
    expectedUserId: input.userId,
  });
  const decision = await recordPrivilegedMfaEvaluation("bound_session", input, evaluation, ctx);
  return !decision.denied;
}
