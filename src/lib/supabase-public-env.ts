/**
 * Public Supabase config only (URL + publishable key).
 * Never include SUPABASE_SERVICE_ROLE_KEY here — that must stay server-only.
 */

export type PublicSupabaseEnv = {
  url: string;
  publishableKey: string;
};

declare global {
  interface Window {
    __MH_PUBLIC_ENV__?: {
      SUPABASE_URL?: string;
      SUPABASE_PUBLISHABLE_KEY?: string;
    };
  }
}

function trim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Server/runtime process.env, including Azure App Settings. Safe on server; empty on client. */
function fromProcess(): PublicSupabaseEnv {
  const env = typeof process !== "undefined" ? process.env : undefined;
  return {
    url: trim(env?.SUPABASE_URL) || trim(env?.VITE_SUPABASE_URL),
    publishableKey:
      trim(env?.SUPABASE_PUBLISHABLE_KEY) || trim(env?.VITE_SUPABASE_PUBLISHABLE_KEY),
  };
}

/** Vite build-time public env (present when VITE_* was available during `vite build`). */
function fromVite(): PublicSupabaseEnv {
  return {
    url: trim(import.meta.env.VITE_SUPABASE_URL),
    publishableKey: trim(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY),
  };
}

/** SSR-injected public env for the browser when build-time VITE_* was absent. */
function fromWindow(): PublicSupabaseEnv {
  if (typeof window === "undefined") return { url: "", publishableKey: "" };
  const injected = window.__MH_PUBLIC_ENV__;
  return {
    url: trim(injected?.SUPABASE_URL),
    publishableKey: trim(injected?.SUPABASE_PUBLISHABLE_KEY),
  };
}

/**
 * Resolve public Supabase URL + publishable key for client or SSR.
 * Preference: runtime process.env → window injection → Vite build-time.
 */
export function getPublicSupabaseEnv(): PublicSupabaseEnv {
  const proc = fromProcess();
  if (proc.url && proc.publishableKey) return proc;

  const injected = fromWindow();
  if (injected.url && injected.publishableKey) return injected;

  const vite = fromVite();
  if (vite.url && vite.publishableKey) return vite;

  return {
    url: proc.url || injected.url || vite.url,
    publishableKey: proc.publishableKey || injected.publishableKey || vite.publishableKey,
  };
}

/** Inline script for RootShell — public values only, from Azure/runtime process.env. */
export function getPublicEnvInlineScript(): string {
  const { url, publishableKey } = fromProcess();
  const payload = {
    SUPABASE_URL: url,
    SUPABASE_PUBLISHABLE_KEY: publishableKey,
  };
  return `window.__MH_PUBLIC_ENV__=${JSON.stringify(payload)};`;
}
