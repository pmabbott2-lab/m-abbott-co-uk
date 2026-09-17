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
  emptyPermissions,
  fullPermissions,
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
 * Firm owner emails. ADMIN_EMAILS App Setting / .env is preferred; the builtin
 * list keeps production owner access working if Azure is missing that setting.
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

function ownerAccess(): AdminAccess {
  return {
    isAdmin: true,
    adminLevel: "owner",
    isOwner: true,
    isSupervisor: true,
    permissions: fullPermissions(),
  };
}

function isOwnerEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  return parseOwnerEmails().includes(email.trim().toLowerCase());
}

/** JWT claims may omit email — fall back to the profiles table. */
async function resolveAuthEmail(
  userId: string,
  claimsEmail?: string,
): Promise<string | undefined> {
  const fromClaims = claimsEmail?.trim().toLowerCase();
  if (fromClaims) return fromClaims;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle();
  return profile?.email?.trim().toLowerCase() || undefined;
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

async function getRoles(userId: string): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  return (data ?? []).map((r) => r.role);
}

async function ensureOwnerBootstrap(userId: string, email: string | undefined): Promise<void> {
  if (!isOwnerEmail(email)) return;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Original owner design: admin + advisor roles, admin_profiles.level = owner.
  // Staff nav already hides advisor-only "My commission" when isMainAdmin.
  await supabaseAdmin
    .from("user_roles")
    .upsert({ user_id: userId, role: "admin" }, { onConflict: "user_id,role" });
  await supabaseAdmin
    .from("user_roles")
    .upsert({ user_id: userId, role: "advisor" }, { onConflict: "user_id,role" });
  // Strip roles that pollute owner nav (introducer portal / customer home).
  await supabaseAdmin
    .from("user_roles")
    .delete()
    .eq("user_id", userId)
    .in("role", ["customer", "introducer"]);

  const { error } = await supabaseAdmin.from("admin_profiles").upsert(
    { user_id: userId, level: "owner", updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (error && !isMissingTable(error)) console.error("owner bootstrap", error);
}

/** Resolve admin level + permission matrix for a user. */
export async function resolveAdminAccess(
  userId: string,
  claimsEmail?: string,
): Promise<AdminAccess> {
  const email = await resolveAuthEmail(userId, claimsEmail);
  if (email) await ensureOwnerBootstrap(userId, email);

  // Owner emails always get full owner access (Finance, Management, Admin access, etc.).
  if (isOwnerEmail(email)) {
    return ownerAccess();
  }

  const roles = await getRoles(userId);
  const isAdmin = roles.includes("admin");
  if (!isAdmin) {
    return {
      isAdmin: false,
      adminLevel: null,
      isOwner: false,
      isSupervisor: false,
      permissions: emptyPermissions(),
    };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: profile, error } = await supabaseAdmin
    .from("admin_profiles")
    .select("level")
    .eq("user_id", userId)
    .maybeSingle();

  // Pre-migration / lookup failure: never silently demote — that hides Finance/Admin.
  if (error) {
    if (isMissingTable(error)) {
      return {
        isAdmin: true,
        adminLevel: "supervisor",
        isOwner: false,
        isSupervisor: true,
        permissions: fullPermissions(),
      };
    }
    console.error("admin_profiles lookup failed", error);
    return {
      isAdmin: true,
      adminLevel: "supervisor",
      isOwner: false,
      isSupervisor: true,
      permissions: fullPermissions(),
    };
  }

  let level = (profile?.level as AdminLevel | undefined) ?? "general";

  if (level === "owner") {
    return ownerAccess();
  }

  if (level === "supervisor") {
    return {
      isAdmin: true,
      adminLevel: "supervisor",
      isOwner: false,
      isSupervisor: true,
      permissions: fullPermissions(),
    };
  }

  const permissions = { ...DEFAULT_GENERAL_PERMISSIONS };
  const { data: rows } = await supabaseAdmin
    .from("admin_permissions")
    .select("permission_key, access")
    .eq("user_id", userId);
  for (const row of rows ?? []) {
    const key = row.permission_key as PermissionKey;
    if (PERMISSION_KEYS.includes(key)) {
      permissions[key] = row.access as PermissionAccess;
    }
  }

  return {
    isAdmin: true,
    adminLevel: "general",
    isOwner: false,
    isSupervisor: false,
    permissions,
  };
}

export async function requireAdminAccess(userId: string, email?: string): Promise<AdminAccess> {
  const access = await resolveAdminAccess(userId, email);
  if (!access.isAdmin) throw new Error("Forbidden");
  return access;
}

export const getMyAdminAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string }).email;
    return resolveAdminAccess(context.userId, email);
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

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roleRows } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    const ids = [...new Set((roleRows ?? []).map((r) => r.user_id))];

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
    const email = (context.claims as { email?: string }).email;
    const access = await requireAdminAccess(context.userId, email);
    if (!access.isOwner && !access.isSupervisor) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ids = new Set<string>();

    const { data: invites } = await supabaseAdmin
      .from("staff_invitations")
      .select("used_by, email")
      .eq("role", "admin");
    for (const i of invites ?? []) {
      if (i.used_by) ids.add(i.used_by as string);
    }

    const { data: roleRows } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin");
    for (const r of roleRows ?? []) ids.add(r.user_id);

    const { data: adminProfiles } = await supabaseAdmin.from("admin_profiles").select("user_id");
    for (const p of adminProfiles ?? []) ids.add(p.user_id);

    // Unused invite emails (e.g. test admin) — match existing profiles so they can be granted.
    const unusedEmails = [...new Set(
      (invites ?? [])
        .filter((i) => !i.used_by && i.email)
        .map((i) => (i.email as string).trim().toLowerCase()),
    )];
    if (unusedEmails.length > 0) {
      const { data: byEmail } = await supabaseAdmin
        .from("profiles")
        .select("id, email")
        .in("email", unusedEmails);
      for (const p of byEmail ?? []) ids.add(p.id);
    }

    const { TEST_ACCOUNTS } = await import("@/lib/test-accounts");
    const testAdminEmails = TEST_ACCOUNTS.filter((a) => a.role === "admin").map((a) => a.email);
    if (testAdminEmails.length > 0) {
      const { data: testProfiles } = await supabaseAdmin
        .from("profiles")
        .select("id, email")
        .in("email", testAdminEmails);
      for (const p of testProfiles ?? []) ids.add(p.id);
    }

    const idList = [...ids];
    if (idList.length === 0) return [];

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", idList)
      .order("full_name", { ascending: true });

    return (profiles ?? []).filter((p) => !isOwnerEmail(p.email));
  });
