/**
 * Gate G6A — central guard for external side-effect operations.
 * Staging/dev: capture or disable by default. Never fall back to production
 * credentials silently.
 */
import {
  ExternalActionBlockedError,
  getAppEnvironment,
  getCommunicationDeliveryMode,
  isProduction,
  isSusanEnvironmentAllowed,
  isTeamsGraphLiveAllowed,
  isTwilioLiveDeliveryAllowed,
  type CommunicationDeliveryMode,
  environmentLogLabel,
} from "@/lib/app-environment.server";

export type ExternalService =
  | "twilio_sms"
  | "twilio_voice"
  | "email"
  | "teams_graph"
  | "susan_simli"
  | "tts"
  | "stt"
  | "openai";

export type ExternalAction =
  | "send"
  | "call"
  | "create_meeting"
  | "update_meeting"
  | "delete_meeting"
  | "read_calendar"
  | "session"
  | "synthesize"
  | "transcribe";

export type ExternalActionDecision = {
  allowed: boolean;
  /** live = real side effect; capture = record only; disabled = hard block */
  mode: CommunicationDeliveryMode;
  service: ExternalService;
  action: ExternalAction;
  reason: string;
};

export type CommunicationCapture = {
  id: string;
  at: string;
  env: string;
  service: ExternalService;
  action: ExternalAction;
  /** Redacted metadata — no secrets, limited PII */
  meta: Record<string, string | number | boolean | null>;
};

const captures: CommunicationCapture[] = [];
const MAX_CAPTURES = 200;

function pushCapture(c: CommunicationCapture): void {
  captures.push(c);
  if (captures.length > MAX_CAPTURES) captures.splice(0, captures.length - MAX_CAPTURES);
}

export function getCommunicationCaptures(): readonly CommunicationCapture[] {
  return captures;
}

export function clearCommunicationCaptures(): void {
  captures.length = 0;
}

function decideTwilioSms(): ExternalActionDecision {
  const mode = getCommunicationDeliveryMode();
  if (mode === "disabled") {
    return {
      allowed: false,
      mode,
      service: "twilio_sms",
      action: "send",
      reason: "delivery_mode_disabled",
    };
  }
  if (!isTwilioLiveDeliveryAllowed()) {
    return {
      allowed: false,
      mode: mode === "live" && !isProduction() ? "capture" : mode === "live" ? "disabled" : mode,
      service: "twilio_sms",
      action: "send",
      reason: isProduction() ? "not_live" : "staging_blocks_production_twilio",
    };
  }
  return {
    allowed: true,
    mode: "live",
    service: "twilio_sms",
    action: "send",
    reason: "live_allowed",
  };
}

function decideTwilioVoice(): ExternalActionDecision {
  const mode = getCommunicationDeliveryMode();
  if (mode === "disabled") {
    return {
      allowed: false,
      mode,
      service: "twilio_voice",
      action: "call",
      reason: "delivery_mode_disabled",
    };
  }
  if (!isTwilioLiveDeliveryAllowed()) {
    return {
      allowed: false,
      mode: isProduction() ? "disabled" : "capture",
      service: "twilio_voice",
      action: "call",
      reason: "staging_blocks_production_twilio_voice",
    };
  }
  return {
    allowed: true,
    mode: "live",
    service: "twilio_voice",
    action: "call",
    reason: "live_allowed",
  };
}

function decideTeams(action: ExternalAction): ExternalActionDecision {
  const write =
    action === "create_meeting" ||
    action === "update_meeting" ||
    action === "delete_meeting";
  const ok = isTeamsGraphLiveAllowed(write ? "write" : "read");
  if (ok) {
    return {
      allowed: true,
      mode: "live",
      service: "teams_graph",
      action,
      reason: "live_allowed",
    };
  }
  return {
    allowed: false,
    mode: isProduction() ? "disabled" : "capture",
    service: "teams_graph",
    action,
    reason: write
      ? "staging_blocks_teams_write"
      : "staging_blocks_teams_read",
  };
}

function decideSusanFamily(
  service: "susan_simli" | "tts" | "stt" | "openai",
  action: ExternalAction,
): ExternalActionDecision {
  if (!isSusanEnvironmentAllowed()) {
    return {
      allowed: false,
      mode: "disabled",
      service,
      action,
      reason: "susan_environment_disabled",
    };
  }
  return {
    allowed: true,
    mode: "live",
    service,
    action,
    reason: "environment_allows",
  };
}

function decideEmail(): ExternalActionDecision {
  const mode = getCommunicationDeliveryMode();
  if (mode === "live" && isProduction()) {
    return {
      allowed: true,
      mode: "live",
      service: "email",
      action: "send",
      reason: "live_allowed",
    };
  }
  if (mode === "disabled" || getAppEnvironment() === "unknown") {
    return {
      allowed: false,
      mode: "disabled",
      service: "email",
      action: "send",
      reason: "email_suppressed",
    };
  }
  return {
    allowed: false,
    mode: "capture",
    service: "email",
    action: "send",
    reason: "email_capture_only",
  };
}

export function resolveExternalAction(opts: {
  service: ExternalService;
  action: ExternalAction;
}): ExternalActionDecision {
  switch (opts.service) {
    case "twilio_sms":
      return decideTwilioSms();
    case "twilio_voice":
      return decideTwilioVoice();
    case "teams_graph":
      return decideTeams(opts.action);
    case "email":
      return decideEmail();
    case "susan_simli":
    case "tts":
    case "stt":
    case "openai":
      return decideSusanFamily(opts.service, opts.action);
    default:
      return {
        allowed: false,
        mode: "disabled",
        service: opts.service,
        action: opts.action,
        reason: "unknown_service",
      };
  }
}

/**
 * Assert live side effect is permitted. Throws ExternalActionBlockedError
 * when mode is disabled. Returns decision (caller handles capture).
 */
export function assertExternalActionAllowed(opts: {
  service: ExternalService;
  action: ExternalAction;
}): ExternalActionDecision {
  const decision = resolveExternalAction(opts);
  if (decision.mode === "disabled") {
    console.warn(
      `${environmentLogLabel()} blocked ${opts.service}/${opts.action}: ${decision.reason}`,
    );
    throw new ExternalActionBlockedError(
      opts.service,
      opts.action,
      decision.mode,
      decision.reason,
    );
  }
  return decision;
}

/** Record a captured outbound attempt (no secrets / minimal PII). */
export function captureExternalAction(opts: {
  service: ExternalService;
  action: ExternalAction;
  meta?: Record<string, string | number | boolean | null>;
}): CommunicationCapture {
  const id = `cap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const record: CommunicationCapture = {
    id,
    at: new Date().toISOString(),
    env: String(getAppEnvironment()),
    service: opts.service,
    action: opts.action,
    meta: opts.meta ?? {},
  };
  pushCapture(record);
  console.info(
    `${environmentLogLabel()} captured ${opts.service}/${opts.action} id=${id}`,
  );
  return record;
}

export { ExternalActionBlockedError };
