/**
 * Gate G6B — fail-closed guards so staging tooling cannot touch production.
 *
 * Allowed target is the Mortgage Hub Staging Supabase project only.
 * Fail closed for missing, unknown, production, stale, or mismatched refs.
 */
export const PRODUCTION_SUPABASE_REF = "tiuplmftooauihulhtws";
export const STAGING_SUPABASE_REF = "fwgjtbeigpipvayytwlu";
/** Local supabase/config.toml project_id — never treat as staging. */
export const STALE_LOCAL_SUPABASE_REF = "ibajpnsnsrjgbhlcvnve";
export const FORBIDDEN_SUPABASE_REFS = Object.freeze([
  PRODUCTION_SUPABASE_REF,
  STALE_LOCAL_SUPABASE_REF,
]);
export const PRODUCTION_AZURE_APP = "Mortgagehub-prod";
export const PRODUCTION_HOST = "mymortgagehub.uk";
export const STAGING_HOST = "staging.mymortgagehub.uk";

const URL_ENV_KEYS = ["SUPABASE_URL", "VITE_SUPABASE_URL", "DATABASE_URL", "SUPABASE_DB_URL"];
const REF_ENV_KEYS = [
  "SUPABASE_PROJECT_ID",
  "SUPABASE_PROJECT_REF",
  "VITE_SUPABASE_PROJECT_ID",
  "G6B_TARGET_PROJECT_REF",
];

export class ProductionGuardError extends Error {
  constructor(reason) {
    super(`REFUSED: staging tooling must not run against production (${reason}).`);
    this.name = "ProductionGuardError";
    this.reason = reason;
  }
}

function read(name) {
  return (process.env[name] ?? "").trim();
}

function hostOf(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Positively resolve a 20-char Supabase project ref from a URL or host.
 * Returns "" when the value is missing or cannot be parsed.
 */
export function extractProjectRef(value) {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  if (/^[a-z0-9]{20}$/i.test(raw)) return raw.toLowerCase();

  const host = hostOf(raw) || raw.replace(/^https?:\/\//, "").split("/")[0].toLowerCase();
  const fromHost = host.match(/(?:^|\.)([a-z0-9]{20})\.supabase\.(co|in|com)$/i);
  if (fromHost) return fromHost[1].toLowerCase();

  const fromPostgres = raw.match(/(?:postgres\.|project-ref=)([a-z0-9]{20})/i);
  if (fromPostgres) return fromPostgres[1].toLowerCase();

  return "";
}

function collectResolvedRefs() {
  const resolved = [];
  const unmatched = [];

  for (const key of URL_ENV_KEYS) {
    const value = read(key);
    if (!value) continue;
    const ref = extractProjectRef(value);
    if (!ref) unmatched.push(key);
    else resolved.push({ key, ref, source: "url" });
  }

  for (const key of REF_ENV_KEYS) {
    const value = read(key);
    if (!value) continue;
    const ref = extractProjectRef(value);
    if (!ref) unmatched.push(key);
    else resolved.push({ key, ref, source: "ref" });
  }

  return { resolved, unmatched };
}

/**
 * @returns {{ supabaseUrl: string, appEnv: string, appBaseUrl: string, projectRef: string }}
 */
export function assertStagingTargetAllowed() {
  const appEnv = (read("APP_ENV") || read("VITE_APP_ENV")).toLowerCase();
  const supabaseUrl = read("SUPABASE_URL") || read("VITE_SUPABASE_URL");
  const appBaseUrl = read("APP_BASE_URL") || read("VITE_APP_URL");
  const azureApp = read("WEBSITE_SITE_NAME");
  const reasons = [];

  if (appEnv === "production" || appEnv === "prod") {
    reasons.push("APP_ENV=production");
  }

  const host = hostOf(appBaseUrl) || appBaseUrl.replace(/^https?:\/\//, "").split("/")[0].toLowerCase();
  if (host === PRODUCTION_HOST || host === `www.${PRODUCTION_HOST}`) {
    reasons.push("APP_BASE_URL is production hostname");
  }
  if (azureApp === PRODUCTION_AZURE_APP) {
    reasons.push("WEBSITE_SITE_NAME is Mortgagehub-prod");
  }
  if (reasons.length) {
    throw new ProductionGuardError(reasons.join("; "));
  }
  if (appEnv !== "staging") {
    throw new ProductionGuardError(`APP_ENV must be staging (got ${appEnv || "unset"})`);
  }

  const { resolved, unmatched } = collectResolvedRefs();
  if (unmatched.length) {
    throw new ProductionGuardError(`unknown/unparseable project ref in ${unmatched.join(", ")}`);
  }
  if (!resolved.length) {
    throw new ProductionGuardError("target project ref missing (not positively resolved)");
  }

  const uniqueRefs = [...new Set(resolved.map((row) => row.ref))];
  if (uniqueRefs.length > 1) {
    throw new ProductionGuardError(
      `URL/ref mismatch (${resolved.map((row) => `${row.key}=${row.ref}`).join("; ")})`,
    );
  }

  const projectRef = uniqueRefs[0];
  if (!projectRef) {
    throw new ProductionGuardError("target project ref missing (not positively resolved)");
  }
  if (projectRef === PRODUCTION_SUPABASE_REF) {
    throw new ProductionGuardError("Supabase URL/ref is the production project");
  }
  if (projectRef === STALE_LOCAL_SUPABASE_REF) {
    throw new ProductionGuardError("stale local config ref is not staging");
  }
  if (projectRef !== STAGING_SUPABASE_REF) {
    throw new ProductionGuardError(`target ref is not Mortgage Hub Staging (got ${projectRef})`);
  }

  return { supabaseUrl, appEnv, appBaseUrl, projectRef };
}
