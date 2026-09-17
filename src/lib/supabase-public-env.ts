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

/** Azure App Settings sometimes include a trailing slash; Supabase clients expect the bare project URL. */
function normalizeSupabaseUrl(value: string): string {
  return trim(value).replace(/\/+$/, "");
}

/**
 * Read process.env by dynamic key.
 * Vite client builds replace static `process.env` / `process.env.FOO` with `{}` / literals;
 * bracket access via globalThis survives and still works on the Node SSR/runtime.
 */
function readProcessEnv(name: string): string {
  try {
    const proc = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } })
      .process;
    const envBag = proc?.env;
    if (!envBag) return "";
    return trim(envBag[name]);
  } catch {
    return "";
  }
}

/** Server/runtime process.env, including Azure App Settings. */
function fromProcess(): PublicSupabaseEnv {
  return {
    url: normalizeSupabaseUrl(readProcessEnv("SUPABASE_URL") || readProcessEnv("VITE_SUPABASE_URL")),
    publishableKey:
      readProcessEnv("SUPABASE_PUBLISHABLE_KEY") || readProcessEnv("VITE_SUPABASE_PUBLISHABLE_KEY"),
  };
}

/** Vite build-time public env (present when VITE_* was available during `vite build`). */
function fromVite(): PublicSupabaseEnv {
  return {
    url: normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL),
    publishableKey: trim(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY),
  };
}

/** SSR-injected public env for the browser when build-time VITE_* was absent. */
function fromWindow(): PublicSupabaseEnv {
  if (typeof window === "undefined") return { url: "", publishableKey: "" };
  const injected = window.__MH_PUBLIC_ENV__;
  return {
    url: normalizeSupabaseUrl(injected?.SUPABASE_URL ?? ""),
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

/**
 * Inline script for RootShell — public values only.
 * Must only be generated during SSR (import.meta.env.SSR). Client hydration must not
 * rewrite this to empty values (client builds replace process.env with {}).
 */
export function getPublicEnvInlineScript(): string {
  if (!import.meta.env.SSR) {
    // Keep whatever the server already wrote into the HTML; do not clear it.
    return "window.__MH_PUBLIC_ENV__=window.__MH_PUBLIC_ENV__||{};";
  }
  const { url, publishableKey } = fromProcess();
  const payload = {
    SUPABASE_URL: url,
    SUPABASE_PUBLISHABLE_KEY: publishableKey,
  };
  return `window.__MH_PUBLIC_ENV__=${JSON.stringify(payload)};`;
}
