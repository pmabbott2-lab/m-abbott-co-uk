/**
 * Break-glass server helpers (server-only).
 * Registry access via service-role admin client. No email authority.
 * Session state: authoritative DB row via service_role RPCs; signed HttpOnly cookies are cache-only.
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

import {
  resolveBreakGlassStatus,
  writeBreakGlassAuditBestEffort,
} from "@/lib/break-glass-registry.server";

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

/** Read Auth JWT claims used for BG server-session binding (session_id primary). */
async function readAuthBinding(): Promise<{
  authSessionId: string | null;
  authIat: number | null;
}> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const request = getRequest();
    const authHeader = request?.headers?.get("authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return { authSessionId: null, authIat: null };
    const token = authHeader.slice("Bearer ".length).trim();
    const payload = decodeJwtPayload(token);
    if (!payload) return { authSessionId: null, authIat: null };
    const sessionRaw =
      (typeof payload.session_id === "string" && payload.session_id.trim()) ||
      (typeof payload.sessionId === "string" && payload.sessionId.trim()) ||
      null;
    const authIat = typeof payload.iat === "number" ? Math.floor(payload.iat) : null;
    return { authSessionId: sessionRaw || null, authIat };
  } catch {
    return { authSessionId: null, authIat: null };
  }
}

async function rehydrateBgSessionCookies(input: {
  userId: string;
  startedAt: string;
  lastActivityAt: string;
  absoluteExpiresAt: string;
}): Promise<void> {
  let h: BreakGlassHmac;
  try {
    h = hmac();
  } catch {
    return;
  }
  const remainingSec = Math.max(
    60,
    Math.ceil((Date.parse(input.absoluteExpiresAt) - Date.now()) / 1000),
  );
  const state: BreakGlassPlatformSessionState = {
    userId: input.userId,
    startedAt: input.startedAt,
    lastActivityAt: input.lastActivityAt,
  };
  await setBgCookie(
    BREAK_GLASS_PLATFORM_SESSION_COOKIE,
    encodeBreakGlassSession(state, h),
    remainingSec,
  );
  // Expired / auth-bind cookies are advisory UI only; clear stale expired lock when active.
  await clearBgCookie(BREAK_GLASS_EXPIRED_COOKIE);
}

/**
 * Authoritative BG platform session via DB RPC.
 * Cookies are non-authoritative cache; deletion cannot reset absolute window.
 * LOGIN/PLATFORM_ACCESS audits are written inside the ensure RPC (server dedup).
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
    | "auth_session_id_required"
    | "same_auth_session_locked"
    | "no_active_session"
    | "secret_unavailable"
    | "invalid";
  startedAt?: string;
  absoluteExpiresAt?: string;
}> {
  if (!input.isBreakGlass || !input.isSuperOwner) {
    await clearBreakGlassPlatformSessionCookies();
    try {
      await db.rpc("end_break_glass_platform_session", {
        p_user_id: input.userId,
        p_end_reason: !input.isBreakGlass ? "classification_removed" : "role_removed",
      });
    } catch {
      /* best-effort */
    }
    return {
      active: false,
      expiredReason: !input.isBreakGlass ? "not_break_glass" : "not_super_owner",
    };
  }

  const binding = await readAuthBinding();
  const activity = input.activity ?? "session_check";
  const { data, error } = await db.rpc("ensure_break_glass_platform_session", {
    p_user_id: input.userId,
    p_auth_session_id: binding.authSessionId,
    p_auth_iat: binding.authIat,
    p_activity: activity,
    p_allow_create: true,
  });
  if (error) {
    console.error("ensure_break_glass_platform_session", error.message);
    return { active: false, expiredReason: "invalid" };
  }

  const row = (data ?? {}) as Record<string, unknown>;
  if (row.active !== true) {
    const reason = String(row.reason ?? "invalid");
    // Advisory UI cookie when locked/expired.
    if (
      reason === "same_auth_session_locked" ||
      reason === "absolute_expired" ||
      reason === "idle_expired" ||
      reason === "auth_session_id_required"
    ) {
      try {
        const h = hmac();
        await setBgCookie(
          BREAK_GLASS_EXPIRED_COOKIE,
          encodeSignedBgValue(`${input.userId}|${reason}|${new Date().toISOString()}`, h),
          BREAK_GLASS_LOCK_COOKIE_MAX_AGE_SEC,
        );
      } catch {
        /* ignore */
      }
    }
    const mapped =
      reason === "same_auth_session_locked" || reason === "auth_session_id_required"
        ? ("auth_bind_blocked" as const)
        : reason === "not_break_glass" || reason === "not_super_owner"
          ? (reason as "not_break_glass" | "not_super_owner")
          : reason === "absolute_expired" || reason === "idle_expired"
            ? (reason as "absolute_expired" | "idle_expired")
            : ("invalid" as const);
    return { active: false, expiredReason: mapped };
  }

  const startedAt = String(row.started_at ?? "");
  const lastActivityAt = String(row.last_activity_at ?? startedAt);
  const absoluteExpiresAt = String(row.absolute_expires_at ?? "");
  if (startedAt && absoluteExpiresAt) {
    await rehydrateBgSessionCookies({
      userId: input.userId,
      startedAt,
      lastActivityAt,
      absoluteExpiresAt,
    });
  }
  return {
    active: true,
    startedAt,
    absoluteExpiresAt,
  };
}

/** Meaningful-activity idle touch via RPC (never creates a session). */
export async function touchBreakGlassPlatformSession(input: {
  userId: string;
  activity: BreakGlassSessionActivity;
}): Promise<{ active: boolean; touched: boolean }> {
  if (!shouldTouchBreakGlassIdle(input.activity)) {
    return { active: false, touched: false };
  }
  const binding = await readAuthBinding();
  const { data, error } = await db.rpc("touch_break_glass_platform_session", {
    p_user_id: input.userId,
    p_auth_session_id: binding.authSessionId,
    p_activity: input.activity,
  });
  if (error) {
    console.error("touch_break_glass_platform_session", error.message);
    return { active: false, touched: false };
  }
  const row = (data ?? {}) as Record<string, unknown>;
  return { active: row.active === true, touched: row.touched === true };
}

export async function endBreakGlassPlatformSession(input: {
  userId: string;
  endReason?:
    | "logout"
    | "absolute_expired"
    | "idle_expired"
    | "classification_removed"
    | "role_removed"
    | "replaced";
}): Promise<{ ended: boolean }> {
  const { data, error } = await db.rpc("end_break_glass_platform_session", {
    p_user_id: input.userId,
    p_end_reason: input.endReason ?? "logout",
  });
  if (error) {
    console.error("end_break_glass_platform_session", error.message);
    return { ended: false };
  }
  const row = (data ?? {}) as Record<string, unknown>;
  return { ended: row.ended === true };
}

export async function isBreakGlassPlatformSessionActive(userId: string): Promise<boolean> {
  const { data, error } = await db.rpc("is_break_glass_platform_session_active", {
    p_user_id: userId,
  });
  if (error) {
    console.error("is_break_glass_platform_session_active", error.message);
    return false;
  }
  return data === true;
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
  // 1) Authoritative server session end (must succeed path even if audit fails later).
  try {
    await endBreakGlassPlatformSession({ userId: id, endReason: "logout" });
  } catch (err) {
    console.error("break_glass_logout_end_session", err);
  }
  // 2) Clear advisory cookies.
  await clearBreakGlassPlatformSessionCookies();
  // 3) Best-effort logout audit — must not block Auth logout.
  try {
    const status = await resolveBreakGlassStatus(id);
    if (status.isBreakGlass) {
      await writeBreakGlassAuditBestEffort({
        eventType: "BREAK_GLASS_LOGOUT",
        actingUserId: id,
        metadata: { source: "sign_out" },
      });
    }
  } catch (err) {
    console.error("break_glass_logout_audit", err);
  }
}

// Registry / lifecycle (cookie-free) — re-exported for existing importers.
export {
  resolveBreakGlassStatus,
  writeBreakGlassAuditBestEffort,
  establishBreakGlassIdentityRpc,
  establishBreakGlassIdentityImpl,
  type EstablishBreakGlassIdentityResult,
} from "@/lib/break-glass-registry.server";
