/**
 * Login MFA (staff TOTP + customer SMS).
 *
 * Env gate (when TEMP flag below is false):
 *   SKIP_LOGIN_MFA=true
 *   VITE_SKIP_LOGIN_MFA=true
 */

/** TEMP: set false to restore MFA after Azure login testing. */
const TEMP_SUSPEND_LOGIN_MFA = true;

export function isLoginMfaSuspended(): boolean {
  if (TEMP_SUSPEND_LOGIN_MFA) return true;

  if (import.meta.env.VITE_SKIP_LOGIN_MFA === "true") return true;
  try {
    const proc = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } })
      .process;
    if (proc?.env?.["SKIP_LOGIN_MFA"] === "true") return true;
  } catch {
    /* ignore */
  }
  return false;
}
