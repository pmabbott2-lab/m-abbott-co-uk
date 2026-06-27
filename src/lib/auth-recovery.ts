import { getPasswordResetUrl } from "./app-url";

export const PASSWORD_RECOVERY_KEY = "factfind_password_recovery_pending";

export function isPasswordRecoveryUrl(): boolean {
  if (typeof window === "undefined") return false;
  const hash = window.location.hash;
  const search = window.location.search;
  const path = window.location.pathname;

  if (hash.includes("type=recovery") || search.includes("type=recovery")) return true;
  if (search.includes("recovery=1")) return true;

  // PKCE reset links land on the reset page with ?code=
  if (path.endsWith("/auth/reset") && (hash.length > 1 || search.includes("code="))) {
    return true;
  }

  return false;
}

export function isPasswordRecoveryPending(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(PASSWORD_RECOVERY_KEY) === "1";
}

export function markPasswordRecoveryPending(): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(PASSWORD_RECOVERY_KEY, "1");
}

export function clearPasswordRecoveryPending(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(PASSWORD_RECOVERY_KEY);
}

export function getAuthRedirectUrl(): string {
  return getPasswordResetUrl();
}

/** Full-page redirect that keeps Supabase hash tokens (router navigation strips them). */
export function goToPasswordRecoveryPage(): void {
  if (typeof window === "undefined") return;
  markPasswordRecoveryPending();
  const hash = window.location.hash || "";
  const target = `${getPasswordResetUrl()}${hash}`;
  if (window.location.href !== target) {
    window.location.replace(target);
  }
}

export function shouldBlockAuthenticatedApp(): boolean {
  return isPasswordRecoveryPending() || isPasswordRecoveryUrl();
}
