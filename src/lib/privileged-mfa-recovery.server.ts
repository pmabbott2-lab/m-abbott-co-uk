/**
 * G7F-3C3 privileged MFA recovery — server implementation (server only).
 *
 * Authority, actor invariants, final-path, cooling-off, locking and audit are decided inside the
 * service_role recovery RPCs from Auth state (authoritative, transactional). This module adds the
 * mode-independent fresh-TOTP gate from getClaims-verified context, generates the one-time grant
 * and sends only its SHA-256 digest to the database.
 *
 * The plaintext grant is returned once to the executing operator. It is never logged, audited,
 * notified or persisted, and grant_hash is never read back.
 */
import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin, supabaseAdminUntyped as db } from "@/integrations/supabase/client.server";
import {
  MFA_RECOVERY_ACTIVE_STATUSES,
  MFA_RECOVERY_GRANT_BYTES,
  MFA_RECOVERY_GRANT_HASH_PREFIX,
  MFA_RECOVERY_TARGET_KINDS,
  formatRecoveryGrant,
  mfaRecoveryDenialMessage,
  normaliseRecoveryGrant,
  resolveMfaRecoveryCoolingOffMinutes,
  type MfaRecoveryCandidate,
  type MfaRecoveryIssuedGrant,
  type MfaRecoveryRequestRow,
  type MfaRecoverySelfState,
  type MfaRecoveryStatus,
  type MfaRecoveryTargetKind,
} from "@/lib/privileged-mfa-recovery";
import {
  PRIVILEGED_FRESH_AUTH_MAX_AGE_SEC,
  PRIVILEGED_MFA_ACTIONS,
  type PrivilegedMfaAction,
} from "@/lib/privileged-mfa";
import {
  evaluateFreshPrivilegedAuthForRequest,
  getPrivilegedMfaMode,
  PrivilegedMfaRequiredError,
  requireRecoveryFreshAuth,
  requireVerifiedAuthClaims,
  type AuthAssuranceInput,
} from "@/lib/privileged-mfa.server";
import { requireSuperOwner } from "@/lib/platform-authority.server";

export class MfaRecoveryDeniedError extends Error {
  readonly code = "MFA_RECOVERY_DENIED" as const;
  readonly reason: string | null;
  constructor(reason: string | null) {
    super(mfaRecoveryDenialMessage(reason));
    this.name = "MfaRecoveryDeniedError";
    this.reason = reason;
  }
}

const UNAVAILABLE = "The recovery service is unavailable. Try again.";

/** 160-bit grant (plaintext for the operator) and its storage digest. */
export function generateRecoveryGrant(): { grant: string; hash: string } {
  const grant = formatRecoveryGrant(new Uint8Array(randomBytes(MFA_RECOVERY_GRANT_BYTES)));
  const hash = hashRecoveryGrant(grant);
  if (!hash) throw new Error(UNAVAILABLE);
  return { grant, hash };
}

export function hashRecoveryGrant(input: unknown): string | null {
  const canonical = normaliseRecoveryGrant(input);
  if (!canonical) return null;
  return createHash("sha256").update(MFA_RECOVERY_GRANT_HASH_PREFIX + canonical, "utf8").digest("hex");
}

export function mfaRecoveryCoolingOffMinutes(): Promise<number> {
  return import("@/lib/app-environment.server").then(({ getAppEnvironment }) =>
    resolveMfaRecoveryCoolingOffMinutes({
      appEnv: getAppEnvironment(),
      raw: process.env.MFA_RECOVERY_COOLING_OFF_MINUTES,
    }),
  );
}

type RpcPayload = Record<string, unknown> & { ok?: boolean; reason?: string };

async function callRecoveryRpc(name: string, args: Record<string, unknown>): Promise<RpcPayload> {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    console.error("mfa_recovery_rpc_failed", name, error.code ?? "unknown");
    throw new Error(UNAVAILABLE);
  }
  const payload = (data ?? {}) as RpcPayload;
  if (payload.ok !== true) throw new MfaRecoveryDeniedError(typeof payload.reason === "string" ? payload.reason : null);
  return payload;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function asKind(value: unknown): MfaRecoveryTargetKind | null {
  return (MFA_RECOVERY_TARGET_KINDS as readonly unknown[]).includes(value) ? (value as MfaRecoveryTargetKind) : null;
}

// ---------------------------------------------------------------------------------------------
// Notifications: hooks only. Email transport follows the G6A capture/block model. No SMS path,
// never the grant. Outcome is audited separately and never affects the recovery transaction.
// ---------------------------------------------------------------------------------------------
export type MfaRecoveryNotificationTransition = "requested" | "approved" | "executed" | "completed" | "cancelled";

async function privilegedRecipientCount(targetUserId: string): Promise<number> {
  const { data, error } = await db.from("platform_roles").select("user_id");
  if (error) return 1;
  return new Set([targetUserId, ...(data ?? []).map((r: { user_id: string }) => r.user_id)]).size;
}

export async function notifyMfaRecoveryTransition(input: {
  transition: MfaRecoveryNotificationTransition;
  requestId: string;
  targetUserId: string;
  actorUserId: string;
}): Promise<void> {
  try {
    const { resolveExternalAction, captureExternalAction } = await import("@/lib/external-action.server");
    const recipients = await privilegedRecipientCount(input.targetUserId);
    const decision = resolveExternalAction({ service: "email", action: "send" });
    let outcome: "captured" | "suppressed" | "no_transport";
    if (decision.mode === "capture") {
      captureExternalAction({
        service: "email",
        action: "send",
        meta: { kind: `mfa_recovery_${input.transition}`, request_id: input.requestId, recipient_count: recipients },
      });
      outcome = "captured";
    } else if (decision.mode === "disabled") {
      outcome = "suppressed";
    } else {
      outcome = "no_transport";
    }
    const { writePlatformAuditEvent } = await import("@/lib/platform-audit.server");
    await writePlatformAuditEvent({
      eventType: "MFA_RECOVERY_NOTIFICATION_RECORDED",
      actingUserId: input.actorUserId,
      subjectUserId: input.targetUserId,
      metadata: {
        source: "g7f3c3_mfa_recovery",
        transition: input.transition,
        request_id: input.requestId,
        outcome,
        delivery_mode: decision.mode,
        channel: "email",
        recipient_count: recipients,
      },
    });
  } catch {
    /* notification outcome never rolls back or blocks the recovery transition */
  }
}

// ---------------------------------------------------------------------------------------------
// Operator actions (fresh TOTP ≤ 5 min, every mode)
// ---------------------------------------------------------------------------------------------
async function operatorFreshAuth(auth: AuthAssuranceInput, action: PrivilegedMfaAction, userId: string, targetUserId?: string | null) {
  return requireRecoveryFreshAuth(auth, { action, userId, targetUserId: targetUserId ?? null });
}

export async function requestMfaRecoveryImpl(input: {
  userId: string;
  targetUserId: string;
  reason: string;
  auth?: AuthAssuranceInput;
}): Promise<{ requestId: string; targetKind: MfaRecoveryTargetKind | null; coolingOffUntil: string | null; expiresAt: string | null; requiresSecondApproval: boolean }> {
  const ctx = await operatorFreshAuth(input.auth, PRIVILEGED_MFA_ACTIONS.mfaRecoveryRequest, input.userId, input.targetUserId);
  const res = await callRecoveryRpc("request_platform_mfa_recovery", {
    p_actor_user_id: input.userId,
    p_actor_session_id: ctx.sessionId,
    p_target_user_id: input.targetUserId,
    p_reason: input.reason,
    p_cooling_off_minutes: await mfaRecoveryCoolingOffMinutes(),
    p_mode: getPrivilegedMfaMode(),
  });
  const requestId = String(res.request_id);
  await notifyMfaRecoveryTransition({ transition: "requested", requestId, targetUserId: input.targetUserId, actorUserId: input.userId });
  return {
    requestId,
    targetKind: asKind(res.target_kind),
    coolingOffUntil: str(res.cooling_off_until),
    expiresAt: str(res.expires_at),
    requiresSecondApproval: res.requires_second_approval === true,
  };
}

async function loadTargetUserId(requestId: string): Promise<string | null> {
  const { data } = await db.from("platform_mfa_recovery_requests").select("target_user_id").eq("id", requestId).maybeSingle();
  return (data?.target_user_id as string | undefined) ?? null;
}

export async function approveMfaRecoveryImpl(input: { userId: string; requestId: string; auth?: AuthAssuranceInput }) {
  const ctx = await operatorFreshAuth(input.auth, PRIVILEGED_MFA_ACTIONS.mfaRecoveryApprove, input.userId);
  const res = await callRecoveryRpc("approve_platform_mfa_recovery", {
    p_actor_user_id: input.userId,
    p_actor_session_id: ctx.sessionId,
    p_request_id: input.requestId,
    p_mode: getPrivilegedMfaMode(),
  });
  const targetUserId = await loadTargetUserId(input.requestId);
  if (targetUserId) {
    await notifyMfaRecoveryTransition({ transition: "approved", requestId: input.requestId, targetUserId, actorUserId: input.userId });
  }
  return { requestId: input.requestId, status: String(res.status) as MfaRecoveryStatus };
}

export async function executeMfaRecoveryImpl(input: {
  userId: string;
  requestId: string;
  auth?: AuthAssuranceInput;
}): Promise<MfaRecoveryIssuedGrant> {
  const ctx = await operatorFreshAuth(input.auth, PRIVILEGED_MFA_ACTIONS.mfaRecoveryExecute, input.userId);
  const { grant, hash } = generateRecoveryGrant();
  const res = await callRecoveryRpc("execute_platform_mfa_recovery", {
    p_actor_user_id: input.userId,
    p_actor_session_id: ctx.sessionId,
    p_request_id: input.requestId,
    p_grant_hash: hash,
    p_mode: getPrivilegedMfaMode(),
  });
  const targetUserId = String(res.target_user_id);
  await notifyMfaRecoveryTransition({ transition: "executed", requestId: input.requestId, targetUserId, actorUserId: input.userId });
  return {
    requestId: input.requestId,
    targetUserId,
    grant,
    grantExpiresAt: String(res.grant_expires_at),
    recoveryExpiresAt: str(res.recovery_expires_at),
  };
}

export async function reissueMfaRecoveryGrantImpl(input: {
  userId: string;
  requestId: string;
  auth?: AuthAssuranceInput;
}): Promise<MfaRecoveryIssuedGrant> {
  const ctx = await operatorFreshAuth(input.auth, PRIVILEGED_MFA_ACTIONS.mfaRecoveryReissue, input.userId);
  const { grant, hash } = generateRecoveryGrant();
  const res = await callRecoveryRpc("reissue_platform_mfa_recovery_grant", {
    p_actor_user_id: input.userId,
    p_actor_session_id: ctx.sessionId,
    p_request_id: input.requestId,
    p_grant_hash: hash,
    p_mode: getPrivilegedMfaMode(),
  });
  return {
    requestId: input.requestId,
    targetUserId: String(res.target_user_id),
    grant,
    grantExpiresAt: String(res.grant_expires_at),
    recoveryExpiresAt: str(res.recovery_expires_at),
  };
}

export async function cancelMfaRecoveryImpl(input: {
  userId: string;
  requestId: string;
  reason?: string | null;
  auth?: AuthAssuranceInput;
}) {
  const ctx = await operatorFreshAuth(input.auth, PRIVILEGED_MFA_ACTIONS.mfaRecoveryCancel, input.userId);
  await callRecoveryRpc("cancel_platform_mfa_recovery", {
    p_actor_user_id: input.userId,
    p_actor_session_id: ctx.sessionId,
    p_request_id: input.requestId,
    p_reason: input.reason ?? null,
    p_mode: getPrivilegedMfaMode(),
  });
  const targetUserId = await loadTargetUserId(input.requestId);
  if (targetUserId) {
    await notifyMfaRecoveryTransition({ transition: "cancelled", requestId: input.requestId, targetUserId, actorUserId: input.userId });
  }
  return { requestId: input.requestId, status: "cancelled" as const };
}

// ---------------------------------------------------------------------------------------------
// Operator views (Super Owner, incl. break-glass which may approve normal-SO recoveries)
// ---------------------------------------------------------------------------------------------
async function labelsFor(userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const { data } = await db.from("profiles").select("id, email").in("id", ids);
  for (const row of (data ?? []) as Array<{ id: string; email: string | null }>) {
    if (row.email) out.set(row.id, String(row.email).toLowerCase());
  }
  for (const id of ids) {
    if (out.has(id)) continue;
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(id);
    out.set(id, u.user?.email?.toLowerCase() ?? "Unknown account");
  }
  return out;
}

const REQUEST_COLUMNS =
  "id, target_user_id, target_kind, status, reason, requested_by, second_approved_by, cooling_off_until, expires_at, executed_at, grant_expires_at, grant_redeemed_at, completed_at, created_at, terminal_reason";

type RequestDbRow = {
  id: string;
  target_user_id: string;
  target_kind: MfaRecoveryTargetKind;
  status: MfaRecoveryStatus;
  reason: string;
  requested_by: string;
  second_approved_by: string | null;
  cooling_off_until: string | null;
  expires_at: string;
  executed_at: string | null;
  grant_expires_at: string | null;
  grant_redeemed_at: string | null;
  completed_at: string | null;
  created_at: string;
  terminal_reason: string | null;
};

export async function listMfaRecoveryRequestsImpl(input: { userId: string }): Promise<MfaRecoveryRequestRow[]> {
  await requireSuperOwner(input.userId);
  await db.rpc("expire_platform_mfa_recovery_requests", { p_mode: getPrivilegedMfaMode() });
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("platform_mfa_recovery_requests")
    .select(REQUEST_COLUMNS)
    .or(`status.in.(${MFA_RECOVERY_ACTIVE_STATUSES.join(",")}),created_at.gte.${since}`)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(UNAVAILABLE);
  const rows = (data ?? []) as RequestDbRow[];
  const labels = await labelsFor(rows.flatMap((r) => [r.target_user_id, r.requested_by, r.second_approved_by ?? ""]));
  return rows.map((r) => ({
    id: r.id,
    targetUserId: r.target_user_id,
    targetLabel: labels.get(r.target_user_id) ?? "Unknown account",
    targetKind: r.target_kind,
    status: r.status,
    reason: r.reason,
    requestedBy: r.requested_by,
    requestedByLabel: labels.get(r.requested_by) ?? "Unknown account",
    secondApprovedBy: r.second_approved_by,
    secondApprovedByLabel: r.second_approved_by ? (labels.get(r.second_approved_by) ?? "Unknown account") : null,
    coolingOffUntil: r.cooling_off_until,
    expiresAt: r.expires_at,
    executedAt: r.executed_at,
    grantExpiresAt: r.grant_expires_at,
    grantRedeemedAt: r.grant_redeemed_at,
    completedAt: r.completed_at,
    createdAt: r.created_at,
    terminalReason: r.terminal_reason,
  }));
}

export async function listMfaRecoveryCandidatesImpl(input: { userId: string }): Promise<MfaRecoveryCandidate[]> {
  await requireSuperOwner(input.userId);
  const { data, error } = await db.from("platform_roles").select("user_id, role");
  if (error) throw new Error(UNAVAILABLE);
  const byUser = new Map<string, Set<string>>();
  for (const row of (data ?? []) as Array<{ user_id: string; role: string }>) {
    if (row.user_id === input.userId) continue;
    const set = byUser.get(row.user_id) ?? new Set<string>();
    set.add(row.role);
    byUser.set(row.user_id, set);
  }
  const labels = await labelsFor([...byUser.keys()]);
  const out: MfaRecoveryCandidate[] = [];
  for (const [userId, roles] of byUser) {
    let targetKind: MfaRecoveryTargetKind;
    if (roles.has("super_owner")) {
      const { data: bg } = await db.rpc("is_active_break_glass", { p_user_id: userId });
      targetKind = bg === true ? "break_glass" : "normal_so";
    } else if (roles.has("super_admin")) {
      targetKind = "super_admin";
    } else {
      continue;
    }
    out.push({ userId, label: labels.get(userId) ?? "Unknown account", targetKind });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------------------------
// Target (own recovery only). Reachable while locked; never exposes other platform data.
// ---------------------------------------------------------------------------------------------
function mapSelfState(raw: Record<string, unknown>): MfaRecoverySelfState {
  const pending = Array.isArray(raw.pending_requests) ? (raw.pending_requests as Array<Record<string, unknown>>) : [];
  return {
    locked: raw.locked === true,
    requestId: str(raw.request_id),
    status: (str(raw.status) as MfaRecoveryStatus | null) ?? null,
    targetKind: asKind(raw.target_kind),
    executedAt: str(raw.executed_at),
    recoveryExpiresAt: str(raw.recovery_expires_at),
    grantExpiresAt: str(raw.grant_expires_at),
    grantUsable: raw.grant_usable === true,
    grantRedeemed: raw.grant_redeemed === true,
    redeemedByThisSession: raw.redeemed_by_this_session === true,
    pendingRequests: pending.map((p) => ({
      requestId: String(p.request_id),
      status: String(p.status) as MfaRecoveryStatus,
      targetKind: asKind(p.target_kind) ?? "normal_so",
      coolingOffUntil: str(p.cooling_off_until),
      expiresAt: String(p.expires_at),
    })),
  };
}

export async function getMyMfaRecoveryStateImpl(input: { userId: string; auth?: AuthAssuranceInput }): Promise<MfaRecoverySelfState> {
  const ctx = requireVerifiedAuthClaims(input.auth);
  if (ctx.userId !== input.userId) throw new PrivilegedMfaRequiredError("PRIVILEGED_AAL_REQUIRED", "user_mismatch");
  const { data, error } = await db.rpc("get_platform_mfa_recovery_self_state", {
    p_user_id: input.userId,
    p_session_id: ctx.sessionId,
  });
  if (error) throw new Error(UNAVAILABLE);
  return mapSelfState((data ?? {}) as Record<string, unknown>);
}

export async function redeemMyMfaRecoveryGrantImpl(input: {
  userId: string;
  grant: string;
  auth?: AuthAssuranceInput;
}): Promise<{ requestId: string }> {
  const ctx = requireVerifiedAuthClaims(input.auth);
  if (ctx.userId !== input.userId || !ctx.sessionId) {
    throw new PrivilegedMfaRequiredError("PRIVILEGED_AAL_REQUIRED", "user_mismatch");
  }
  const res = await callRecoveryRpc("redeem_platform_mfa_recovery_grant", {
    p_user_id: input.userId,
    p_session_id: ctx.sessionId,
    p_grant_hash: hashRecoveryGrant(input.grant),
    p_mode: getPrivilegedMfaMode(),
  });
  return { requestId: String(res.request_id) };
}

export async function completeMyMfaRecoveryImpl(input: {
  userId: string;
  auth?: AuthAssuranceInput;
}): Promise<{ requestId: string }> {
  const evaluation = evaluateFreshPrivilegedAuthForRequest(input.auth, {
    maxAgeSec: PRIVILEGED_FRESH_AUTH_MAX_AGE_SEC.mfaRecovery,
    userId: input.userId,
  });
  if (!evaluation.satisfied) {
    throw new PrivilegedMfaRequiredError(
      evaluation.reason === "aal_insufficient" ? "PRIVILEGED_AAL_REQUIRED" : "PRIVILEGED_REAUTH_REQUIRED",
      evaluation.reason,
    );
  }
  const ctx = requireVerifiedAuthClaims(input.auth);
  const res = await callRecoveryRpc("complete_platform_mfa_recovery", {
    p_user_id: input.userId,
    p_session_id: ctx.sessionId,
    p_mode: getPrivilegedMfaMode(),
  });
  const requestId = String(res.request_id);
  await notifyMfaRecoveryTransition({ transition: "completed", requestId, targetUserId: input.userId, actorUserId: input.userId });
  return { requestId };
}
