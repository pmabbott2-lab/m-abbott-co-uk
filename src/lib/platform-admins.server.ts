/**
 * G7E-2A platform administrator management — server impl (server-only).
 * Super Owner only. Does not create tenant grants, memberships, or G7D sessions.
 */
import { createHash, randomBytes } from "node:crypto";
import { supabaseAdminUntyped as db } from "@/integrations/supabase/client.server";
import {
  isLastSuperOwnerProtectedError,
  isPlatformInviteError,
  LAST_SUPER_OWNER_USER_MESSAGE,
  platformRoleLabel,
  type PlatformAdminRow,
  type PlatformAdminsView,
  type PlatformPendingAdminInvite,
} from "@/lib/platform-admins";
import { isPlatformRole, type PlatformRole } from "@/lib/platform-authority";
import { requireSuperOwner } from "@/lib/platform-authority.server";

export class PlatformAdminError extends Error {
  readonly code:
    | "DENIED"
    | "NOT_FOUND"
    | "LAST_SUPER_OWNER"
    | "ALREADY_HAS_ROLE"
    | "INVALID"
    | "INVITE";
  constructor(code: PlatformAdminError["code"], message: string) {
    super(message);
    this.name = "PlatformAdminError";
    this.code = code;
  }
}

const INVITE_TTL_MS = 7 * 24 * 3600_000;

function hashInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function newInviteToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashInviteToken(raw) };
}

async function writeAdminAudit(
  eventType:
    | "PLATFORM_ADMIN_INVITED"
    | "PLATFORM_ADMIN_INVITE_CANCELLED"
    | "PLATFORM_ROLE_GRANTED"
    | "PLATFORM_ROLE_CHANGED"
    | "PLATFORM_ROLE_REVOKED"
    | "LAST_PLATFORM_OWNER_ACTION_DENIED",
  input: {
    actingUserId: string;
    subjectUserId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    const { writePlatformAuditEvent } = await import("@/lib/platform-audit.server");
    await writePlatformAuditEvent({
      eventType: eventType as never,
      actingUserId: input.actingUserId,
      subjectUserId: input.subjectUserId,
      metadata: input.metadata,
    });
  } catch {
    /* best-effort */
  }
}

async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const normalised = email.trim().toLowerCase();
  const { data: profile } = await db
    .from("profiles")
    .select("id")
    .eq("email", normalised)
    .maybeSingle();
  if (profile?.id) return profile.id as string;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw new Error(error.message);
  const hit = (data.users ?? []).find((u) => (u.email ?? "").toLowerCase() === normalised);
  return hit?.id ?? null;
}

async function loadAuthEmail(userId: string): Promise<string | null> {
  const { data: profile } = await db.from("profiles").select("email").eq("id", userId).maybeSingle();
  if (profile?.email) return String(profile.email).toLowerCase();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error) return null;
  return data.user?.email?.toLowerCase() ?? null;
}

function parseRole(role: string): PlatformRole {
  if (!isPlatformRole(role)) {
    throw new PlatformAdminError("INVALID", "Invalid platform role.");
  }
  return role;
}

export async function listPlatformAdminsImpl(input: {
  userId: string;
}): Promise<PlatformAdminsView> {
  await requireSuperOwner(input.userId);

  const { data: roles, error } = await db
    .from("platform_roles")
    .select("user_id, role, created_at")
    .in("role", ["super_owner", "super_admin"])
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const userIds = [...new Set((roles ?? []).map((r: { user_id: string }) => r.user_id))];
  const profileMap = new Map<string, { full_name: string | null; email: string | null }>();
  if (userIds.length) {
    const { data: profiles } = await db
      .from("profiles")
      .select("id, full_name, email")
      .in("id", userIds);
    for (const p of profiles ?? []) {
      profileMap.set(p.id, { full_name: p.full_name ?? null, email: p.email ?? null });
    }
  }

  const toRow = (r: {
    user_id: string;
    role: string;
    created_at: string | null;
  }): PlatformAdminRow => {
    const profile = profileMap.get(r.user_id);
    return {
      email: profile?.email ?? "(unknown)",
      fullName: profile?.full_name ?? null,
      platformRole: r.role as PlatformRole,
      status: "active",
      createdAt: r.created_at,
    };
  };

  const superOwners = (roles ?? [])
    .filter((r: { role: string }) => r.role === "super_owner")
    .map(toRow);
  const superAdmins = (roles ?? [])
    .filter((r: { role: string }) => r.role === "super_admin")
    .map(toRow);

  const { data: invites, error: invErr } = await db
    .from("platform_invitations")
    .select("email, first_name, last_name, platform_role, expires_at, created_at")
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (invErr) throw new Error(invErr.message);

  const pendingInvites: PlatformPendingAdminInvite[] = (invites ?? []).map(
    (i: {
      email: string;
      first_name: string;
      last_name: string;
      platform_role: string;
      expires_at: string;
      created_at: string;
    }) => ({
      email: i.email,
      fullName: `${i.first_name} ${i.last_name}`.trim(),
      platformRole: i.platform_role as PlatformRole,
      expiresAt: i.expires_at,
      createdAt: i.created_at,
    }),
  );

  return { superOwners, superAdmins, pendingInvites };
}

export async function addPlatformAdministratorImpl(input: {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  platformRole: string;
  confirmSuperOwner?: boolean;
}): Promise<
  | { outcome: "already_has_role"; email: string; platformRole: PlatformRole }
  | { outcome: "granted"; email: string; platformRole: PlatformRole }
  | { outcome: "changed"; email: string; platformRole: PlatformRole; previousRole: PlatformRole }
  | { outcome: "invited"; email: string; platformRole: PlatformRole; expiresAt: string }
> {
  await requireSuperOwner(input.userId);
  const platformRole = parseRole(input.platformRole);
  const email = input.email.trim().toLowerCase();
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!email || !firstName || !lastName) {
    throw new PlatformAdminError("INVALID", "First name, last name, and email are required.");
  }
  if (platformRole === "super_owner" && !input.confirmSuperOwner) {
    throw new PlatformAdminError(
      "INVALID",
      "Explicit confirmation is required to grant Super Owner.",
    );
  }

  const existingUserId = await findAuthUserIdByEmail(email);
  const displayName = `${firstName} ${lastName}`.trim();

  if (existingUserId) {
    const { data: existingRoles, error } = await db
      .from("platform_roles")
      .select("id, role")
      .eq("user_id", existingUserId);
    if (error) throw new Error(error.message);

    const hasRequested = (existingRoles ?? []).some(
      (r: { role: string }) => r.role === platformRole,
    );
    if (hasRequested) {
      return { outcome: "already_has_role", email, platformRole };
    }

    const otherRole = (existingRoles ?? []).find(
      (r: { role: string }) => r.role !== platformRole && isPlatformRole(r.role),
    ) as { id: string; role: PlatformRole } | undefined;

    if (otherRole) {
      // Explicit role change: replace previous platform role with requested one.
      if (otherRole.role === "super_owner" && platformRole !== "super_owner") {
        const { count, error: cErr } = await db
          .from("platform_roles")
          .select("id", { count: "exact", head: true })
          .eq("role", "super_owner")
          .neq("user_id", existingUserId);
        if (cErr) throw new Error(cErr.message);
        if ((count ?? 0) < 1) {
          await writeAdminAudit("LAST_PLATFORM_OWNER_ACTION_DENIED", {
            actingUserId: input.userId,
            subjectUserId: existingUserId,
            metadata: {
              action: "change_role",
              oldRole: platformRoleLabel("super_owner"),
              newRole: platformRoleLabel(platformRole),
              subjectEmail: email,
              subjectName: displayName,
            },
          });
          throw new PlatformAdminError("LAST_SUPER_OWNER", LAST_SUPER_OWNER_USER_MESSAGE);
        }
      }

      const { error: delErr } = await db
        .from("platform_roles")
        .delete()
        .eq("id", otherRole.id)
        .eq("user_id", existingUserId);
      if (delErr) {
        if (isLastSuperOwnerProtectedError(delErr.message)) {
          await writeAdminAudit("LAST_PLATFORM_OWNER_ACTION_DENIED", {
            actingUserId: input.userId,
            subjectUserId: existingUserId,
            metadata: {
              action: "change_role",
              oldRole: platformRoleLabel(otherRole.role),
              newRole: platformRoleLabel(platformRole),
              subjectEmail: email,
            },
          });
          throw new PlatformAdminError("LAST_SUPER_OWNER", LAST_SUPER_OWNER_USER_MESSAGE);
        }
        throw new Error(delErr.message);
      }
    }

    const { error: insErr } = await db.from("platform_roles").insert({
      user_id: existingUserId,
      role: platformRole,
      created_by: input.userId,
    });
    if (insErr) {
      if (insErr.code === "23505" || insErr.message.toLowerCase().includes("unique")) {
        return { outcome: "already_has_role", email, platformRole };
      }
      throw new Error(insErr.message);
    }

    await db
      .from("profiles")
      .upsert({ id: existingUserId, email, full_name: displayName }, { onConflict: "id" });

    if (otherRole) {
      await writeAdminAudit("PLATFORM_ROLE_CHANGED", {
        actingUserId: input.userId,
        subjectUserId: existingUserId,
        metadata: {
          action: "change_platform_role",
          oldRole: platformRoleLabel(otherRole.role),
          newRole: platformRoleLabel(platformRole),
          subjectEmail: email,
          subjectName: displayName,
        },
      });
      return {
        outcome: "changed",
        email,
        platformRole,
        previousRole: otherRole.role,
      };
    }

    await writeAdminAudit("PLATFORM_ROLE_GRANTED", {
      actingUserId: input.userId,
      subjectUserId: existingUserId,
      metadata: {
        action: "grant_platform_role",
        role: platformRoleLabel(platformRole),
        subjectEmail: email,
        subjectName: displayName,
      },
    });
    return { outcome: "granted", email, platformRole };
  }

  // New email → hashed platform_invitations only (no platform_roles yet).
  const { raw: rawToken, hash } = newInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

  // Revoke any prior pending invite for same email before creating a new one.
  await db
    .from("platform_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("email", email)
    .is("accepted_at", null)
    .is("revoked_at", null);

  const { error: invErr } = await db.from("platform_invitations").insert({
    email,
    first_name: firstName,
    last_name: lastName,
    platform_role: platformRole,
    invited_by: input.userId,
    expires_at: expiresAt,
    token_hash: hash,
  });
  if (invErr) throw new Error(invErr.message);

  // Staging/dev: record that an invite was created without live email delivery.
  // Do not store or log the raw token.
  try {
    const { captureExternalAction, getCommunicationDeliveryMode } = await import(
      "@/lib/external-action.server"
    );
    if (getCommunicationDeliveryMode() !== "live") {
      captureExternalAction({
        service: "email",
        action: "send",
        meta: {
          kind: "platform_admin_invite",
          to_domain: email.includes("@") ? email.split("@")[1]! : null,
          role: platformRole,
          expiresAt,
        },
      });
    }
  } catch {
    /* capture optional */
  }
  void rawToken;

  await writeAdminAudit("PLATFORM_ADMIN_INVITED", {
    actingUserId: input.userId,
    metadata: {
      action: "invite_platform_admin",
      role: platformRoleLabel(platformRole),
      subjectEmail: email,
      subjectName: displayName,
    },
  });

  return { outcome: "invited", email, platformRole, expiresAt };
}

/**
 * Creates a platform invitation and returns the raw token once for controlled
 * staging/test fixtures. Ordinary UI must not call this; use addPlatformAdministratorImpl.
 */
export async function createPlatformInvitationForTestsImpl(input: {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  platformRole: string;
}): Promise<{ rawToken: string; expiresAt: string; email: string; platformRole: PlatformRole }> {
  await requireSuperOwner(input.userId);
  const platformRole = parseRole(input.platformRole);
  const email = input.email.trim().toLowerCase();
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!email || !firstName || !lastName) {
    throw new PlatformAdminError("INVALID", "First name, last name, and email are required.");
  }
  const { raw, hash } = newInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  const { error } = await db.from("platform_invitations").insert({
    email,
    first_name: firstName,
    last_name: lastName,
    platform_role: platformRole,
    invited_by: input.userId,
    expires_at: expiresAt,
    token_hash: hash,
  });
  if (error) throw new Error(error.message);
  await writeAdminAudit("PLATFORM_ADMIN_INVITED", {
    actingUserId: input.userId,
    metadata: {
      action: "invite_platform_admin_fixture",
      role: platformRoleLabel(platformRole),
      subjectEmail: email,
      subjectName: `${firstName} ${lastName}`.trim(),
    },
  });
  return { rawToken: raw, expiresAt, email, platformRole };
}

export async function cancelPlatformAdminInviteImpl(input: {
  userId: string;
  inviteEmail: string;
}): Promise<{ ok: true }> {
  await requireSuperOwner(input.userId);
  const email = input.inviteEmail.trim().toLowerCase();
  const { data: rows, error } = await db
    .from("platform_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("email", email)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("email, platform_role, first_name, last_name");
  if (error) throw new Error(error.message);
  if (!rows?.length) {
    throw new PlatformAdminError("NOT_FOUND", "Pending platform invitation not found.");
  }
  const row = rows[0] as {
    email: string;
    platform_role: PlatformRole;
    first_name: string;
    last_name: string;
  };
  await writeAdminAudit("PLATFORM_ADMIN_INVITE_CANCELLED", {
    actingUserId: input.userId,
    metadata: {
      action: "cancel_platform_invite",
      role: platformRoleLabel(row.platform_role),
      subjectEmail: row.email,
      subjectName: `${row.first_name} ${row.last_name}`.trim(),
    },
  });
  return { ok: true };
}

export async function revokePlatformAdministratorImpl(input: {
  userId: string;
  adminEmail: string;
  confirm?: boolean;
}): Promise<{ ok: true }> {
  await requireSuperOwner(input.userId);
  if (!input.confirm) {
    throw new PlatformAdminError("INVALID", "Explicit confirmation is required to revoke.");
  }
  const email = input.adminEmail.trim().toLowerCase();
  const targetUserId = await findAuthUserIdByEmail(email);
  if (!targetUserId) throw new PlatformAdminError("NOT_FOUND", "Administrator not found.");

  const { data: roles, error } = await db
    .from("platform_roles")
    .select("id, role")
    .eq("user_id", targetUserId);
  if (error) throw new Error(error.message);
  if (!roles?.length) throw new PlatformAdminError("NOT_FOUND", "No platform role found.");

  for (const roleRow of roles as { id: string; role: PlatformRole }[]) {
    if (roleRow.role === "super_owner") {
      const { count, error: cErr } = await db
        .from("platform_roles")
        .select("id", { count: "exact", head: true })
        .eq("role", "super_owner")
        .neq("id", roleRow.id);
      if (cErr) throw new Error(cErr.message);
      if ((count ?? 0) < 1) {
        await writeAdminAudit("LAST_PLATFORM_OWNER_ACTION_DENIED", {
          actingUserId: input.userId,
          subjectUserId: targetUserId,
          metadata: {
            action: "revoke_super_owner",
            oldRole: platformRoleLabel("super_owner"),
            subjectEmail: email,
          },
        });
        throw new PlatformAdminError("LAST_SUPER_OWNER", LAST_SUPER_OWNER_USER_MESSAGE);
      }
    }

    const { error: delErr } = await db
      .from("platform_roles")
      .delete()
      .eq("id", roleRow.id)
      .eq("user_id", targetUserId);
    if (delErr) {
      if (isLastSuperOwnerProtectedError(delErr.message)) {
        await writeAdminAudit("LAST_PLATFORM_OWNER_ACTION_DENIED", {
          actingUserId: input.userId,
          subjectUserId: targetUserId,
          metadata: {
            action: "revoke_platform_role",
            oldRole: platformRoleLabel(roleRow.role),
            subjectEmail: email,
          },
        });
        throw new PlatformAdminError("LAST_SUPER_OWNER", LAST_SUPER_OWNER_USER_MESSAGE);
      }
      throw new Error(delErr.message);
    }

    await writeAdminAudit("PLATFORM_ROLE_REVOKED", {
      actingUserId: input.userId,
      subjectUserId: targetUserId,
      metadata: {
        action: "revoke_platform_role",
        oldRole: platformRoleLabel(roleRow.role),
        subjectEmail: email,
      },
    });
  }

  // G7E-2A: do not invent grant soft-revoke. Leftover grant rows (if any) are
  // inert because helpers require is_super_admin(user) first.
  return { ok: true };
}

export async function resolvePlatformInviteImpl(input: {
  rawToken: string;
}): Promise<{
  email: string;
  firstName: string;
  lastName: string;
  platformRole: PlatformRole;
  expiresAt: string;
}> {
  const hash = hashInviteToken(input.rawToken.trim());
  const { data, error } = await db
    .from("platform_invitations")
    .select("email, first_name, last_name, platform_role, expires_at, accepted_at, revoked_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new PlatformAdminError("INVITE", "This invitation is not valid.");
  if (data.revoked_at) throw new PlatformAdminError("INVITE", "This invitation has been cancelled.");
  if (data.accepted_at) throw new PlatformAdminError("INVITE", "This invitation has already been used.");
  if (new Date(data.expires_at).getTime() <= Date.now()) {
    throw new PlatformAdminError("INVITE", "This invitation has expired.");
  }
  return {
    email: data.email as string,
    firstName: data.first_name as string,
    lastName: data.last_name as string,
    platformRole: data.platform_role as PlatformRole,
    expiresAt: data.expires_at as string,
  };
}

export async function acceptPlatformInviteImpl(input: {
  userId: string;
  rawToken: string;
}): Promise<{ platformRole: PlatformRole; email: string }> {
  const email = await loadAuthEmail(input.userId);
  if (!email) {
    throw new PlatformAdminError("INVITE", "Could not resolve your account email.");
  }
  const hash = hashInviteToken(input.rawToken.trim());
  const { data, error } = await db.rpc("claim_platform_invitation", {
    p_token_hash: hash,
    p_user_id: input.userId,
    p_email: email,
  });
  if (error) {
    const friendly = isPlatformInviteError(error.message);
    throw new PlatformAdminError("INVITE", friendly ?? "This invitation could not be accepted.");
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.granted_role) {
    throw new PlatformAdminError("INVITE", "This invitation could not be accepted.");
  }
  const granted = row.granted_role as PlatformRole;
  const displayName = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
  await db
    .from("profiles")
    .upsert(
      { id: input.userId, email: row.invite_email ?? email, full_name: displayName || null },
      { onConflict: "id" },
    );
  await writeAdminAudit("PLATFORM_ROLE_GRANTED", {
    actingUserId: input.userId,
    subjectUserId: input.userId,
    metadata: {
      action: "accept_platform_invite",
      role: platformRoleLabel(granted),
      subjectEmail: (row.invite_email as string) ?? email,
      subjectName: displayName || null,
    },
  });
  return { platformRole: granted, email: (row.invite_email as string) ?? email };
}

/** Exported for verify scripts / fixtures — hash only, never log raw token. */
export function hashPlatformInviteTokenForTests(rawToken: string): string {
  return hashInviteToken(rawToken);
}
