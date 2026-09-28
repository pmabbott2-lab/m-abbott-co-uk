/**
 * G7F-3B1 privileged MFA status + event reporting — client-callable server functions.
 * Neither function receives or returns TOTP secrets, QR payloads or codes.
 */
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  PrivilegedMfaStatus,
  RecordMfaEventResult,
} from "@/lib/privileged-mfa-account.server";

export type { PrivilegedMfaStatus, RecordMfaEventResult };

export const getMyPrivilegedMfaStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PrivilegedMfaStatus> => {
    const userId = (context as { userId?: string } | undefined)?.userId;
    if (!userId) throw new Error("Not authenticated");
    const { resolvePrivilegedMfaStatus } = await import("@/lib/privileged-mfa-account.server");
    return resolvePrivilegedMfaStatus({ userId });
  });

const recordEventInput = z.object({
  event: z.enum(["enrolled", "verified", "challenge_failed"]),
  factorId: z.string().uuid().optional(),
});

export const recordMyPrivilegedMfaEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => recordEventInput.parse(data))
  .handler(async ({ context, data }): Promise<RecordMfaEventResult> => {
    const userId = (context as { userId?: string } | undefined)?.userId;
    if (!userId) throw new Error("Not authenticated");
    const { recordPrivilegedMfaEventImpl } = await import("@/lib/privileged-mfa-account.server");
    return recordPrivilegedMfaEventImpl({
      userId,
      event: data.event,
      factorId: data.factorId ?? null,
    });
  });
