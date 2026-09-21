import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  type AdminAccess,
  type AdminLevel,
  type PermissionAccess,
  type PermissionKey,
  DEFAULT_GENERAL_PERMISSIONS,
  PERMISSION_KEYS,
  canEditAdminPermissions,
  canGrantAdminLevel,
} from "@/lib/admin-access";

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const msg = (error.message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

/**
 * Firm owner emails — listing / bootstrap DISPLAY only.
 * P2: ADMIN_EMAILS must not grant tenant-admin authority. resolveAdminAccess
 * ignores email. Keep this helper for listAdmins owner badges until G7.
 */
const BUILTIN_OWNER_EMAILS = ["pmabbott2@aol.com"];

function parseOwnerEmails(): string[] {
  const fromEnv = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (fromEnv.length) return fromEnv;
  return [...BUILTIN_OWNER_EMAILS];
}

function isOwnerEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  return parseOwnerEmails().includes(email.trim().toLowerCase());
}

function resolveListedAdminLevel(
  userId: string,
  profileEmail: string | null | undefined,
  levelByUser: Map<string, AdminLevel>,
  profilesMissing: boolean,
): AdminLevel {
  if (isOwnerEmail(profileEmail)) return "owner";
  const stored = levelByUser.get(userId);
  if (stored) return stored;
  // Pre-migration: no admin_profiles rows yet — show as General Admin so the
  // permission matrix stays visible until SQL is applied.
  if (profilesMissing) return "general";
  return "general";
}

async function assertAdminTablesReady(error: { code?: string; message?: string } | null): void {
  if (error && isMissingTable(error)) {
    throw new Error(
      "Admin levels are not set up in Supabase yet. Paste and run supabase/RUN_ADMIN_AND_BIN.sql in the SQL Editor, then refresh this page.",
    );
  }
  if (error) throw new Error(error.message);
}

/**
 * Resolve tenant admin access for the acting tenant.
 *
 * P2: tenant_memberships.role is authoritative. `claimsEmail` is ignored for
 * tenant authority (legacy signature). ADMIN_EMAILS / user_roles / admin_profiles.level
 * must not grant Owner in another tenant.
 *
 * When tenantId is omitted, the sole active membership is used. Dual membership
 * without an explicit tenant returns empty (non-admin) access — never 001.
 */
export async function resolveAdminAccess(
  userId: string,
  _claimsEmail?: string,
  tenantId?: string | null,
): Promise<AdminAccess> {
  const { resolveActingTenantRole } = await import("@/lib/tenant-role.server");
  const view = await resolveActingTenantRole(userId, null, tenantId);
  return view.adminAccess;
}

export async function requireAdminAccess(userId: string, email?: string): Promise<AdminAccess> {
  const access = await resolveAdminAccess(userId, email);
  if (!access.isAdmin) throw new Error("Forbidden");
  return access;
}

export const getMyAdminAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        tenantSlug: z.string().min(1).max(64).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { resolveActingTenantRole } = await import("@/lib/tenant-role.server");
    const view = await resolveActingTenantRole(context.userId, data.tenantSlug ?? null);
    return view.adminAccess;
  });

function classifySupabaseKey(value: string | undefined): string {
  if (!value) return "missing";
  if (value.startsWith("sb_secret_")) return "sb_secret";
  if (value.startsWith("sb_publishable_")) return "sb_publishable";
  if (value.startsWith("eyJ")) {
    try {
      const payload = JSON.parse(
        Buffer.from(value.split(".")[1]!, "base64url").toString("utf8"),
      ) as { role?: string };
      return `jwt:${payload.role ?? "unknown"}`;
    } catch {
      return "jwt:unknown";
    }
  }
  return "other";
}

/** Owner-only: diagnose Azure Supabase key misconfig without exposing secrets. */
export const diagnoseSupabaseAdminConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await requireAdminAccess(context.userId, email);
    if (!access.isOwner) throw new Error("Owner only");

    const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "")
      .trim()
      .replace(/\/+$/, "");
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    const publishable = (
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      ""
    ).trim();

    const serviceRoleKind = classifySupabaseKey(serviceRole);
    const publishableKind = classifySupabaseKey(publishable);
    const serviceRoleIsPublishable =
      serviceRoleKind === "sb_publishable" ||
      Boolean(serviceRole && publishable && serviceRole === publishable);

    let authAdminOk = false;
    let authAdminError: string | null = null;
    if (url && serviceRole && !serviceRoleIsPublishable) {
      try {
        const res = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=1`, {
          headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
        });
        const body = await res.text();
        authAdminOk = res.ok;
        if (!res.ok) {
          try {
            authAdminError = (JSON.parse(body) as { msg?: string }).msg ?? `HTTP ${res.status}`;
          } catch {
            authAdminError = `HTTP ${res.status}`;
          }
        }
      } catch (e) {
        authAdminError = e instanceof Error ? e.message : "network error";
      }
    } else if (serviceRoleIsPublishable) {
      authAdminError =
        "SUPABASE_SERVICE_ROLE_KEY is a publishable key — Auth Admin will fail with “valid Bearer token”.";
    } else if (!serviceRole) {
      authAdminError = "SUPABASE_SERVICE_ROLE_KEY is missing on this host.";
    }

    return {
      supabaseUrlHost: url ? new URL(url).host : null,
      serviceRoleKind,
      publishableKind,
      serviceRoleIsPublishable,
      authAdminOk,
      authAdminError,
      appBaseUrl: (process.env.APP_BASE_URL || process.env.VITE_APP_URL || "").trim() || null,
    };
  });

export const listAdmins = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await requireAdminAccess(context.userId, email);
    if (!access.isOwner && !access.isSupervisor) throw new Error("Forbidden");

    const { resolveActingTenantRole, listTenantMemberUserIds } = await import(
      "@/lib/tenant-role.server"
    );
    const view = await resolveActingTenantRole(context.userId);
    if (!view.tenantId) return { admins: [], migrationRequired: false };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ids = await listTenantMemberUserIds(view.tenantId, ["owner", "supervisor", "general"]);

    const { error: adminProfilesProbe } = await supabaseAdmin
      .from("admin_profiles")
      .select("user_id")
      .limit(1);
    const migrationRequired = Boolean(
      adminProfilesProbe && isMissingTable(adminProfilesProbe),
    );

    if (ids.length === 0) return { admins: [], migrationRequired };

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", ids);
    const { data: adminProfiles, error: adminProfilesError } = await supabaseAdmin
      .from("admin_profiles")
      .select("user_id, level")
      .in("user_id", ids);
    const { data: perms, error: permsError } = await supabaseAdmin
      .from("admin_permissions")
      .select("user_id, permission_key, access")
      .in("user_id", ids);

    const profilesMissing =
      migrationRequired || Boolean(adminProfilesError && isMissingTable(adminProfilesError));
    const permissionsMissing = Boolean(permsError && isMissingTable(permsError));
    const levelByUser = new Map(
      (adminProfiles ?? []).map((p) => [p.user_id, p.level as AdminLevel]),
    );
    const permsByUser = new Map<string, Record<PermissionKey, PermissionAccess>>();
    for (const id of ids) {
      permsByUser.set(id, { ...DEFAULT_GENERAL_PERMISSIONS });
    }
    for (const p of perms ?? []) {
      const map = permsByUser.get(p.user_id);
      if (!map) continue;
      const key = p.permission_key as PermissionKey;
      if (PERMISSION_KEYS.includes(key)) map[key] = p.access as PermissionAccess;
    }

    const levelOrder: Record<AdminLevel, number> = { owner: 0, supervisor: 1, general: 2 };

    return {
      admins: (profiles ?? [])
        .map((p) => {
          const level = resolveListedAdminLevel(p.id, p.email, levelByUser, profilesMissing);
          const defaults = { ...DEFAULT_GENERAL_PERMISSIONS };
          return {
            userId: p.id,
            fullName: p.full_name,
            email: p.email,
            level,
            permissions:
              level === "general" && !permissionsMissing
                ? permsByUser.get(p.id)!
                : defaults,
          };
        })
        .sort((a, b) => levelOrder[a.level] - levelOrder[b.level]),
      migrationRequired,
    };
  });

export const setAdminLevel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        level: z.enum(["supervisor", "general", "none"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await requireAdminAccess(context.userId, email);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Cannot change owner accounts.
    const { data: targetProfile } = await supabaseAdmin
      .from("admin_profiles")
      .select("level")
      .eq("user_id", data.userId)
      .maybeSingle();
    if (targetProfile?.level === "owner") throw new Error("Cannot change the owner account.");

    const { data: targetUser } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    const targetEmail = targetUser.user?.email?.toLowerCase();
    if (isOwnerEmail(targetEmail)) {
      throw new Error("Cannot change the owner account.");
    }

    if (data.level === "supervisor") {
      if (!canGrantAdminLevel(access, "supervisor")) throw new Error("Only the owner can grant Admin Supervisor.");
      await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: data.userId, role: "admin" }, { onConflict: "user_id,role" });
      const { error: profileErr } = await supabaseAdmin.from("admin_profiles").upsert(
        {
          user_id: data.userId,
          level: "supervisor",
          granted_by: context.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      await assertAdminTablesReady(profileErr);
      const { error: delErr } = await supabaseAdmin
        .from("admin_permissions")
        .delete()
        .eq("user_id", data.userId);
      if (delErr && !isMissingTable(delErr)) throw new Error(delErr.message);
      return { ok: true };
    }

    if (data.level === "general") {
      if (!canGrantAdminLevel(access, "general")) throw new Error("Forbidden");
      await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: data.userId, role: "admin" }, { onConflict: "user_id,role" });
      const { error: profileErr } = await supabaseAdmin.from("admin_profiles").upsert(
        {
          user_id: data.userId,
          level: "general",
          granted_by: context.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      await assertAdminTablesReady(profileErr);
      // Seed default permissions if none exist.
      const { data: existing, error: existingErr } = await supabaseAdmin
        .from("admin_permissions")
        .select("id")
        .eq("user_id", data.userId)
        .limit(1);
      await assertAdminTablesReady(existingErr);
      if (!existing?.length) {
        const rows = PERMISSION_KEYS.map((key) => ({
          user_id: data.userId,
          permission_key: key,
          access: DEFAULT_GENERAL_PERMISSIONS[key],
        }));
        const { error: insErr } = await supabaseAdmin.from("admin_permissions").insert(rows);
        await assertAdminTablesReady(insErr);
      }
      return { ok: true };
    }

    // Remove admin.
    if (!access.isOwner && !access.isSupervisor) throw new Error("Forbidden");
    if (targetProfile?.level === "supervisor" && !access.isOwner) {
      throw new Error("Only the owner can remove an Admin Supervisor.");
    }
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId).eq("role", "admin");
    await supabaseAdmin.from("admin_profiles").delete().eq("user_id", data.userId);
    await supabaseAdmin.from("admin_permissions").delete().eq("user_id", data.userId);
    return { ok: true };
  });

export const setAdminPermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        permissions: z.record(z.enum(["none", "view", "amend"])),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    const access = await requireAdminAccess(context.userId, email);
    if (!canEditAdminPermissions(access)) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile } = await supabaseAdmin
      .from("admin_profiles")
      .select("level")
      .eq("user_id", data.userId)
      .maybeSingle();
    if (profile?.level !== "general") {
      throw new Error("Permissions only apply to General Admins.");
    }

    await supabaseAdmin.from("admin_permissions").delete().eq("user_id", data.userId);
    const rows = PERMISSION_KEYS.map((key) => ({
      user_id: data.userId,
      permission_key: key,
      access: (data.permissions[key] as PermissionAccess) ?? "none",
    }));
    await supabaseAdmin.from("admin_permissions").insert(rows);
    return { ok: true };
  });

export const listUsersForAdminGrant = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { resolveActingTenantRole, listTenantMemberUserIds } = await import(
      "@/lib/tenant-role.server"
    );
    const view = await resolveActingTenantRole(context.userId);
    if (!view.isOwner && !view.isSupervisor) throw new Error("Forbidden");
    if (!view.tenantId) return { users: [] as Array<{ id: string; full_name: string | null; email: string | null }> };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ids = await listTenantMemberUserIds(view.tenantId, [
      "owner",
      "supervisor",
      "general",
      "adviser",
    ]);
    if (ids.length === 0) return [];

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", ids)
      .order("full_name", { ascending: true });

    return (profiles ?? []).filter((p) => !isOwnerEmail(p.email));
  });
