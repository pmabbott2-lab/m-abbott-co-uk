/**
 * G7F-3A privileged MFA policy (pure, shared-safe, no I/O).
 *
 * Trust boundary: only an AuthAssuranceContext produced by fromVerifiedSupabaseClaims()
 * (called exclusively by requireSupabaseAuth after supabase.auth.getClaims succeeded)
 * can satisfy AAL2 / fresh privileged authentication. The unverified JWT fallback,
 * browser-supplied values and the SMS sessionStorage marker (mh_login_sms_verified)
 * never satisfy any privileged MFA check.
 *
 * Authentication assurance (this module) is separate from authorization
 * (platform_roles / grants / G7D basis), which is unchanged.
 */

export const PRIVILEGED_MFA_MODES = ["disabled", "audit", "enforce"] as const;
export type PrivilegedMfaMode = (typeof PRIVILEGED_MFA_MODES)[number];

/**
 * Server-only env value. Unset/empty → disabled. Unrecognised values fail closed to enforce
 * so a mistyped operator setting can never silently weaken an enforced deployment.
 */
export function parsePrivilegedMfaMode(raw: string | null | undefined): PrivilegedMfaMode {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return "disabled";
  return (PRIVILEGED_MFA_MODES as readonly string[]).includes(value)
    ? (value as PrivilegedMfaMode)
    : "enforce";
}

/** Maximum age of the most recent verified TOTP AMR entry, in seconds. */
export const PRIVILEGED_FRESH_AUTH_MAX_AGE_SEC = {
  platformAuthorityChange: 5 * 60,
  breakGlassSession: 5 * 60,
  g7dEntry: 10 * 60,
  mfaRecovery: 5 * 60,
} as const;

/** Tolerated forward clock skew for AMR timestamps, in seconds. */
export const PRIVILEGED_AMR_CLOCK_SKEW_SEC = 60;

/** Supabase AMR method values that prove a TOTP verification. */
export const TOTP_AMR_METHODS: readonly string[] = ["totp", "mfa/totp"];

export const PRIVILEGED_MFA_ACTIONS = {
  platformRouteAccess: "platform.route_access",
  superOwnerAccess: "platform.super_owner_access",
  provisioningAccess: "platform.provisioning_access",
  platformRoleGrant: "platform.role_grant",
  platformRoleRevoke: "platform.role_revoke",
  platformInviteAccept: "platform.invite_accept",
  superAdminGrantUpsert: "platform.super_admin_grant_upsert",
  superAdminGrantRevoke: "platform.super_admin_grant_revoke",
  breakGlassIdentityEstablish: "platform.break_glass_identity_establish",
  tenantOwnerAdd: "platform.tenant_owner_add",
  tenantOwnerRemove: "platform.tenant_owner_remove",
  companyProvision: "platform.company_provision",
  g7dEntry: "platform.g7d_entry",
  g7dRequest: "platform.g7d_request",
  breakGlassSessionCreate: "platform.break_glass_session_create",
  breakGlassSessionUse: "platform.break_glass_session_use",
  mfaRecoveryRequest: "platform.mfa_recovery_request",
  mfaRecoveryApprove: "platform.mfa_recovery_approve",
  mfaRecoveryExecute: "platform.mfa_recovery_execute",
  mfaRecoveryCancel: "platform.mfa_recovery_cancel",
  mfaRecoveryReissue: "platform.mfa_recovery_reissue",
  mfaRecoveryComplete: "platform.mfa_recovery_complete",
} as const;
export type PrivilegedMfaAction = (typeof PRIVILEGED_MFA_ACTIONS)[keyof typeof PRIVILEGED_MFA_ACTIONS];

const VERIFIED_BRAND: unique symbol = Symbol("g7f3a.verifiedSupabaseClaims");

export type AmrEntry = { method: string; timestamp: number };

export type VerifiedAuthContext = {
  readonly claimsVerified: true;
  readonly userId: string;
  readonly aal: string | null;
  /** Raw claim value; parse with parseAmrClaim before use. */
  readonly amr: unknown;
  readonly sessionId: string | null;
  readonly issuedAt: number | null;
  /** Supabase access tokens carry no auth_time claim; always null. */
  readonly authTime: null;
  readonly verifiedClaims: Readonly<Record<string, unknown>>;
  readonly [VERIFIED_BRAND]: true;
};

export type UnverifiedAuthContext = {
  readonly claimsVerified: false;
  readonly userId: string | null;
  readonly source: "jwt_fallback_unverified";
};

export type AuthAssuranceContext = VerifiedAuthContext | UnverifiedAuthContext;

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Only requireSupabaseAuth may call this, and only with claims returned by getClaims(). */
export function fromVerifiedSupabaseClaims(claims: Record<string, unknown>): VerifiedAuthContext | null {
  const userId = nonEmptyString(claims.sub);
  if (!userId) return null;
  const iat = claims.iat;
  return Object.freeze({
    claimsVerified: true as const,
    userId,
    aal: nonEmptyString(claims.aal),
    amr: claims.amr,
    sessionId: nonEmptyString(claims.session_id),
    issuedAt: typeof iat === "number" && Number.isFinite(iat) ? Math.floor(iat) : null,
    authTime: null,
    verifiedClaims: Object.freeze({ ...claims }),
    [VERIFIED_BRAND]: true as const,
  });
}

export function unverifiedAuthContext(userId: string | null | undefined): UnverifiedAuthContext {
  return Object.freeze({
    claimsVerified: false as const,
    userId: nonEmptyString(userId),
    source: "jwt_fallback_unverified" as const,
  });
}

/** True only for contexts minted by fromVerifiedSupabaseClaims (plain objects are rejected). */
export function isVerifiedAuthContext(ctx: unknown): ctx is VerifiedAuthContext {
  if (!ctx || typeof ctx !== "object") return false;
  const c = ctx as Partial<VerifiedAuthContext>;
  return c.claimsVerified === true && c[VERIFIED_BRAND] === true && typeof c.userId === "string";
}

export type AmrParseResult =
  | { status: "ok"; entries: AmrEntry[] }
  | { status: "missing" }
  | { status: "malformed" };

/**
 * Supabase AMR: array of { method: string, timestamp: number (UNIX seconds) }.
 * RFC-8176 string[] form carries no timestamps and cannot prove freshness → malformed here.
 * Missing / empty / non-array / no well-formed entry never counts as success.
 */
export function parseAmrClaim(raw: unknown): AmrParseResult {
  if (raw === undefined || raw === null) return { status: "missing" };
  if (!Array.isArray(raw)) return { status: "malformed" };
  if (raw.length === 0) return { status: "missing" };
  const entries: AmrEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const method = (item as { method?: unknown }).method;
    const ts = (item as { timestamp?: unknown }).timestamp;
    if (typeof method !== "string" || !method.trim()) continue;
    if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) continue;
    entries.push({ method: method.trim(), timestamp: Math.floor(ts) });
  }
  return entries.length ? { status: "ok", entries } : { status: "malformed" };
}

/** Most recent TOTP AMR timestamp (seconds), or null. */
export function latestTotpAmrTimestamp(entries: readonly AmrEntry[]): number | null {
  let latest: number | null = null;
  for (const e of entries) {
    if (!TOTP_AMR_METHODS.includes(e.method)) continue;
    if (latest === null || e.timestamp > latest) latest = e.timestamp;
  }
  return latest;
}

export type PrivilegedMfaFailure =
  | "claims_missing"
  | "claims_unverified"
  | "user_mismatch"
  | "aal_insufficient"
  | "session_id_missing"
  | "session_binding_missing"
  | "session_id_mismatch"
  | "amr_missing"
  | "amr_malformed"
  | "fresh_mfa_missing"
  | "fresh_mfa_stale"
  | "fresh_mfa_future";

export type PrivilegedMfaEvaluation = {
  satisfied: boolean;
  reason: PrivilegedMfaFailure | null;
  aal: string | null;
  sessionId: string | null;
  /** Age of most recent TOTP proof in seconds (fresh-auth only). */
  mfaProofAgeSec: number | null;
};

function fail(
  reason: PrivilegedMfaFailure,
  ctx: VerifiedAuthContext | null,
  mfaProofAgeSec: number | null = null,
): PrivilegedMfaEvaluation {
  return {
    satisfied: false,
    reason,
    aal: ctx?.aal ?? null,
    sessionId: ctx?.sessionId ?? null,
    mfaProofAgeSec,
  };
}

/** Verified claims + aal2 + session_id present. */
export function evaluatePlatformAal2(
  ctx: AuthAssuranceContext | null | undefined,
  opts?: { expectedUserId?: string | null },
): PrivilegedMfaEvaluation {
  if (!ctx) return fail("claims_missing", null);
  if (!isVerifiedAuthContext(ctx)) return fail("claims_unverified", null);
  const expected = nonEmptyString(opts?.expectedUserId);
  if (expected && expected !== ctx.userId) return fail("user_mismatch", ctx);
  if (ctx.aal !== "aal2") return fail("aal_insufficient", ctx);
  if (!ctx.sessionId) return fail("session_id_missing", ctx);
  return { satisfied: true, reason: null, aal: ctx.aal, sessionId: ctx.sessionId, mfaProofAgeSec: null };
}

function evaluateSessionBinding(
  ctx: VerifiedAuthContext,
  bound: string | null | undefined,
): PrivilegedMfaFailure | null {
  if (!ctx.sessionId) return "session_id_missing";
  const expected = nonEmptyString(bound);
  if (!expected) return "session_binding_missing";
  return expected === ctx.sessionId ? null : "session_id_mismatch";
}

/**
 * Verified aal2 + a TOTP AMR entry no older than maxAgeSec (password alone never counts).
 * bindSessionId: when provided (even null), the claims session_id must equal it exactly.
 */
export function evaluateFreshPrivilegedAuth(
  ctx: AuthAssuranceContext | null | undefined,
  opts: {
    maxAgeSec: number;
    nowSec: number;
    bindSessionId?: string | null;
    expectedUserId?: string | null;
  },
): PrivilegedMfaEvaluation {
  const base = evaluatePlatformAal2(ctx, { expectedUserId: opts.expectedUserId });
  if (!base.satisfied) return base;
  const v = ctx as VerifiedAuthContext;
  if (opts.bindSessionId !== undefined) {
    const bindFailure = evaluateSessionBinding(v, opts.bindSessionId);
    if (bindFailure) return fail(bindFailure, v);
  }
  const amr = parseAmrClaim(v.amr);
  if (amr.status === "missing") return fail("amr_missing", v);
  if (amr.status === "malformed") return fail("amr_malformed", v);
  const latest = latestTotpAmrTimestamp(amr.entries);
  if (latest === null) return fail("fresh_mfa_missing", v);
  const age = Math.floor(opts.nowSec) - latest;
  if (age < -PRIVILEGED_AMR_CLOCK_SKEW_SEC) return fail("fresh_mfa_future", v, age);
  const maxAge = Math.max(0, Math.floor(opts.maxAgeSec));
  if (age > maxAge) return fail("fresh_mfa_stale", v, age);
  return {
    satisfied: true,
    reason: null,
    aal: v.aal,
    sessionId: v.sessionId,
    mfaProofAgeSec: Math.max(0, age),
  };
}

/**
 * Request-time binding for G7D rows and BG platform sessions: verified aal2 and
 * claims session_id === stored auth_session_id. Rows with null auth_session_id
 * (e.g. historical pre-G7F-3A G7D rows) never satisfy this.
 */
export function evaluateBoundAuthSession(
  ctx: AuthAssuranceContext | null | undefined,
  storedAuthSessionId: string | null | undefined,
  opts?: { expectedUserId?: string | null },
): PrivilegedMfaEvaluation {
  const base = evaluatePlatformAal2(ctx, opts);
  if (!base.satisfied) return base;
  const v = ctx as VerifiedAuthContext;
  const bindFailure = evaluateSessionBinding(v, storedAuthSessionId);
  return bindFailure ? fail(bindFailure, v) : base;
}

/**
 * Mandatory floor: super_owner, super_admin and break-glass always require privileged MFA.
 * Derived from platform_roles / BG registry only. Legacy user_roles are not an input, and
 * optional per-role policy (e.g. platform_mfa_policy) can only add requirements, never remove them.
 */
export const PRIVILEGED_MFA_MANDATORY_PLATFORM_ROLES: readonly string[] = ["super_owner", "super_admin"];

export function platformPrivilegedMfaRequired(input: {
  platformRoles: readonly string[];
  isBreakGlass: boolean;
  optionalPolicy?: Readonly<Record<string, boolean>>;
}): boolean {
  if (input.isBreakGlass) return true;
  if (input.platformRoles.some((r) => PRIVILEGED_MFA_MANDATORY_PLATFORM_ROLES.includes(r))) return true;
  const optional = input.optionalPolicy ?? {};
  return input.platformRoles.some((r) => optional[r] === true);
}

/** Pure mode gate: whether an unsatisfied evaluation must deny. */
export function privilegedMfaShouldDeny(mode: PrivilegedMfaMode, evaluation: PrivilegedMfaEvaluation): boolean {
  return mode === "enforce" && !evaluation.satisfied;
}

export type PrivilegedMfaErrorCode = "PRIVILEGED_AAL_REQUIRED" | "PRIVILEGED_REAUTH_REQUIRED";

/**
 * Server function errors reach the browser as message-only Errors (TanStack Start
 * ShallowErrorPlugin), so the client classifies privileged MFA denials by exact message.
 */
export const PRIVILEGED_MFA_ERROR_MESSAGES: Readonly<Record<PrivilegedMfaErrorCode, string>> = {
  PRIVILEGED_REAUTH_REQUIRED: "Re-verify with your authenticator app to continue.",
  PRIVILEGED_AAL_REQUIRED: "Authenticator verification is required for platform administration.",
};

export function classifyPrivilegedMfaError(err: unknown): PrivilegedMfaErrorCode | null {
  if (!err || typeof err !== "object") return null;
  const code = (err as { code?: unknown }).code;
  if (code === "PRIVILEGED_REAUTH_REQUIRED" || code === "PRIVILEGED_AAL_REQUIRED") return code;
  const message = (err as { message?: unknown }).message;
  if (message === PRIVILEGED_MFA_ERROR_MESSAGES.PRIVILEGED_REAUTH_REQUIRED) return "PRIVILEGED_REAUTH_REQUIRED";
  if (message === PRIVILEGED_MFA_ERROR_MESSAGES.PRIVILEGED_AAL_REQUIRED) return "PRIVILEGED_AAL_REQUIRED";
  return null;
}
