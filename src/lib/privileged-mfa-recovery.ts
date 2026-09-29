/**
 * G7F-3C3 privileged MFA recovery (pure, shared-safe, no I/O).
 *
 * Option D policy (authoritative enforcement lives in the service_role recovery RPCs):
 *   normal Super Owner target: another normal Super Owner requests with fresh TOTP; mandatory
 *     cooling-off, or a second qualifying approval (normal Super Owner or break-glass) expedites.
 *   Super Admin target: a normal Super Owner requests with fresh TOTP; no cooling-off.
 *   break-glass target: two distinct normal Super Owners (distinct Auth sessions) + cooling-off.
 * Super Admins and tenant roles never initiate or approve. Nobody recovers themselves.
 *
 * The one-time grant is 160 random bits shown once to the executing operator. Only its SHA-256
 * digest is stored. It must never be logged, audited, notified or kept in browser storage.
 */

export const MFA_RECOVERY_PATH = "/platform/mfa-recovery";

export const MFA_RECOVERY_STATUSES = [
  "requested",
  "approved",
  "executed_awaiting_enrolment",
  "completed",
  "cancelled",
  "expired",
  "denied",
  "failed",
] as const;
export type MfaRecoveryStatus = (typeof MFA_RECOVERY_STATUSES)[number];

export const MFA_RECOVERY_ACTIVE_STATUSES: readonly MfaRecoveryStatus[] = [
  "requested",
  "approved",
  "executed_awaiting_enrolment",
];
export const MFA_RECOVERY_TERMINAL_STATUSES: readonly MfaRecoveryStatus[] = [
  "completed",
  "cancelled",
  "expired",
  "denied",
  "failed",
];

export function isMfaRecoveryTerminal(status: string): boolean {
  return (MFA_RECOVERY_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export const MFA_RECOVERY_TARGET_KINDS = ["normal_so", "super_admin", "break_glass"] as const;
export type MfaRecoveryTargetKind = (typeof MFA_RECOVERY_TARGET_KINDS)[number];

export const MFA_RECOVERY_TARGET_KIND_LABELS: Readonly<Record<MfaRecoveryTargetKind, string>> = {
  normal_so: "Super Owner",
  super_admin: "Super Admin",
  break_glass: "Break-glass",
};

export const MFA_RECOVERY_STATUS_LABELS: Readonly<Record<MfaRecoveryStatus, string>> = {
  requested: "Requested",
  approved: "Approved",
  executed_awaiting_enrolment: "Awaiting new authenticator",
  completed: "Completed",
  cancelled: "Cancelled",
  expired: "Expired",
  denied: "Denied",
  failed: "Failed",
};

export const MFA_RECOVERY_REASON_MIN = 10;
export const MFA_RECOVERY_REASON_MAX = 500;
export const MFA_RECOVERY_GRANT_TTL_MIN = 30;
export const MFA_RECOVERY_EXECUTION_WINDOW_MIN = 60;
export const MFA_RECOVERY_ENROLMENT_WINDOW_HOURS = 24;

/** Database floor for any cooling-off. */
export const MFA_RECOVERY_COOLING_OFF_FLOOR_MIN = 15;
/** Production never inherits the staging value: default and floor are both one hour. */
export const MFA_RECOVERY_PRODUCTION_COOLING_OFF_MIN = 60;
export const MFA_RECOVERY_COOLING_OFF_MAX_MIN = 7 * 24 * 60;

/**
 * Cooling-off minutes for normal Super Owner and break-glass targets.
 * production (or unknown environment): default 60, never below 60.
 * staging / development: default 15, never below 15.
 * raw: MFA_RECOVERY_COOLING_OFF_MINUTES (server env only).
 */
export function resolveMfaRecoveryCoolingOffMinutes(input: {
  appEnv: string | null | undefined;
  raw?: string | null;
}): number {
  const env = (input.appEnv ?? "").trim().toLowerCase();
  const nonProduction = env === "staging" || env === "development";
  const floor = nonProduction ? MFA_RECOVERY_COOLING_OFF_FLOOR_MIN : MFA_RECOVERY_PRODUCTION_COOLING_OFF_MIN;
  const text = (input.raw ?? "").trim();
  const parsed = /^\d{1,6}$/.test(text) ? Number(text) : NaN;
  const value = Number.isFinite(parsed) ? parsed : floor;
  return Math.min(MFA_RECOVERY_COOLING_OFF_MAX_MIN, Math.max(floor, value));
}

/** Crockford base32 (no I, L, O, U). */
export const MFA_RECOVERY_GRANT_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const MFA_RECOVERY_GRANT_BYTES = 20;
export const MFA_RECOVERY_GRANT_CHARS = 32;
export const MFA_RECOVERY_GRANT_HASH_PREFIX = "mh-mfa-recovery-grant:v1:";

/** 20 random bytes → 32 base32 characters in groups of four. */
export function formatRecoveryGrant(bytes: Uint8Array): string {
  if (bytes.length !== MFA_RECOVERY_GRANT_BYTES) throw new Error("Recovery grant entropy has the wrong length.");
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += MFA_RECOVERY_GRANT_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  return out.match(/.{1,4}/g)!.join("-");
}

/** Canonical form for hashing, or null when the input cannot be a grant. */
export function normaliseRecoveryGrant(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 80) return null;
  const compact = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (compact.length !== MFA_RECOVERY_GRANT_CHARS) return null;
  for (const ch of compact) {
    if (!MFA_RECOVERY_GRANT_ALPHABET.includes(ch)) return null;
  }
  return compact;
}

/** Recovery RPC denial reason → operator/target message. Unknown reasons use the fallback. */
export const MFA_RECOVERY_DENIAL_MESSAGES: Readonly<Record<string, string>> = {
  self_recovery_denied: "You cannot recover your own authenticator.",
  actor_not_recovery_authority: "Only a Super Owner who is not break-glass can start an authenticator recovery.",
  actor_in_recovery: "Your own account is in authenticator recovery, so you cannot act on another recovery.",
  target_not_privileged: "Recovery is only available for Super Owner, Super Admin and break-glass accounts.",
  reason_invalid: `Give a reason between ${MFA_RECOVERY_REASON_MIN} and ${MFA_RECOVERY_REASON_MAX} characters.`,
  active_request_exists: "This account already has a recovery in progress.",
  target_factor_ambiguous: "This account has more than one authenticator. Resolve that before recovery.",
  target_has_no_verified_factor: "This account has no verified authenticator to recover.",
  final_recovery_path_violation:
    "Recovery is blocked because it would leave the platform without enough usable Super Owners with an authenticator.",
  cooling_off_invalid: "The cooling-off period is not valid.",
  request_not_found: "That recovery request was not found.",
  request_expired: "That recovery request has expired.",
  request_not_pending: "That recovery request is no longer waiting for approval.",
  second_approval_not_applicable: "Super Admin recoveries do not take a second approval.",
  self_approval_denied: "You cannot approve a recovery you started, or one for your own account.",
  approver_not_distinct: "The second approval must come from a different Super Owner.",
  approval_session_not_distinct: "The second approval must come from a different sign-in session.",
  request_not_executable: "That recovery request cannot be run.",
  second_approval_required: "Break-glass recovery needs a second Super Owner approval first.",
  cooling_off_active: "The cooling-off period has not ended yet.",
  executor_not_request_authority: "Only the Super Owner who started or approved this recovery can run it.",
  approver_no_longer_qualified: "An approver no longer qualifies. Start a new recovery.",
  target_kind_changed: "The account's role changed after the request. Start a new recovery.",
  target_factor_changed: "The account's authenticator changed after the request. Start a new recovery.",
  grant_hash_invalid: "The recovery code could not be issued. Try again.",
  no_recovery_in_progress: "There is no authenticator recovery in progress for your account.",
  recovery_not_awaiting_enrolment: "This recovery is not waiting for a new authenticator.",
  grant_already_redeemed: "This recovery code has already been used.",
  grant_expired: "This recovery code has expired. Ask the Super Owner who ran the recovery for a new one.",
  grant_mismatch: "That recovery code is not correct. After five incorrect attempts the code stops working.",
  session_predates_recovery: "Sign out, sign in again with your password, then enter the code.",
  grant_not_redeemed: "Enter your recovery code first.",
  session_not_redeemed_session: "Finish recovery in the same sign-in where you entered the recovery code.",
  unexpected_factor_state:
    "Your authenticator state was not what recovery expected, so recovery has stopped. Ask a Super Owner to start a new recovery.",
  cannot_cancel_after_execution: "Recovery has already run and cannot be cancelled.",
  request_terminal: "That recovery request is already closed.",
  actor_cannot_cancel: "You cannot cancel this recovery.",
  session_missing: "Your sign-in session was not found. Sign in again.",
  session_user_mismatch: "Your sign-in session does not match your account. Sign in again.",
  session_expired: "Your sign-in session has expired. Sign in again.",
  aal_insufficient: "Verify with your authenticator app to continue.",
  fresh_mfa_missing: "Re-verify with your authenticator app to continue.",
  fresh_mfa_stale: "Re-verify with your authenticator app to continue.",
};

export const MFA_RECOVERY_DENIAL_FALLBACK = "The recovery action was refused.";

export function mfaRecoveryDenialMessage(reason: string | null | undefined): string {
  return (reason && MFA_RECOVERY_DENIAL_MESSAGES[reason]) || MFA_RECOVERY_DENIAL_FALLBACK;
}

export type MfaRecoveryRequestRow = {
  id: string;
  targetUserId: string;
  targetLabel: string;
  targetKind: MfaRecoveryTargetKind;
  status: MfaRecoveryStatus;
  reason: string;
  requestedBy: string;
  requestedByLabel: string;
  secondApprovedBy: string | null;
  secondApprovedByLabel: string | null;
  coolingOffUntil: string | null;
  expiresAt: string;
  executedAt: string | null;
  grantExpiresAt: string | null;
  grantRedeemedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  terminalReason: string | null;
};

export type MfaRecoveryCandidate = {
  userId: string;
  label: string;
  targetKind: MfaRecoveryTargetKind;
};

export type MfaRecoveryIssuedGrant = {
  requestId: string;
  targetUserId: string;
  /** Plaintext, shown once. Never persist, log or forward. */
  grant: string;
  grantExpiresAt: string;
  recoveryExpiresAt: string | null;
};

export type MfaRecoverySelfState = {
  locked: boolean;
  requestId: string | null;
  status: MfaRecoveryStatus | null;
  targetKind: MfaRecoveryTargetKind | null;
  executedAt: string | null;
  recoveryExpiresAt: string | null;
  grantExpiresAt: string | null;
  grantUsable: boolean;
  grantRedeemed: boolean;
  redeemedByThisSession: boolean;
  pendingRequests: Array<{
    requestId: string;
    status: MfaRecoveryStatus;
    targetKind: MfaRecoveryTargetKind;
    coolingOffUntil: string | null;
    expiresAt: string;
  }>;
};
