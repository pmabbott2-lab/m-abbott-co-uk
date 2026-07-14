/**
 * Microsoft Teams / Outlook calendar — OAuth + Graph helpers (server-only).
 *
 * Env required:
 *   TEAMS_CLIENT_ID
 *   TEAMS_CLIENT_SECRET
 *   TEAMS_TENANT_ID          (directory id, or "common" for multi-tenant)
 * Optional:
 *   TEAMS_TOKEN_SECRET       (HMAC/encrypt for stored tokens; falls back to service role key)
 *   VITE_APP_URL / APP_BASE_URL for redirect origin
 */

import { createHmac, createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { getServerAppOrigin } from "@/lib/app-url.server";

const SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Calendars.ReadWrite",
  "OnlineMeetings.ReadWrite",
].join(" ");

export type AdvisorTeamsTokens = {
  userId: string;
  msUserId: string | null;
  msCalendarId: string | null;
  msAccountEmail: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: string | null;
  enabled: boolean;
  linkedAt: string | null;
};

function teamsConfigured(): boolean {
  return Boolean(
    process.env.TEAMS_CLIENT_ID?.trim() &&
      process.env.TEAMS_CLIENT_SECRET?.trim() &&
      process.env.TEAMS_TENANT_ID?.trim(),
  );
}

export function isTeamsCalendarConfigured(): boolean {
  return teamsConfigured();
}

function tenant(): string {
  return process.env.TEAMS_TENANT_ID!.trim();
}

function clientId(): string {
  return process.env.TEAMS_CLIENT_ID!.trim();
}

function clientSecret(): string {
  return process.env.TEAMS_CLIENT_SECRET!.trim();
}

function tokenSecret(): string {
  return (
    process.env.TEAMS_TOKEN_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "dev-insecure-teams-token-secret"
  );
}

function redirectUri(request?: Request): string {
  return `${getServerAppOrigin(request)}/api/teams/callback`;
}

function deriveKey(): Buffer {
  return scryptSync(tokenSecret(), "teams-calendar-v1", 32);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${enc.toString("base64url")}`;
}

export function decryptSecret(payload: string): string {
  if (!payload.startsWith("v1:")) return payload;
  const [, ivB64, tagB64, dataB64] = payload.split(":");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(),
    Buffer.from(ivB64, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function signOAuthState(userId: string): string {
  const exp = Date.now() + 15 * 60 * 1000;
  const payload = `${userId}.${exp}`;
  const sig = createHmac("sha256", tokenSecret()).update(payload).digest("base64url");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

export function verifyOAuthState(state: string): string {
  const raw = Buffer.from(state, "base64url").toString("utf8");
  const [userId, expStr, sig] = raw.split(".");
  if (!userId || !expStr || !sig) throw new Error("Invalid OAuth state");
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) throw new Error("OAuth state expired");
  const payload = `${userId}.${exp}`;
  const expected = createHmac("sha256", tokenSecret()).update(payload).digest("base64url");
  if (sig !== expected) throw new Error("OAuth state signature mismatch");
  return userId;
}

export function buildTeamsAuthorizeUrl(userId: string, request?: Request): string {
  if (!teamsConfigured()) {
    throw new Error(
      "Teams calendar is not configured. Add TEAMS_CLIENT_ID, TEAMS_CLIENT_SECRET and TEAMS_TENANT_ID to .env",
    );
  }
  const params = new URLSearchParams({
    client_id: clientId(),
    response_type: "code",
    redirect_uri: redirectUri(request),
    response_mode: "query",
    scope: SCOPES,
    state: signOAuthState(userId),
    prompt: "select_account",
  });
  return `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/authorize?${params}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
};

async function exchangeCode(code: string, request?: Request): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: clientId(),
    client_secret: clientSecret(),
    code,
    redirect_uri: redirectUri(request),
    grant_type: "authorization_code",
    scope: SCOPES,
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Microsoft token exchange failed: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as TokenResponse;
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: clientId(),
    client_secret: clientSecret(),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: SCOPES,
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Microsoft token refresh failed: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as TokenResponse;
}

async function graphGet<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph GET ${path} failed: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

async function graphJson<T>(
  accessToken: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T | null> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph ${method} ${path} failed: ${text.slice(0, 300)}`);
  }
  if (res.status === 202) return null;
  return (await res.json()) as T;
}

export async function completeTeamsOAuth(
  code: string,
  advisorUserId: string,
  request?: Request,
): Promise<{ email: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const tokens = await exchangeCode(code, request);
  const me = await graphGet<{ id: string; mail?: string; userPrincipalName?: string }>(
    tokens.access_token,
    "/me",
  );
  const email = me.mail || me.userPrincipalName || null;
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  const patch = {
    ms_user_id: me.id,
    ms_calendar_id: "primary",
    ms_account_email: email,
    ms_access_token: encryptSecret(tokens.access_token),
    ms_refresh_token: tokens.refresh_token
      ? encryptSecret(tokens.refresh_token)
      : null,
    ms_token_expires_at: expiresAt,
    teams_calendar_enabled: true,
    teams_calendar_linked_at: new Date().toISOString(),
  };

  const { ensureAdvisorCode } = await import("@/lib/sessions.functions");
  await ensureAdvisorCode(advisorUserId);

  const { error } = await supabaseAdmin
    .from("advisor_profiles")
    .update(patch)
    .eq("user_id", advisorUserId);
  if (error) throw new Error(error.message);

  return { email: email ?? "Microsoft account" };
}

async function loadAdvisorTokens(advisorId: string): Promise<AdvisorTeamsTokens | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("advisor_profiles")
    .select(
      "user_id, ms_user_id, ms_calendar_id, ms_account_email, ms_access_token, ms_refresh_token, ms_token_expires_at, teams_calendar_enabled, teams_calendar_linked_at",
    )
    .eq("user_id", advisorId)
    .maybeSingle();
  if (error) {
    if (error.message.includes("ms_access_token") || error.code === "42703") return null;
    throw new Error(error.message);
  }
  if (!data) return null;
  return {
    userId: data.user_id,
    msUserId: data.ms_user_id,
    msCalendarId: data.ms_calendar_id,
    msAccountEmail: data.ms_account_email,
    accessToken: data.ms_access_token ? decryptSecret(data.ms_access_token) : null,
    refreshToken: data.ms_refresh_token ? decryptSecret(data.ms_refresh_token) : null,
    tokenExpiresAt: data.ms_token_expires_at,
    enabled: Boolean(data.teams_calendar_enabled),
    linkedAt: data.teams_calendar_linked_at,
  };
}

async function ensureAccessToken(advisorId: string): Promise<string | null> {
  const row = await loadAdvisorTokens(advisorId);
  if (!row?.enabled || !row.accessToken) return null;

  const expiresMs = row.tokenExpiresAt ? new Date(row.tokenExpiresAt).getTime() : 0;
  if (expiresMs > Date.now() + 60_000) return row.accessToken;
  if (!row.refreshToken) return null;

  try {
    const refreshed = await refreshAccessToken(row.refreshToken);
    const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("advisor_profiles")
      .update({
        ms_access_token: encryptSecret(refreshed.access_token),
        ms_refresh_token: refreshed.refresh_token
          ? encryptSecret(refreshed.refresh_token)
          : encryptSecret(row.refreshToken),
        ms_token_expires_at: expiresAt,
      })
      .eq("user_id", advisorId);
    return refreshed.access_token;
  } catch (e) {
    console.error("Teams token refresh failed", e);
    return null;
  }
}

function toGraphLocalDateTime(iso: string): string {
  // Europe/London wall time without offset — Graph expects local dateTime + timeZone
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}

export type SyncAppointmentInput = {
  appointmentId: string;
  advisorId: string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  startsAt: string;
  endsAt: string;
  notes?: string | null;
  existingEventId?: string | null;
};

export type SyncAppointmentResult = {
  synced: boolean;
  eventId?: string;
  joinUrl?: string | null;
  reason?: string;
};

export async function syncAppointmentToTeams(
  input: SyncAppointmentInput,
): Promise<SyncAppointmentResult> {
  if (!teamsConfigured()) {
    return { synced: false, reason: "not_configured" };
  }

  const accessToken = await ensureAccessToken(input.advisorId);
  if (!accessToken) {
    return { synced: false, reason: "not_linked" };
  }

  const body = {
    subject: `Mortgage appointment — ${input.customerName}`,
    body: {
      contentType: "HTML",
      content: [
        `<p>Customer: <strong>${escapeHtml(input.customerName)}</strong></p>`,
        input.customerPhone ? `<p>Phone: ${escapeHtml(input.customerPhone)}</p>` : "",
        input.customerEmail ? `<p>Email: ${escapeHtml(input.customerEmail)}</p>` : "",
        input.notes ? `<p>Notes: ${escapeHtml(input.notes)}</p>` : "",
        `<p>Synced from Mortgage Hub.</p>`,
      ]
        .filter(Boolean)
        .join(""),
    },
    start: {
      dateTime: toGraphLocalDateTime(input.startsAt),
      timeZone: "Europe/London",
    },
    end: {
      dateTime: toGraphLocalDateTime(input.endsAt),
      timeZone: "Europe/London",
    },
    location: { displayName: "Microsoft Teams meeting" },
    isOnlineMeeting: true,
    onlineMeetingProvider: "teamsForBusiness",
    attendees: input.customerEmail
      ? [
          {
            emailAddress: {
              address: input.customerEmail,
              name: input.customerName,
            },
            type: "required",
          },
        ]
      : [],
  };

  type EventResponse = {
    id: string;
    onlineMeeting?: { joinUrl?: string };
    webLink?: string;
  };

  let event: EventResponse | null;
  if (input.existingEventId) {
    event = await graphJson<EventResponse>(
      accessToken,
      "PATCH",
      `/me/events/${encodeURIComponent(input.existingEventId)}`,
      body,
    );
    // PATCH may return the full event; if null, keep existing id
    const eventId = event?.id ?? input.existingEventId;
    const joinUrl = event?.onlineMeeting?.joinUrl ?? null;
    await persistEventIds(input.appointmentId, eventId, joinUrl);
    return { synced: true, eventId, joinUrl };
  }

  event = await graphJson<EventResponse>(accessToken, "POST", "/me/events", body);
  if (!event?.id) return { synced: false, reason: "graph_empty" };
  const joinUrl = event.onlineMeeting?.joinUrl ?? null;
  await persistEventIds(input.appointmentId, event.id, joinUrl);
  return { synced: true, eventId: event.id, joinUrl };
}

async function persistEventIds(
  appointmentId: string,
  eventId: string,
  joinUrl: string | null,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("appointments")
    .update({ ms_event_id: eventId, ms_join_url: joinUrl })
    .eq("id", appointmentId);
  if (error && !(error.message.includes("ms_event_id") || error.code === "42703")) {
    console.error("persist Teams event id failed", error);
  }
}

export async function deleteTeamsEvent(
  advisorId: string,
  eventId: string | null | undefined,
): Promise<void> {
  if (!eventId || !teamsConfigured()) return;
  const accessToken = await ensureAccessToken(advisorId);
  if (!accessToken) return;
  try {
    await graphJson(accessToken, "DELETE", `/me/events/${encodeURIComponent(eventId)}`);
  } catch (e) {
    console.error("delete Teams event failed", e);
  }
}

export async function disconnectTeamsCalendar(advisorUserId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("advisor_profiles")
    .update({
      teams_calendar_enabled: false,
      ms_access_token: null,
      ms_refresh_token: null,
      ms_token_expires_at: null,
      // keep ms_user_id / email for display until reconnect
    })
    .eq("user_id", advisorUserId);
  if (error) throw new Error(error.message);
}

export async function getTeamsLinkStatus(advisorUserId: string): Promise<{
  configured: boolean;
  linked: boolean;
  email: string | null;
  linkedAt: string | null;
}> {
  const configured = teamsConfigured();
  if (!configured) {
    return { configured: false, linked: false, email: null, linkedAt: null };
  }
  try {
    const row = await loadAdvisorTokens(advisorUserId);
    return {
      configured: true,
      linked: Boolean(row?.enabled && row.refreshToken),
      email: row?.msAccountEmail ?? null,
      linkedAt: row?.linkedAt ?? null,
    };
  } catch {
    return { configured: true, linked: false, email: null, linkedAt: null };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
