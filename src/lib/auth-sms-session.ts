import type { Session } from "@supabase/supabase-js";

/**
 * Customer login convenience only (client sessionStorage, never sent to or checked by the server).
 * NOT authentication assurance: must never satisfy AAL2, fresh privileged auth, or platform /
 * break-glass / G7D MFA. Privileged MFA is decided server-side in privileged-mfa.server.ts.
 */
const KEY = "mh_login_sms_verified";

function sessionKey(session: Session): string {
  return `${session.user.id}:${session.expires_at ?? 0}`;
}

/** Mark this login session as SMS-verified (customers & introducers). */
export function markLoginSmsVerified(session: Session): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(KEY, sessionKey(session));
}

export function isLoginSmsVerified(session: Session): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(KEY) === sessionKey(session);
}

export function clearLoginSmsVerified(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(KEY);
}
