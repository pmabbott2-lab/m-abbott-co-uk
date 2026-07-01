/**
 * Canonical app URL for auth email links (reset password, confirm email, OAuth).
 * Set VITE_APP_URL in .env so emails return to your deployed site.
 */
/** Public base URL for share links (RAF, SMS previews). Prefer VITE_APP_URL so local dev copies the ngrok/production URL. */
export function getPublicAppUrl(): string {
  const configured = import.meta.env.VITE_APP_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  if (typeof window !== "undefined") {
    const { hostname, origin } = window.location;
    if (hostname !== "localhost" && hostname !== "127.0.0.1") return origin;
  }
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:8080";
}

export function getAppOrigin(): string {
  const configured = import.meta.env.VITE_APP_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;

  if (typeof window !== "undefined") {
    const { hostname, origin } = window.location;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return origin;
    }
    return origin;
  }

  return "http://localhost:8080";
}

export function getAuthCallbackUrl(): string {
  return `${getAppOrigin()}/auth`;
}

export function getPasswordResetUrl(): string {
  return `${getAppOrigin()}/auth/reset`;
}

export function isLocalDev(): boolean {
  if (typeof window === "undefined") return import.meta.env.DEV;
  return (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  );
}
