/**
 * Canonical app URL for auth email links (reset password, confirm email, OAuth).
 * Set VITE_APP_URL in .env / Azure so emails return to the deployed site.
 */
export const MMH_PUBLIC_URL = "https://mymortgagehub.uk";

function stripSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function isNgrokUrl(url: string): boolean {
  return /ngrok/i.test(url);
}

/** Public base URL for share links (RAF, SMS previews). */
export function getPublicAppUrl(): string {
  const configured = import.meta.env.VITE_APP_URL?.trim();
  if (configured && !isNgrokUrl(configured)) return stripSlash(configured);

  if (typeof window !== "undefined") {
    const { hostname, origin } = window.location;
    if (hostname === "mymortgagehub.uk" || hostname.endsWith(".mymortgagehub.uk")) {
      return origin;
    }
    if (hostname !== "localhost" && hostname !== "127.0.0.1" && !isNgrokUrl(origin)) {
      return origin;
    }
  }

  if (import.meta.env.PROD) return MMH_PUBLIC_URL;
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:8080";
}

export function getAppOrigin(): string {
  const configured = import.meta.env.VITE_APP_URL?.trim();
  if (configured && !isNgrokUrl(configured)) return stripSlash(configured);

  if (typeof window !== "undefined") {
    const { hostname, origin } = window.location;
    if (hostname === "localhost" || hostname === "127.0.0.1") return origin;
    if (hostname === "mymortgagehub.uk" || hostname.endsWith(".mymortgagehub.uk")) return origin;
    if (!isNgrokUrl(origin)) return origin;
  }

  if (import.meta.env.PROD) return MMH_PUBLIC_URL;
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
