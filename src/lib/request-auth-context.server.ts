/**
 * Request-scoped authentication assurance (server-only).
 * Populated exclusively by requireSupabaseAuth for the duration of a server function call,
 * so userId-only authority checks can read verified claims without trusting client input.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { AuthAssuranceContext } from "@/lib/privileged-mfa";

const storage = new AsyncLocalStorage<AuthAssuranceContext>();

export function runWithRequestAuthAssurance<T>(ctx: AuthAssuranceContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestAuthAssurance(): AuthAssuranceContext | null {
  return storage.getStore() ?? null;
}
