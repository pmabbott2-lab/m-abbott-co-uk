/** Set SKIP_LOGIN_MFA=true and VITE_SKIP_LOGIN_MFA=true in .env to bypass all login MFA (staff TOTP + customer SMS). */
export function isLoginMfaSuspended(): boolean {
  if (import.meta.env.VITE_SKIP_LOGIN_MFA === "true") return true;
  if (typeof process !== "undefined" && process.env.SKIP_LOGIN_MFA === "true") return true;
  return false;
}
