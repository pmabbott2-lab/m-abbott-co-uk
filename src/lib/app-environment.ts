/**
 * Gate G6A — client-safe non-production environment label.
 * Never put secrets here. Mirror of APP_ENV for UI banner only.
 */
export type PublicAppEnvironment = "production" | "staging" | "development" | "unknown";

declare global {
  interface Window {
    __MH_PUBLIC_ENV__?: {
      SUPABASE_URL?: string;
      SUPABASE_PUBLISHABLE_KEY?: string;
      APP_ENV?: string;
    };
  }
}

function normalise(raw: string | undefined | null): PublicAppEnvironment {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "production" || v === "prod") return "production";
  if (v === "staging" || v === "stage") return "staging";
  if (v === "development" || v === "dev" || v === "test" || v === "local") return "development";
  if (v) return "unknown";
  return "production"; // missing → assume production UI (no banner)
}

/** Browser / SSR public env for staging banner. */
export function getPublicAppEnvironment(): PublicAppEnvironment {
  if (typeof window !== "undefined" && window.__MH_PUBLIC_ENV__?.APP_ENV) {
    return normalise(window.__MH_PUBLIC_ENV__.APP_ENV);
  }
  try {
    return normalise(import.meta.env.VITE_APP_ENV as string | undefined);
  } catch {
    return "production";
  }
}

export function shouldShowStagingBanner(): boolean {
  const env = getPublicAppEnvironment();
  return env === "staging" || env === "development" || env === "unknown";
}

export function stagingBannerLabel(): string {
  const env = getPublicAppEnvironment();
  if (env === "staging") return "STAGING";
  if (env === "development") return "DEVELOPMENT";
  if (env === "unknown") return "NON-PRODUCTION";
  return "";
}
