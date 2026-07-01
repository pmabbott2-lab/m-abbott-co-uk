import type { Session } from "@supabase/supabase-js";

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
