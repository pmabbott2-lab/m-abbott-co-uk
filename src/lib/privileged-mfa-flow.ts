/**
 * G7F-3B1 privileged TOTP enrolment / challenge / step-up flow (pure; MFA API injected).
 *
 * Uses the Supabase auth-js MFA API (supabase.auth.mfa) only. TOTP secrets live in
 * Supabase Auth; nothing here persists, logs or returns the secret beyond the single
 * enrolment response handed to the caller for display.
 *
 * Assurance rule: enroll() and verify() returning never unlock anything on their own.
 * Continuation requires confirmPrivilegedAal2(): client currentLevel === "aal2", the
 * factor listed as verified, and (when supplied) the server's verified-claims aal === "aal2".
 *
 * Abandoned enrolment: an unverified TOTP factor never counts as configured. Starting
 * setup again removes the user's own UNVERIFIED TOTP factors before enrolling a new one,
 * so at most one pending factor exists. Verified factors are never removed here, and
 * setup is refused (already_configured) while any verified TOTP factor exists.
 */
import { classifyPrivilegedMfaError, type PrivilegedMfaErrorCode } from "@/lib/privileged-mfa";

export const PRIVILEGED_TOTP_FRIENDLY_NAME = "Mortgage Hub platform";
export const TOTP_CODE_PATTERN = /^\d{6}$/;

type MfaApiError = { message?: string } | null | undefined;
type MfaApiResult<T> = { data: T | null; error: MfaApiError };

export type MfaFactorLike = {
  id: string;
  factor_type: string;
  status: string;
  friendly_name?: string | null;
  created_at?: string;
  updated_at?: string;
};

/** Structural subset of supabase.auth.mfa used by the privileged flow. */
export interface PrivilegedMfaApi {
  listFactors(): Promise<MfaApiResult<{ all: MfaFactorLike[] }>>;
  enroll(params: {
    factorType: "totp";
    friendlyName?: string;
  }): Promise<MfaApiResult<{ id: string; totp: { qr_code: string; secret: string; uri: string } }>>;
  challenge(params: { factorId: string }): Promise<MfaApiResult<{ id: string }>>;
  verify(params: { factorId: string; challengeId: string; code: string }): Promise<MfaApiResult<unknown>>;
  unenroll(params: { factorId: string }): Promise<MfaApiResult<unknown>>;
  getAuthenticatorAssuranceLevel(): Promise<
    MfaApiResult<{ currentLevel: string | null; nextLevel: string | null }>
  >;
}

export type TotpFactorSummary = {
  id: string;
  friendlyName: string | null;
  createdAt: string | null;
};

export type TotpFactorState = {
  verified: TotpFactorSummary[];
  unverified: TotpFactorSummary[];
};

function errorMessage(error: MfaApiError, fallback: string): string {
  return error?.message?.trim() || fallback;
}

function toSummary(f: MfaFactorLike): TotpFactorSummary {
  return { id: f.id, friendlyName: f.friendly_name?.trim() || null, createdAt: f.created_at ?? null };
}

/** Reads `.all` (the `.totp` list omits unverified factors) and splits TOTP factors by status. */
export function summariseTotpFactors(all: readonly MfaFactorLike[] | null | undefined): TotpFactorState {
  const verified: TotpFactorSummary[] = [];
  const unverified: TotpFactorSummary[] = [];
  for (const f of all ?? []) {
    if (!f || f.factor_type !== "totp" || typeof f.id !== "string") continue;
    if (f.status === "verified") verified.push(toSummary(f));
    else if (f.status === "unverified") unverified.push(toSummary(f));
  }
  return { verified, unverified };
}

export type LoadFactorsResult = ({ ok: true } & TotpFactorState) | { ok: false; message: string };

export async function loadTotpFactors(api: PrivilegedMfaApi): Promise<LoadFactorsResult> {
  const { data, error } = await api.listFactors();
  if (error || !data) return { ok: false, message: errorMessage(error, "Could not load authenticator factors.") };
  return { ok: true, ...summariseTotpFactors(data.all) };
}

export const PRIVILEGED_MFA_SETUP_PATH = "/platform/security";

/** Only same-origin /platform paths (never the setup page itself) are accepted as continuation targets. */
export function safePlatformRedirect(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!/^\/platform(\/[A-Za-z0-9._~\-/$]*)?$/.test(value)) return null;
  if (value.includes("//") || value.includes("..")) return null;
  if (value === PRIVILEGED_MFA_SETUP_PATH || value.startsWith(`${PRIVILEGED_MFA_SETUP_PATH}/`)) return null;
  return value;
}

export type PrivilegedMfaStep = "not_required" | "setup" | "challenge" | "satisfied";

/**
 * Next step for a signed-in (AAL1+) user. `required` comes from the server (platform_roles /
 * BG registry). Unverified factors never count; `currentLevel` alone is only a UI hint —
 * continuation still goes through confirmPrivilegedAal2.
 */
export function decidePrivilegedMfaStep(input: {
  required: boolean;
  verifiedFactorCount: number;
  currentLevel: string | null | undefined;
}): PrivilegedMfaStep {
  if (!input.required) return "not_required";
  if (input.verifiedFactorCount <= 0) return "setup";
  return input.currentLevel === "aal2" ? "satisfied" : "challenge";
}

export type StartEnrolmentResult =
  | {
      kind: "enrolment_pending";
      factorId: string;
      qrCode: string;
      secret: string;
      uri: string;
      removedStaleFactorIds: string[];
    }
  | { kind: "already_configured"; verified: TotpFactorSummary[] }
  | { kind: "error"; message: string };

/** Explicit user action only. Never called automatically on page load. */
export async function startTotpEnrolment(
  api: PrivilegedMfaApi,
  opts?: { friendlyName?: string },
): Promise<StartEnrolmentResult> {
  const factors = await loadTotpFactors(api);
  if (!factors.ok) return { kind: "error", message: factors.message };
  if (factors.verified.length > 0) return { kind: "already_configured", verified: factors.verified };

  const removedStaleFactorIds: string[] = [];
  for (const stale of factors.unverified) {
    const { error } = await api.unenroll({ factorId: stale.id });
    if (error) {
      return { kind: "error", message: errorMessage(error, "Could not reset the unfinished authenticator setup.") };
    }
    removedStaleFactorIds.push(stale.id);
  }

  const { data, error } = await api.enroll({
    factorType: "totp",
    friendlyName: opts?.friendlyName ?? PRIVILEGED_TOTP_FRIENDLY_NAME,
  });
  if (error || !data?.id || !data.totp?.qr_code || !data.totp?.secret) {
    return { kind: "error", message: errorMessage(error, "Could not start authenticator setup.") };
  }
  return {
    kind: "enrolment_pending",
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
    uri: data.totp.uri,
    removedStaleFactorIds,
  };
}

/** Image src for the enrolment QR (raw SVG or SVG data URI); rendered via <img>, never as HTML. */
export function totpQrImageSrc(qrCode: string): string | null {
  const value = qrCode.trim();
  if (value.startsWith("<svg")) return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(value)}`;
  if (!value.startsWith("data:image/svg+xml")) return null;
  const comma = value.indexOf(",");
  if (comma < 0) return null;
  const header = value.slice(0, comma);
  const payload = value.slice(comma + 1);
  if (header.endsWith(";base64")) return value;
  let svg = payload;
  if (!svg.startsWith("<")) {
    try {
      svg = decodeURIComponent(payload);
    } catch {
      return null;
    }
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export type VerifyCodeResult =
  | { ok: true }
  | { ok: false; stage: "format" | "challenge" | "verify"; message: string };

export async function verifyTotpCode(
  api: PrivilegedMfaApi,
  input: { factorId: string; code: string; challengeId?: string | null },
): Promise<VerifyCodeResult> {
  const code = input.code.replace(/\s+/g, "");
  if (!TOTP_CODE_PATTERN.test(code)) {
    return { ok: false, stage: "format", message: "Enter the 6-digit code from your authenticator app." };
  }
  let challengeId = input.challengeId ?? null;
  if (!challengeId) {
    const challenge = await api.challenge({ factorId: input.factorId });
    if (challenge.error || !challenge.data?.id) {
      return { ok: false, stage: "challenge", message: errorMessage(challenge.error, "Could not start verification.") };
    }
    challengeId = challenge.data.id;
  }
  const { error } = await api.verify({ factorId: input.factorId, challengeId, code });
  if (error) return { ok: false, stage: "verify", message: errorMessage(error, "That code was not accepted.") };
  return { ok: true };
}

export type ServerAssurance = { claimsVerified: boolean; aal: string | null };

export type Aal2ConfirmationResult =
  | { confirmed: true }
  | {
      confirmed: false;
      reason: "client_aal_not_aal2" | "factor_not_verified" | "server_aal_not_aal2" | "lookup_failed";
      message: string;
    };

const AAL2_UNCONFIRMED_MESSAGE =
  "Your code was accepted but the stronger sign-in could not be confirmed. Please try again.";

/** Never inferred from verify() success. */
export async function confirmPrivilegedAal2(
  api: PrivilegedMfaApi,
  input: { factorId: string; serverConfirm?: () => Promise<ServerAssurance> },
): Promise<Aal2ConfirmationResult> {
  const aal = await api.getAuthenticatorAssuranceLevel();
  if (aal.error || !aal.data) return { confirmed: false, reason: "lookup_failed", message: AAL2_UNCONFIRMED_MESSAGE };
  if (aal.data.currentLevel !== "aal2") {
    return { confirmed: false, reason: "client_aal_not_aal2", message: AAL2_UNCONFIRMED_MESSAGE };
  }
  const factors = await loadTotpFactors(api);
  if (!factors.ok) return { confirmed: false, reason: "lookup_failed", message: AAL2_UNCONFIRMED_MESSAGE };
  if (!factors.verified.some((f) => f.id === input.factorId)) {
    return { confirmed: false, reason: "factor_not_verified", message: AAL2_UNCONFIRMED_MESSAGE };
  }
  if (input.serverConfirm) {
    let server: ServerAssurance;
    try {
      server = await input.serverConfirm();
    } catch {
      return { confirmed: false, reason: "lookup_failed", message: AAL2_UNCONFIRMED_MESSAGE };
    }
    if (server.claimsVerified !== true || server.aal !== "aal2") {
      return { confirmed: false, reason: "server_aal_not_aal2", message: AAL2_UNCONFIRMED_MESSAGE };
    }
  }
  return { confirmed: true };
}

export type CompleteFlowResult =
  | { status: "verified_aal2"; factorId: string }
  | { status: "failed"; stage: "format" | "challenge" | "verify" | "aal2" | "factor"; message: string };

export async function completeTotpEnrolment(
  api: PrivilegedMfaApi,
  input: { factorId: string; code: string; serverConfirm?: () => Promise<ServerAssurance> },
): Promise<CompleteFlowResult> {
  const verified = await verifyTotpCode(api, { factorId: input.factorId, code: input.code });
  if (!verified.ok) return { status: "failed", stage: verified.stage, message: verified.message };
  const confirmed = await confirmPrivilegedAal2(api, input);
  if (!confirmed.confirmed) return { status: "failed", stage: "aal2", message: confirmed.message };
  return { status: "verified_aal2", factorId: input.factorId };
}

/** Challenge an existing VERIFIED factor. Never enrols. */
export async function completeTotpChallenge(
  api: PrivilegedMfaApi,
  input: {
    code: string;
    factorId?: string | null;
    challengeId?: string | null;
    serverConfirm?: () => Promise<ServerAssurance>;
  },
): Promise<CompleteFlowResult> {
  const factors = await loadTotpFactors(api);
  if (!factors.ok) return { status: "failed", stage: "factor", message: factors.message };
  const factor = input.factorId
    ? factors.verified.find((f) => f.id === input.factorId)
    : factors.verified[0];
  if (!factor) {
    return { status: "failed", stage: "factor", message: "No verified authenticator app is set up for this account." };
  }
  const verified = await verifyTotpCode(api, {
    factorId: factor.id,
    code: input.code,
    challengeId: input.factorId ? input.challengeId : null,
  });
  if (!verified.ok) return { status: "failed", stage: verified.stage, message: verified.message };
  const confirmed = await confirmPrivilegedAal2(api, { factorId: factor.id, serverConfirm: input.serverConfirm });
  if (!confirmed.confirmed) return { status: "failed", stage: "aal2", message: confirmed.message };
  return { status: "verified_aal2", factorId: factor.id };
}

export type RequestStepUp = (code: PrivilegedMfaErrorCode) => Promise<boolean>;

/**
 * Runs a privileged server call. If the server refuses it with a privileged MFA denial
 * (the mutation was rejected before executing), ask for step-up; on success retry exactly
 * once. A cancelled / failed step-up rethrows the original denial. A second denial after
 * step-up propagates without another prompt, so there is never a loop or duplicate run.
 */
export async function runWithPrivilegedStepUp<T>(
  operation: () => Promise<T>,
  requestStepUp: RequestStepUp,
): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    const code = classifyPrivilegedMfaError(err);
    if (!code) throw err;
    const ok = await requestStepUp(code);
    if (!ok) throw err;
    return operation();
  }
}

/** Shares one pending step-up between concurrent denials. */
export function createStepUpCoordinator(prompt: RequestStepUp): RequestStepUp {
  let inFlight: Promise<boolean> | null = null;
  return (code) => {
    if (inFlight) return inFlight;
    const pending = prompt(code).finally(() => {
      inFlight = null;
    });
    inFlight = pending;
    return pending;
  };
}
