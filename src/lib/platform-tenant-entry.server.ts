/**
 * G7D platform tenant entry — server impl (server-only).
 * DB session = source of truth. Cookie holds opaque session id only.
 * Do not import this module from client components — use platform-tenant-entry.functions.ts.
 */
import { supabaseAdminUntyped as db } from "@/integrations/supabase/client.server";
import {
  PLATFORM_TENANT_ACCESS_COOKIE,
  computePlatformAccessExpiresAt,
  emergencyScopeToEntryLevel,
  isSessionTemporallyActive,
  platformAccessAllowsWrite,
  platformAccessBasisLabel,
  supportScopeToEntryLevel,
  superAdminGrantToEntryLevel,
  type PlatformTenantAccessBasis,
  type PlatformTenantAccessLevel,
  type PlatformTenantAccessSessionView,
} from "@/lib/platform-tenant-entry";
import { getAppEnvironment } from "@/lib/app-environment.server";

export class PlatformTenantEntryError extends Error {
  readonly code:
    | "ENTRY_DENIED"
    | "SESSION_INVALID"
    | "TENANT_INACTIVE"
    | "CROSS_TENANT"
    | "BREAK_GLASS_CONFIRM_REQUIRED"
    | "BREAK_GLASS_REASON_REQUIRED"
    | "BREAK_GLASS_AUDIT_REQUIRED";
  constructor(
    code: PlatformTenantEntryError["code"],
    message = "Platform tenant entry denied.",
  ) {
    super(message);
    this.name = "PlatformTenantEntryError";
    this.code = code;
  }
}

type SessionRow = {
  id: string;
  platform_user_id: string;
  tenant_id: string;
  authority_basis: PlatformTenantAccessBasis;
  access_level: PlatformTenantAccessLevel;
  grant_id: string | null;
  reason: string | null;
  started_at: string;
  expires_at: string;
  ended_at: string | null;
  revoked_at: string | null;
};

function cookieSecure(): boolean {
  const env = getAppEnvironment();
  return env === "staging" || env === "production";
}

async function setAccessCookie(sessionId: string, expiresAt: Date): Promise<void> {
  const { setCookie } = await import("@tanstack/react-start/server");
  setCookie(PLATFORM_TENANT_ACCESS_COOKIE, sessionId, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

async function clearAccessCookie(): Promise<void> {
  const { deleteCookie } = await import("@tanstack/react-start/server");
  deleteCookie(PLATFORM_TENANT_ACCESS_COOKIE, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/",
  });
}

async function readAccessCookie(): Promise<string | null> {
  try {
    const { getCookie } = await import("@tanstack/react-start/server");
    return getCookie(PLATFORM_TENANT_ACCESS_COOKIE)?.trim() || null;
  } catch {
    return null;
  }
}

async function endOpenSessionsForUser(userId: string, exceptId?: string | null): Promise<void> {
  let q = db
    .from("platform_tenant_access_sessions")
    .update({ ended_at: new Date().toISOString() })
    .eq("platform_user_id", userId)
    .is("ended_at", null)
    .is("revoked_at", null);
  if (exceptId) q = q.neq("id", exceptId);
  const { error } = await q;
  if (error) throw new Error(error.message);
}

async function loadTenant(tenantIdOrCode: {
  tenantId?: string;
  companyCode?: string;
}): Promise<{
  id: string;
  slug: string;
  company_name: string;
  company_code: string;
  tenant_type: string;
  status: string;
} | null> {
  if (tenantIdOrCode.tenantId) {
    const { data, error } = await db
      .from("tenants")
      .select("id, slug, company_name, company_code, tenant_type, status")
      .eq("id", tenantIdOrCode.tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }
  if (tenantIdOrCode.companyCode) {
    const { data, error } = await db
      .from("tenants")
      .select("id, slug, company_name, company_code, tenant_type, status")
      .eq("company_code", tenantIdOrCode.companyCode)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }
  return null;
}

async function revalidateBasisViaRpc(
  userId: string,
  tenantId: string,
  basis: PlatformTenantAccessBasis,
  accessLevel: PlatformTenantAccessLevel,
  grantId: string | null,
): Promise<boolean> {
  const { data, error } = await db.rpc("platform_tenant_access_basis_valid_now", {
    p_user_id: userId,
    p_tenant_id: tenantId,
    p_basis: basis,
    p_access_level: accessLevel,
    p_grant_id: grantId,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

export async function validatePlatformTenantAccessSession(input: {
  userId: string;
  tenantId: string;
  sessionId?: string | null;
  requireWrite?: boolean;
}): Promise<PlatformTenantAccessSessionView | null> {
  const cookieId = input.sessionId ?? (await readAccessCookie());
  if (!cookieId) return null;

  const { data: row, error } = await db
    .from("platform_tenant_access_sessions")
    .select(
      "id, platform_user_id, tenant_id, authority_basis, access_level, grant_id, reason, started_at, expires_at, ended_at, revoked_at",
    )
    .eq("id", cookieId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return null;

  const session = row as SessionRow;
  if (session.platform_user_id !== input.userId) return null;
  if (session.tenant_id !== input.tenantId) return null;
  if (
    !isSessionTemporallyActive({
      endedAt: session.ended_at,
      revokedAt: session.revoked_at,
      expiresAt: session.expires_at,
    })
  ) {
    return null;
  }
  if (input.requireWrite && !platformAccessAllowsWrite(session.access_level)) {
    return null;
  }

  const basisOk = await revalidateBasisViaRpc(
    input.userId,
    input.tenantId,
    session.authority_basis,
    session.access_level,
    session.grant_id,
  );
  if (!basisOk) return null;

  const isBreakGlassSession = (session.reason ?? "").startsWith("break_glass:");
  if (isBreakGlassSession) {
    const { resolveBreakGlassStatus, isBreakGlassPlatformSessionActive } = await import(
      "@/lib/break-glass.server"
    );
    const bg = await resolveBreakGlassStatus(input.userId);
    if (!bg.isBreakGlass) return null;
    // BG G7D must not outlive authoritative BG platform session (validation, not cleanup).
    const platformActive = await isBreakGlassPlatformSessionActive(input.userId);
    if (!platformActive) return null;
  }

  const tenant = await loadTenant({ tenantId: input.tenantId });
  if (!tenant || tenant.status !== "active") return null;

  return {
    sessionId: session.id,
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    companyName: tenant.company_name,
    companyCode: tenant.company_code,
    authorityBasis: session.authority_basis,
    accessLevel: session.access_level,
    startedAt: session.started_at,
    expiresAt: session.expires_at,
    basisLabel: platformAccessBasisLabel(session.authority_basis, {
      breakGlass: isBreakGlassSession,
    }),
  };
}

export async function hasValidPlatformTenantAccess(
  userId: string,
  tenantId: string,
  opts?: { requireWrite?: boolean },
): Promise<boolean> {
  const view = await validatePlatformTenantAccessSession({
    userId,
    tenantId,
    requireWrite: opts?.requireWrite,
  });
  return Boolean(view);
}

async function resolveEntryAuthority(
  userId: string,
  tenant: {
    id: string;
    tenant_type: string;
    status: string;
  },
): Promise<{
  basis: PlatformTenantAccessBasis;
  accessLevel: PlatformTenantAccessLevel;
  grantId: string | null;
  reason: string;
} | null> {
  if (tenant.status !== "active") return null;

  const { data: so } = await db.rpc("is_super_owner", { p_user_id: userId });
  if (so === true && tenant.tenant_type === "GROUP") {
    return {
      basis: "super_owner_group_access",
      accessLevel: "operational_admin",
      grantId: null,
      reason: "Explicit Super Owner GROUP entry",
    };
  }

  const { data: sa } = await db.rpc("is_super_admin", { p_user_id: userId });
  if (sa === true) {
    const { data: grants, error } = await db
      .from("super_admin_tenant_access")
      .select("id, access_level, revoked_at, expires_at")
      .eq("user_id", userId)
      .eq("tenant_id", tenant.id)
      .is("revoked_at", null)
      .limit(5);
    if (error) throw new Error(error.message);
    const now = Date.now();
    const grant = (grants ?? []).find((g: { expires_at?: string | null }) => {
      if (!g.expires_at) return true;
      const exp = new Date(g.expires_at).getTime();
      return !Number.isNaN(exp) && now < exp;
    }) as { id: string; access_level: string } | undefined;
    if (grant) {
      const level = superAdminGrantToEntryLevel(grant.access_level);
      if (level) {
        return {
          basis: "super_admin_grant",
          accessLevel: level,
          grantId: grant.id,
          reason: "Explicit Super Admin tenant grant entry",
        };
      }
    }
  }

  const { data: supportRows, error: supportErr } = await db
    .from("tenant_support_access_grants")
    .select("id, scope, expires_at, revoked_at, starts_at")
    .eq("grantee_user_id", userId)
    .eq("tenant_id", tenant.id)
    .is("revoked_at", null)
    .lte("starts_at", new Date().toISOString())
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: false })
    .limit(5);
  if (supportErr) throw new Error(supportErr.message);
  for (const row of supportRows ?? []) {
    const level = supportScopeToEntryLevel(row.scope);
    if (level) {
      return {
        basis: "support_grant",
        accessLevel: level,
        grantId: row.id,
        reason: "Explicit support grant entry",
      };
    }
  }

  const { data: emergencyRows, error: emergencyErr } = await db
    .from("tenant_emergency_access_grants")
    .select("id, scope, expires_at, revoked_at, starts_at")
    .eq("grantee_user_id", userId)
    .eq("tenant_id", tenant.id)
    .is("revoked_at", null)
    .lte("starts_at", new Date().toISOString())
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: false })
    .limit(5);
  if (emergencyErr) throw new Error(emergencyErr.message);
  for (const row of emergencyRows ?? []) {
    const level = emergencyScopeToEntryLevel(row.scope);
    if (level) {
      return {
        basis: "emergency_grant",
        accessLevel: level,
        grantId: row.id,
        reason: "Explicit emergency grant entry",
      };
    }
  }

  return null;
}

async function writeEntryAudit(
  eventType:
    | "PLATFORM_TENANT_ENTRY_STARTED"
    | "PLATFORM_TENANT_ENTRY_ENDED"
    | "PLATFORM_TENANT_ENTRY_DENIED",
  input: {
    actingUserId: string;
    tenantId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    const { writePlatformAuditEvent } = await import("@/lib/platform-audit.server");
    await writePlatformAuditEvent({
      eventType: eventType as never,
      actingUserId: input.actingUserId,
      tenantId: input.tenantId,
      metadata: input.metadata,
    });
  } catch {
    /* audit must not block */
  }
}

export async function startPlatformTenantEntryImpl(input: {
  userId: string;
  companyCode: string;
  reason?: string;
  emergencyConfirm?: boolean;
}): Promise<{
  sessionId: string;
  tenantSlug: string;
  companyCode: string;
  companyName: string;
  accessLevel: PlatformTenantAccessLevel;
  authorityBasis: PlatformTenantAccessBasis;
  expiresAt: string;
}> {
  const userId = input.userId;
  const tenant = await loadTenant({ companyCode: input.companyCode });
  if (!tenant || tenant.status !== "active") {
    await writeEntryAudit("PLATFORM_TENANT_ENTRY_DENIED", {
      actingUserId: userId,
      tenantId: tenant?.id ?? null,
      metadata: { reason: "inactive_or_missing", companyCode: input.companyCode },
    });
    throw new PlatformTenantEntryError("TENANT_INACTIVE", "Company is not available for entry.");
  }

  const { resolveBreakGlassStatus, ensureBreakGlassPlatformSession, writeBreakGlassAuditBestEffort } =
    await import("@/lib/break-glass.server");
  const bg = await resolveBreakGlassStatus(userId);
  const { BREAK_GLASS_G7D_MAX_HOURS } = await import("@/lib/break-glass");

  const authority = await resolveEntryAuthority(userId, tenant);
  if (!authority) {
    await writeEntryAudit("PLATFORM_TENANT_ENTRY_DENIED", {
      actingUserId: userId,
      tenantId: tenant.id,
      metadata: {
        reason: "authority_denied",
        companyCode: tenant.company_code,
        tenantType: tenant.tenant_type,
        isBreakGlass: bg.isBreakGlass,
      },
    });
    throw new PlatformTenantEntryError("ENTRY_DENIED");
  }

  // BG GROUP entry: mandatory emergency confirm + reason. EXTERNAL still denied via resolveEntryAuthority.
  let sessionReason = authority.reason;
  let maxHours = undefined as number | undefined;
  if (bg.isBreakGlass && authority.basis === "super_owner_group_access") {
    if (!input.emergencyConfirm) {
      throw new PlatformTenantEntryError(
        "BREAK_GLASS_CONFIRM_REQUIRED",
        "Confirm emergency platform access to enter this company.",
      );
    }
    const reason = (input.reason ?? "").trim();
    if (reason.length < 1) {
      throw new PlatformTenantEntryError(
        "BREAK_GLASS_REASON_REQUIRED",
        "A reason is required for break-glass emergency access.",
      );
    }
    sessionReason = `break_glass:${reason}`.slice(0, 500);
    maxHours = BREAK_GLASS_G7D_MAX_HOURS;
    const bgSession = await ensureBreakGlassPlatformSession({
      userId,
      isBreakGlass: true,
      isSuperOwner: true,
      activity: "g7d_entry",
    });
    if (!bgSession.active) {
      throw new PlatformTenantEntryError(
        "BREAK_GLASS_SESSION_REQUIRED",
        "Break-glass platform session is not active. Re-authenticate to continue emergency access.",
      );
    }
  }

  await endOpenSessionsForUser(userId);

  const startedAt = new Date();
  let grantExpires: string | null = null;
  if (authority.grantId && authority.basis === "support_grant") {
    const { data: g } = await db
      .from("tenant_support_access_grants")
      .select("expires_at")
      .eq("id", authority.grantId)
      .maybeSingle();
    grantExpires = g?.expires_at ?? null;
  }
  if (authority.grantId && authority.basis === "emergency_grant") {
    const { data: g } = await db
      .from("tenant_emergency_access_grants")
      .select("expires_at")
      .eq("id", authority.grantId)
      .maybeSingle();
    grantExpires = g?.expires_at ?? null;
  }
  const expiresAt = computePlatformAccessExpiresAt(startedAt, grantExpires, maxHours);

  const { data: created, error } = await db
    .from("platform_tenant_access_sessions")
    .insert({
      platform_user_id: userId,
      tenant_id: tenant.id,
      authority_basis: authority.basis,
      access_level: authority.accessLevel,
      grant_id: authority.grantId,
      reason: sessionReason,
      started_at: startedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    })
    .select("id, started_at, expires_at")
    .single();
  if (error || !created) throw new Error(error?.message || "Failed to create access session.");

  await setAccessCookie(created.id, expiresAt);
  await writeEntryAudit("PLATFORM_TENANT_ENTRY_STARTED", {
    actingUserId: userId,
    tenantId: tenant.id,
    metadata: {
      sessionId: created.id,
      companyCode: tenant.company_code,
      slug: tenant.slug,
      authorityBasis: authority.basis,
      accessLevel: authority.accessLevel,
      isBreakGlass: bg.isBreakGlass,
    },
  });

  if (bg.isBreakGlass && authority.basis === "super_owner_group_access") {
    const bgStart = await writeBreakGlassAuditBestEffort({
      eventType: "BREAK_GLASS_TENANT_ENTRY_STARTED",
      actingUserId: userId,
      tenantId: tenant.id,
      metadata: {
        sessionId: created.id,
        companyCode: tenant.company_code,
        accessLevel: authority.accessLevel,
        authorityBasis: authority.basis,
        reason: (input.reason ?? "").trim().slice(0, 200),
      },
    });
    // Higher-risk transition: fail closed if durable BG START audit cannot be written.
    if (!bgStart.written) {
      await db
        .from("platform_tenant_access_sessions")
        .update({
          ended_at: new Date().toISOString(),
          revoked_at: new Date().toISOString(),
        })
        .eq("id", created.id);
      await clearAccessCookie();
      throw new PlatformTenantEntryError(
        "BREAK_GLASS_AUDIT_REQUIRED",
        "Emergency company entry could not be recorded. Access was not granted.",
      );
    }
  }

  return {
    sessionId: created.id as string,
    tenantSlug: tenant.slug as string,
    companyCode: tenant.company_code as string,
    companyName: tenant.company_name as string,
    accessLevel: authority.accessLevel,
    authorityBasis: authority.basis,
    expiresAt: created.expires_at as string,
  };
}

export async function endPlatformTenantEntryImpl(userId: string): Promise<{ ok: true }> {
  const cookieId = await readAccessCookie();
  if (cookieId) {
    const { data: row } = await db
      .from("platform_tenant_access_sessions")
      .select("id, tenant_id, authority_basis, access_level, reason")
      .eq("id", cookieId)
      .eq("platform_user_id", userId)
      .maybeSingle();
    if (row) {
      await db
        .from("platform_tenant_access_sessions")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", row.id)
        .is("ended_at", null);
      await writeEntryAudit("PLATFORM_TENANT_ENTRY_ENDED", {
        actingUserId: userId,
        tenantId: row.tenant_id,
        metadata: {
          sessionId: row.id,
          authorityBasis: row.authority_basis,
          accessLevel: row.access_level,
        },
      });
      if ((row.reason ?? "").startsWith("break_glass:")) {
        const { writeBreakGlassAuditBestEffort, ensureBreakGlassPlatformSession, resolveBreakGlassStatus } =
          await import("@/lib/break-glass.server");
        await writeBreakGlassAuditBestEffort({
          eventType: "BREAK_GLASS_TENANT_ENTRY_ENDED",
          actingUserId: userId,
          tenantId: row.tenant_id,
          metadata: {
            sessionId: row.id,
            endReason: "manual_exit",
            authorityBasis: row.authority_basis,
            accessLevel: row.access_level,
          },
        });
        const bg = await resolveBreakGlassStatus(userId);
        if (bg.isBreakGlass) {
          await ensureBreakGlassPlatformSession({
            userId,
            isBreakGlass: true,
            isSuperOwner: true,
            activity: "g7d_exit",
          });
        }
      }
    }
  }
  await endOpenSessionsForUser(userId);
  await clearAccessCookie();
  return { ok: true as const };
}

export async function getMyPlatformTenantAccessImpl(input: {
  userId: string;
  tenantSlug?: string;
  companyCode?: string;
}): Promise<PlatformTenantAccessSessionView | null> {
  let tenantId: string | null = null;
  if (input.companyCode) {
    const t = await loadTenant({ companyCode: input.companyCode });
    tenantId = t?.id ?? null;
  } else if (input.tenantSlug) {
    const { data: t, error } = await db
      .from("tenants")
      .select("id")
      .eq("slug", input.tenantSlug.trim().toLowerCase())
      .maybeSingle();
    if (error) throw new Error(error.message);
    tenantId = t?.id ?? null;
  } else {
    const cookieId = await readAccessCookie();
    if (!cookieId) return null;
    const { data: row } = await db
      .from("platform_tenant_access_sessions")
      .select("tenant_id")
      .eq("id", cookieId)
      .eq("platform_user_id", input.userId)
      .maybeSingle();
    tenantId = row?.tenant_id ?? null;
  }
  if (!tenantId) return null;
  return validatePlatformTenantAccessSession({
    userId: input.userId,
    tenantId,
  });
}

/** Clear cookie + end sessions on logout (best effort; server request context only). */
export async function clearPlatformTenantEntryOnLogout(userId: string | null | undefined): Promise<void> {
  if (userId) {
    try {
      await endOpenSessionsForUser(userId);
    } catch {
      /* ignore */
    }
  }
  try {
    await clearAccessCookie();
  } catch {
    /* ignore when no request context */
  }
}
