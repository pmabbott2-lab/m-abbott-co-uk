/**
 * Break-glass server helpers (server-only).
 * Registry access via service-role admin client. No email authority.
 * Session state: signed HttpOnly cookies (no new DB table).
 * Client code must import createServerFn wrappers from break-glass.functions.ts.
 *
 * Signing secret: BREAK_GLASS_SESSION_SECRET → TEAMS_TOKEN_SECRET → SUPABASE_SERVICE_ROLE_KEY.
 * No hard-coded secret. No VITE_ exposure. Fail closed if none configured.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdminUntyped as db } from "@/integrations/supabase/client.server";
import { getAppEnvironment } from "@/lib/app-environment.server";
import { decodeJwtPayload } from "@/lib/auth-jwt-fallback.server";
import {
  BREAK_GLASS_AUDIT_MARKER_COOKIE,
  BREAK_GLASS_AUTH_BIND_COOKIE,
  BREAK_GLASS_EXPIRED_COOKIE,
  BREAK_GLASS_LOCK_COOKIE_MAX_AGE_SEC,
  BREAK_GLASS_PLATFORM_SESSION_COOKIE,
  decodeBreakGlassSession,
  decodeSignedBgValue,
  deniedBreakGlassStatus,
  encodeBreakGlassSession,
  encodeSignedBgValue,
  isBreakGlassPlatformSessionValid,
  shouldTouchBreakGlassIdle,
  type BreakGlassHmac,
  type BreakGlassSessionActivity,
  type BreakGlassPlatformSessionState,
  type BreakGlassStatus,
} from "@/lib/break-glass";

function cookieSecure(): boolean {
  const env = getAppEnvironment();
  return env === "staging" || env === "production";
}

/**
 * Server-only signing material. Prefer dedicated BREAK_GLASS_SESSION_SECRET when set;
 * otherwise reuse existing TEAMS_TOKEN_SECRET / SUPABASE_SERVICE_ROLE_KEY (already server-side).
 * Never falls back to a hard-coded string.
 */
function sessionSecret(): string {
  const secret =
    process.env.BREAK_GLASS_SESSION_SECRET?.trim() ||
    process.env.TEAMS_TOKEN_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "";
  if (!secret) {
    throw new Error("break_glass_session_secret_unavailable");
  }
  return secret;
}

function hmacForSecret(secret: string): BreakGlassHmac {
  return {
    sign: (payload: string) =>
      createHmac("sha256", secret).update(payload).digest("base64url"),
    safeEqual: (a: string, b: string) => {
      try {
        const ba = Buffer.from(a);
        const bb = Buffer.from(b);
        if (ba.length !== bb.length) return false;
        return timingSafeEqual(ba, bb);
      } catch {
        return false;
      }
    },
  };
}

function hmac(): BreakGlassHmac {
  return hmacForSecret(sessionSecret());
}

async function setBgCookie(name: string, value: string, maxAgeSec: number): Promise<void> {
  const { setCookie } = await import("@tanstack/react-start/server");
  setCookie(name, value, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSec,
  });
}

async function clearBgCookie(name: string): Promise<void> {
  try {
    const { deleteCookie } = await import("@tanstack/react-start/server");
    deleteCookie(name, {
      httpOnly: true,
      secure: cookieSecure(),
      sameSite: "lax",
      path: "/",
    });
  } catch {
    /* no request context */
  }
}

async function readBgCookie(name: string): Promise<string | null> {
  try {
    const { getCookie } = await import("@tanstack/react-start/server");
    return getCookie(name)?.trim() || null;
  } catch {
    return null;
  }
}

/** Auth JWT iat (seconds) for same-login bind after absolute/idle expiry. */
async function readAuthIatSeconds(): Promise<string | null> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const request = getRequest();
    const authHeader = request?.headers?.get("authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return null;
    const token = authHeader.slice("Bearer ".length).trim();
    const payload = decodeJwtPayload(token);
    if (!payload || typeof payload.iat !== "number") return null;
    return String(Math.floor(payload.iat));
  } catch {
    return null;
  }
}

/**
 * Server-side BG classification. UUID + registry only.
 * Does NOT grant Super Owner authority.
 */
export async function resolveBreakGlassStatus(
  userId: string | null | undefined,
): Promise<BreakGlassStatus> {
  const id = userId?.trim() || null;
  if (!id) return deniedBreakGlassStatus();
  try {
    const { data, error } = await db.rpc("is_active_break_glass", { p_user_id: id });
    if (error) {
      console.error("is_active_break_glass", error.message);
      return deniedBreakGlassStatus();
    }
    return { isBreakGlass: data === true };
  } catch (err) {
    console.error("resolveBreakGlassStatus", err);
    return deniedBreakGlassStatus();
  }
}

export async function writeBreakGlassAuditBestEffort(input: {
  eventType:
    | "BREAK_GLASS_LOGIN_SUCCEEDED"
    | "BREAK_GLASS_PLATFORM_ACCESS"
    | "BREAK_GLASS_TENANT_ENTRY_STARTED"
    | "BREAK_GLASS_TENANT_ENTRY_ENDED"
    | "BREAK_GLASS_LOGOUT"
    | "BREAK_GLASS_IDENTITY_CREATED"
    | "BREAK_GLASS_IDENTITY_REPLACED"
    | "BREAK_GLASS_IDENTITY_DEACTIVATED";
  actingUserId: string;
  subjectUserId?: string | null;
  tenantId?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<{ written: boolean }> {
  try {
    const { writePlatformAuditEvent } = await import("@/lib/platform-audit.server");
    await writePlatformAuditEvent({
      eventType: input.eventType as never,
      actingUserId: input.actingUserId,
      subjectUserId: input.subjectUserId ?? null,
      tenantId: input.tenantId ?? null,
      metadata: input.metadata ?? null,
    });
    return { written: true };
  } catch (err) {
    console.error("break_glass_audit_failed", input.eventType, err);
    return { written: false };
  }
}

/**
 * Establish or refresh BG platform session cookie.
 * LOGIN + PLATFORM_ACCESS audited once per absolute session (dedup via signed marker).
 *
 * Audit failure behaviour:
 * - LOGIN/PLATFORM_ACCESS: do not block recovery access (log + continue).
 * - Absolute/idle expiry: fail closed (deny platform; signed lock + auth-bind).
 */

export async function ensureBreakGlassPlatformSession(input: {
  userId: string;
  isBreakGlass: boolean;
  isSuperOwner: boolean;
  activity?: BreakGlassSessionActivity;
}): Promise<{
  active: boolean;
  expiredReason?:
    | "absolute_expired"
    | "idle_expired"
    | "not_break_glass"
    | "not_super_owner"
    | "expired_locked"
    | "auth_bind_blocked"
    | "secret_unavailable"
    | "invalid";
}> {
  if (!input.isBreakGlass || !input.isSuperOwner) {
    await clearBreakGlassPlatformSessionCookies();
    return {
      active: false,
      expiredReason: !input.isBreakGlass ? "not_break_glass" : "not_super_owner",
    };
  }

  let h: BreakGlassHmac;
  try {
    h = hmac();
  } catch {
    console.error("break_glass_session_secret_unavailable");
    return { active: false, expiredReason: "secret_unavailable" };
  }

  const now = new Date();
  const lockPayload = decodeSignedBgValue(await readBgCookie(BREAK_GLASS_EXPIRED_COOKIE), h);
  const bindPayload = decodeSignedBgValue(await readBgCookie(BREAK_GLASS_AUTH_BIND_COOKIE), h);
  const existing = decodeBreakGlassSession(
    await readBgCookie(BREAK_GLASS_PLATFORM_SESSION_COOKIE),
    h,
  );
  const authIat = await readAuthIatSeconds();

  if (existing && existing.userId === input.userId) {
    const validity = isBreakGlassPlatformSessionValid(existing, now);
    if (!validity.ok) {
      // Keep expired signed session (startedAt immutable) + signed lock so deleting
      // only the lock cannot resurrect; auth-bind blocks same Auth login reuse.
      await setBgCookie(
        BREAK_GLASS_PLATFORM_SESSION_COOKIE,
        encodeBreakGlassSession(existing, h),
        BREAK_GLASS_LOCK_COOKIE_MAX_AGE_SEC,
      );
      await setBgCookie(
        BREAK_GLASS_EXPIRED_COOKIE,
        encodeSignedBgValue(`${input.userId}|${validity.reason}|${now.toISOString()}`, h),
        BREAK_GLASS_LOCK_COOKIE_MAX_AGE_SEC,
      );
      if (authIat) {
        await setBgCookie(
          BREAK_GLASS_AUTH_BIND_COOKIE,
          encodeSignedBgValue(`${input.userId}|${authIat}`, h),
          BREAK_GLASS_LOCK_COOKIE_MAX_AGE_SEC,
        );
      }
      return { active: false, expiredReason: validity.reason };
    }
    const touch = shouldTouchBreakGlassIdle(input.activity);
    const state: BreakGlassPlatformSessionState = {
      ...existing,
      lastActivityAt: touch ? now.toISOString() : existing.lastActivityAt,
    };
    await setBgCookie(
      BREAK_GLASS_PLATFORM_SESSION_COOKIE,
      encodeBreakGlassSession(state, h),
      Math.ceil(60 * 60),
    );
    return { active: true };
  }

  // Signed expiry lock for this user — fail closed even if session cookie cleared.
  if (lockPayload?.startsWith(`${input.userId}|`)) {
    return { active: false, expiredReason: "expired_locked" };
  }

  // Same Auth JWT iat already used for a prior BG emergency session that expired.
  if (authIat && bindPayload === `${input.userId}|${authIat}`) {
    return { active: false, expiredReason: "auth_bind_blocked" };
  }

  const iso = now.toISOString();
  const state: BreakGlassPlatformSessionState = {
    userId: input.userId,
    startedAt: iso,
    lastActivityAt: iso,
  };
  await setBgCookie(
    BREAK_GLASS_PLATFORM_SESSION_COOKIE,
    encodeBreakGlassSession(state, h),
    Math.ceil(60 * 60),
  );
  if (authIat) {
    await setBgCookie(
      BREAK_GLASS_AUTH_BIND_COOKIE,
      encodeSignedBgValue(`${input.userId}|${authIat}`, h),
      BREAK_GLASS_LOCK_COOKIE_MAX_AGE_SEC,
    );
  }

  const sessionKey = `${input.userId}:${state.startedAt}`;
  const markerPayload = decodeSignedBgValue(await readBgCookie(BREAK_GLASS_AUDIT_MARKER_COOKIE), h);
  if (markerPayload !== sessionKey) {
    await writeBreakGlassAuditBestEffort({
      eventType: "BREAK_GLASS_LOGIN_SUCCEEDED",
      actingUserId: input.userId,
      metadata: { source: "platform_session_establish", startedAt: state.startedAt },
    });
    await writeBreakGlassAuditBestEffort({
      eventType: "BREAK_GLASS_PLATFORM_ACCESS",
      actingUserId: input.userId,
      metadata: { source: "platform_session_establish", startedAt: state.startedAt },
    });
    await setBgCookie(
      BREAK_GLASS_AUDIT_MARKER_COOKIE,
      encodeSignedBgValue(sessionKey, h),
      Math.ceil(60 * 60),
    );
  }

  return { active: true };
}

export async function clearBreakGlassPlatformSessionCookies(): Promise<void> {
  await clearBgCookie(BREAK_GLASS_PLATFORM_SESSION_COOKIE);
  await clearBgCookie(BREAK_GLASS_AUDIT_MARKER_COOKIE);
  await clearBgCookie(BREAK_GLASS_EXPIRED_COOKIE);
  await clearBgCookie(BREAK_GLASS_AUTH_BIND_COOKIE);
}

/**
 * Logout audit must never block Auth logout.
 */
export async function auditBreakGlassLogoutBestEffort(userId: string | null | undefined): Promise<void> {
  const id = userId?.trim();
  if (!id) {
    await clearBreakGlassPlatformSessionCookies();
    return;
  }
  const status = await resolveBreakGlassStatus(id);
  if (status.isBreakGlass) {
    await writeBreakGlassAuditBestEffort({
      eventType: "BREAK_GLASS_LOGOUT",
      actingUserId: id,
      metadata: { source: "sign_out" },
    });
  }
  await clearBreakGlassPlatformSessionCookies();
}
