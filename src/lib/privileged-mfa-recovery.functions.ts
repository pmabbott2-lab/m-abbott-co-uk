/**
 * G7F-3C3 privileged MFA recovery — client-callable server functions.
 * Operator actions require fresh TOTP in every PRIVILEGED_MFA_MODE. Target functions only ever
 * act on the caller's own recovery. The plaintext grant is returned only by execute / reissue.
 */
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  MFA_RECOVERY_REASON_MAX,
  MFA_RECOVERY_REASON_MIN,
  type MfaRecoveryCandidate,
  type MfaRecoveryIssuedGrant,
  type MfaRecoveryRequestRow,
  type MfaRecoverySelfState,
} from "@/lib/privileged-mfa-recovery";

function requireUserId(context: unknown): string {
  const userId = (context as { userId?: string } | undefined)?.userId;
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

const requestIdInput = z.object({ requestId: z.string().uuid() });

export const listMfaRecoveryRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MfaRecoveryRequestRow[]> => {
    const { listMfaRecoveryRequestsImpl } = await import("@/lib/privileged-mfa-recovery.server");
    return listMfaRecoveryRequestsImpl({ userId: requireUserId(context) });
  });

export const listMfaRecoveryCandidates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MfaRecoveryCandidate[]> => {
    const { listMfaRecoveryCandidatesImpl } = await import("@/lib/privileged-mfa-recovery.server");
    return listMfaRecoveryCandidatesImpl({ userId: requireUserId(context) });
  });

export const requestMfaRecovery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        targetUserId: z.string().uuid(),
        reason: z.string().trim().min(MFA_RECOVERY_REASON_MIN).max(MFA_RECOVERY_REASON_MAX),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { requestMfaRecoveryImpl } = await import("@/lib/privileged-mfa-recovery.server");
    return requestMfaRecoveryImpl({ userId: requireUserId(context), ...data });
  });

export const approveMfaRecovery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => requestIdInput.parse(d))
  .handler(async ({ context, data }) => {
    const { approveMfaRecoveryImpl } = await import("@/lib/privileged-mfa-recovery.server");
    return approveMfaRecoveryImpl({ userId: requireUserId(context), requestId: data.requestId });
  });

export const executeMfaRecovery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => requestIdInput.parse(d))
  .handler(async ({ context, data }): Promise<MfaRecoveryIssuedGrant> => {
    const { executeMfaRecoveryImpl } = await import("@/lib/privileged-mfa-recovery.server");
    return executeMfaRecoveryImpl({ userId: requireUserId(context), requestId: data.requestId });
  });

export const reissueMfaRecoveryGrant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => requestIdInput.parse(d))
  .handler(async ({ context, data }): Promise<MfaRecoveryIssuedGrant> => {
    const { reissueMfaRecoveryGrantImpl } = await import("@/lib/privileged-mfa-recovery.server");
    return reissueMfaRecoveryGrantImpl({ userId: requireUserId(context), requestId: data.requestId });
  });

export const cancelMfaRecovery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ requestId: z.string().uuid(), reason: z.string().trim().max(MFA_RECOVERY_REASON_MAX).optional() })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { cancelMfaRecoveryImpl } = await import("@/lib/privileged-mfa-recovery.server");
    return cancelMfaRecoveryImpl({ userId: requireUserId(context), requestId: data.requestId, reason: data.reason ?? null });
  });

export const getMyMfaRecoveryState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MfaRecoverySelfState> => {
    const { getMyMfaRecoveryStateImpl } = await import("@/lib/privileged-mfa-recovery.server");
    return getMyMfaRecoveryStateImpl({ userId: requireUserId(context) });
  });

export const redeemMyMfaRecoveryGrant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ grant: z.string().min(1).max(80) }).parse(d))
  .handler(async ({ context, data }) => {
    const { redeemMyMfaRecoveryGrantImpl } = await import("@/lib/privileged-mfa-recovery.server");
    return redeemMyMfaRecoveryGrantImpl({ userId: requireUserId(context), grant: data.grant });
  });

export const completeMyMfaRecovery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { completeMyMfaRecoveryImpl } = await import("@/lib/privileged-mfa-recovery.server");
    return completeMyMfaRecoveryImpl({ userId: requireUserId(context) });
  });
