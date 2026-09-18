/**
 * Gate G6A — canonical application environment (server-authoritative).
 *
 * APP_ENV distinguishes production vs staging vs development independently of
 * NODE_ENV (a production build may run in staging).
 *
 * Fail-safe: unknown / invalid APP_ENV never becomes "production" for
 * external side effects. Legacy Azure apps without APP_ENV still resolve to
 * production so existing live behaviour is preserved until APP_ENV is set.
 */
export type AppEnvironment = "production" | "staging" | "development";

export type CommunicationDeliveryMode = "live" | "capture" | "disabled";

export class ExternalActionBlockedError extends Error {
  readonly code = "EXTERNAL_ACTION_BLOCKED" as const;
  readonly service: string;
  readonly action: string;
  readonly mode: CommunicationDeliveryMode;

  constructor(
    service: string,
    action: string,
    mode: CommunicationDeliveryMode,
    message?: string,
  ) {
    super(
      message ??
        `External action blocked (${service}/${action}) in ${mode} mode.`,
    );
    this.name = "ExternalActionBlockedError";
    this.service = service;
    this.action = action;
    this.mode = mode;
  }
}

function readEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

function isAzureWebApp(): boolean {
  return Boolean(readEnv("WEBSITE_SITE_NAME") || readEnv("WEBSITE_HOSTNAME"));
}

/**
 * Resolve APP_ENV.
 * - Explicit production|staging|development
 * - Unset on Azure → production (legacy)
 * - Unset locally → development
 * - Invalid value → null (unknown — fail closed for externals)
 */
export function resolveAppEnvironmentRaw(): {
  env: AppEnvironment | "unknown";
  source: string;
} {
  const raw = (readEnv("APP_ENV") || readEnv("VITE_APP_ENV")).toLowerCase();
  if (raw === "production" || raw === "prod") {
    return { env: "production", source: "APP_ENV" };
  }
  if (raw === "staging" || raw === "stage") {
    return { env: "staging", source: "APP_ENV" };
  }
  if (raw === "development" || raw === "dev" || raw === "test" || raw === "local") {
    return { env: "development", source: "APP_ENV" };
  }
  if (raw) {
    return { env: "unknown", source: "APP_ENV_invalid" };
  }
  if (isAzureWebApp()) {
    return { env: "production", source: "azure_legacy_default" };
  }
  return { env: "development", source: "local_default" };
}

export function getAppEnvironment(): AppEnvironment | "unknown" {
  return resolveAppEnvironmentRaw().env;
}

export function isProduction(): boolean {
  return getAppEnvironment() === "production";
}

export function isStaging(): boolean {
  return getAppEnvironment() === "staging";
}

export function isDevelopment(): boolean {
  return getAppEnvironment() === "development";
}

/** True when UI should show non-production banner. */
export function isNonProduction(): boolean {
  const env = getAppEnvironment();
  return env === "staging" || env === "development" || env === "unknown";
}

/**
 * COMMUNICATION_DELIVERY_MODE — live | capture | disabled
 * Defaults: production→live; staging/dev→capture; unknown→disabled.
 * Explicit mode always wins.
 */
export function getCommunicationDeliveryMode(): CommunicationDeliveryMode {
  const raw = readEnv("COMMUNICATION_DELIVERY_MODE").toLowerCase();
  if (raw === "live" || raw === "capture" || raw === "disabled") return raw;

  const env = getAppEnvironment();
  if (env === "production") return "live";
  if (env === "unknown") return "disabled";
  return "capture";
}

/** Staging/dev must never inherit production Twilio merely because TWILIO_* is set. */
export function isTwilioLiveDeliveryAllowed(): boolean {
  if (getCommunicationDeliveryMode() === "disabled") return false;
  if (getCommunicationDeliveryMode() === "capture") return false;
  if (!isProduction()) {
    // Explicit opt-in only — never silent production credential reuse.
    return readEnv("STAGING_TWILIO_ALLOW_LIVE") === "true";
  }
  return getCommunicationDeliveryMode() === "live";
}

export function isTeamsGraphLiveAllowed(action: "read" | "write"): boolean {
  if (isProduction() && getCommunicationDeliveryMode() === "live") return true;
  if (getAppEnvironment() === "unknown") return false;
  if (action === "write") {
    return readEnv("STAGING_TEAMS_ALLOW_LIVE") === "true";
  }
  // Reads against production calendars blocked by default in non-prod.
  return readEnv("STAGING_TEAMS_ALLOW_READ") === "true";
}

/**
 * Environment permit for Susan/avatar/TTS/STT (independent of tenant features).
 * Production: allowed unless SUSAN_ENVIRONMENT_ENABLED=false.
 * Staging: denied unless STAGING_SUSAN_ENABLED=true.
 * Development: allowed unless SUSAN_ENVIRONMENT_ENABLED=false.
 * Unknown: denied.
 */
export function isSusanEnvironmentAllowed(): boolean {
  const env = getAppEnvironment();
  if (env === "unknown") return false;
  if (env === "staging") {
    return readEnv("STAGING_SUSAN_ENABLED") === "true";
  }
  if (readEnv("SUSAN_ENVIRONMENT_ENABLED") === "false") return false;
  return true;
}

export function assertProductionOperationAllowed(operation: string): void {
  if (!isProduction()) {
    throw new ExternalActionBlockedError(
      "platform",
      operation,
      getCommunicationDeliveryMode(),
      `Operation '${operation}' is production-only.`,
    );
  }
}

export function environmentLogLabel(): string {
  const { env, source } = resolveAppEnvironmentRaw();
  return `[env=${env} src=${source}]`;
}
