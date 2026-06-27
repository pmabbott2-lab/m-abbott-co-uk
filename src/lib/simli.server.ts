// Server-only Simli API access.
// SIMLI_API_KEY / SIMLI_FACE_ID are read from process.env at call time and
// never sent to the browser. The browser only ever receives a short-lived
// session_token minted here (mirrors the OpenAI key pattern in openai.server.ts).

export const SIMLI_BASE_URL = "https://api.simli.ai";

/** Default Simli model. "fasttalk" is the low-latency lip-sync model. */
export const SIMLI_MODEL: "fasttalk" | "artalk" = "fasttalk";

/** One session per interview; keep generous bounds but let idle sessions reap. */
export const SIMLI_MAX_SESSION_LENGTH = 3600; // seconds (1 hour)
export const SIMLI_MAX_IDLE_TIME = 300; // seconds (5 min)

export interface SimliServerConfig {
  apiKey: string;
  faceId: string;
}

/**
 * Returns the configured Simli credentials, or `null` when either env var is
 * missing. Callers use `null` to respond "not configured" so the client falls
 * back to the static portrait.
 */
export function getSimliConfig(): SimliServerConfig | null {
  const apiKey = process.env.SIMLI_API_KEY;
  const faceId = process.env.SIMLI_FACE_ID;
  if (!apiKey || !faceId) return null;
  return { apiKey, faceId };
}

export interface SimliSessionToken {
  session_token: string;
}

/**
 * Mint a short-lived Simli session token bound to our faceId. This calls the
 * same endpoint as the SDK's `generateSimliSessionToken`, but server-side so the
 * API key never reaches the browser.
 */
export async function createSimliSessionToken(): Promise<SimliSessionToken> {
  const config = getSimliConfig();
  if (!config) throw new Error("SIMLI_API_KEY / SIMLI_FACE_ID are not configured");

  const res = await fetch(`${SIMLI_BASE_URL}/compose/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-simli-api-key": config.apiKey,
    },
    body: JSON.stringify({
      faceId: config.faceId,
      // We feed audio via sendAudioData(), so leave server-side silence handling
      // on (only disable it when using listenToMediastreamTrack()).
      handleSilence: true,
      maxSessionLength: SIMLI_MAX_SESSION_LENGTH,
      maxIdleTime: SIMLI_MAX_IDLE_TIME,
      model: SIMLI_MODEL,
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Simli token ${res.status}: ${txt}`);
  }

  const json = (await res.json()) as Partial<SimliSessionToken>;
  if (!json.session_token) throw new Error("Simli token response missing session_token");
  return { session_token: json.session_token };
}
