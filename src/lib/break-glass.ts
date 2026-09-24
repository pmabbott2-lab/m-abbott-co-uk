/**
 * Break-glass Super Owner classification — pure helpers.
 * Classification is metadata only; authority remains platform_roles.super_owner.
 * Never use email for classification or authority.
 */
export const BREAK_GLASS_PLATFORM_SESSION_COOKIE = "mh_bg_platform_session";
export const BREAK_GLASS_AUDIT_MARKER_COOKIE = "mh_bg_audit_marker";
export const BREAK_GLASS_EXPIRED_COOKIE = "mh_bg_session_expired";
export const BREAK_GLASS_AUTH_BIND_COOKIE = "mh_bg_auth_bind";

/** Absolute platform session ceiling for active break-glass identities. */
export const BREAK_GLASS_PLATFORM_SESSION_MAX_MS = 60 * 60 * 1000;

/** Idle timeout for break-glass platform sessions. */
export const BREAK_GLASS_PLATFORM_IDLE_MS = 15 * 60 * 1000;

/** Absolute G7D tenant-entry ceiling for break-glass (vs normal 4h). */
export const BREAK_GLASS_G7D_MAX_HOURS = 1;

export const BREAK_GLASS_G7D_MAX_MS = BREAK_GLASS_G7D_MAX_HOURS * 60 * 60 * 1000;

/** Cookie max-age for expiry lock / auth bind (longer than absolute session). */
export const BREAK_GLASS_LOCK_COOKIE_MAX_AGE_SEC = 24 * 60 * 60;

export type BreakGlassStatus = {
  isBreakGlass: boolean;
};

export type BreakGlassPlatformSessionState = {
  userId: string;
  startedAt: string;
  lastActivityAt: string;
};

export function deniedBreakGlassStatus(): BreakGlassStatus {
  return { isBreakGlass: false };
}

export function computeBreakGlassG7dExpiresAt(startedAt: Date): Date {
  return new Date(startedAt.getTime() + BREAK_GLASS_G7D_MAX_MS);
}

export function isBreakGlassPlatformSessionValid(
  state: BreakGlassPlatformSessionState,
  now: Date = new Date(),
): { ok: true } | { ok: false; reason: "absolute_expired" | "idle_expired" | "invalid" } {
  const started = Date.parse(state.startedAt);
  const last = Date.parse(state.lastActivityAt);
  if (!state.userId || Number.isNaN(started) || Number.isNaN(last)) {
    return { ok: false, reason: "invalid" };
  }
  if (now.getTime() - started > BREAK_GLASS_PLATFORM_SESSION_MAX_MS) {
    return { ok: false, reason: "absolute_expired" };
  }
  if (now.getTime() - last > BREAK_GLASS_PLATFORM_IDLE_MS) {
    return { ok: false, reason: "idle_expired" };
  }
  return { ok: true };
}

/**
 * Pure HMAC helpers (secret injected) for unit tests and server encoding.
 * Algorithm: HMAC-SHA256 over payload, base64url digest. Timing-safe compare.
 */
export type BreakGlassHmac = {
  sign: (payload: string) => string;
  safeEqual: (a: string, b: string) => boolean;
};

export function encodeBreakGlassSession(
  state: BreakGlassPlatformSessionState,
  hmac: BreakGlassHmac,
): string {
  const payload = `${state.userId}|${state.startedAt}|${state.lastActivityAt}`;
  return `${payload}|${hmac.sign(payload)}`;
}

export function decodeBreakGlassSession(
  raw: string | null | undefined,
  hmac: BreakGlassHmac,
): BreakGlassPlatformSessionState | null {
  if (!raw) return null;
  const parts = raw.split("|");
  if (parts.length !== 4) return null;
  const [userId, startedAt, lastActivityAt, sig] = parts;
  const payload = `${userId}|${startedAt}|${lastActivityAt}`;
  if (!hmac.safeEqual(hmac.sign(payload), sig)) return null;
  return { userId, startedAt, lastActivityAt };
}

export function encodeSignedBgValue(payload: string, hmac: BreakGlassHmac): string {
  return `${payload}|${hmac.sign(payload)}`;
}

export function decodeSignedBgValue(
  raw: string | null | undefined,
  hmac: BreakGlassHmac,
): string | null {
  if (!raw) return null;
  const idx = raw.lastIndexOf("|");
  if (idx <= 0) return null;
  const payload = raw.slice(0, idx);
  const sig = raw.slice(idx + 1);
  if (!payload || !sig || !hmac.safeEqual(hmac.sign(payload), sig)) return null;
  return payload;
}

/** Meaningful activity: authenticated mutating/platform navigation actions, not background polls. */
export const BREAK_GLASS_MEANINGFUL_ACTIVITY = [
  "platform_navigation",
  "platform_mutation",
  "g7d_entry",
  "g7d_exit",
  "manual_touch",
] as const;

export type BreakGlassMeaningfulActivity = (typeof BREAK_GLASS_MEANINGFUL_ACTIVITY)[number];

/** Validate-only; must not extend idle (authority polls / session checks). */
export type BreakGlassSessionActivity = BreakGlassMeaningfulActivity | "session_check";

export function shouldTouchBreakGlassIdle(activity?: BreakGlassSessionActivity): boolean {
  return (
    activity === "platform_navigation" ||
    activity === "platform_mutation" ||
    activity === "g7d_entry" ||
    activity === "g7d_exit" ||
    activity === "manual_touch"
  );
}
