/**
 * G7E-1 platform Tenant Owner management — server impl (server-only).
 * Super Owner only. Does not require G7D entry sessions.
 */
import { supabaseAdminUntyped as db } from "@/integrations/supabase/client.server";
import {
  LAST_OWNER_USER_MESSAGE,
  isLastOwnerProtectedError,
  type PlatformCompanyOwnersView,
  type PlatformPendingOwnerInvite,
  type PlatformTenantOwnerRow,
} from "@/lib/platform-tenant-owners";
import { requireSuperOwner } from "@/lib/platform-authority.server";

export class PlatformTenantOwnerError extends Error {
  readonly code:
    | "DENIED"
    | "NOT_FOUND"
    | "LAST_OWNER"
    | "NEEDS_CONFIRMATION"
    | "ALREADY_OWNER"
    | "INVALID";
  constructor(code: PlatformTenantOwnerError["code"], message: string) {
    super(message);
    this.name = "PlatformTenantOwnerError";
    this.code = code;
  }
}

type TenantRow = {
  id: string;
  company_code: string;
  company_name: string;
  slug: string;
  status: string;
  tenant_type: string;
};

async function writeOwnerAudit(
  eventType:
    | "TENANT_OWNER_INVITED"
    | "TENANT_OWNER_ADDED"
    | "TENANT_OWNER_REMOVED"
    | "TENANT_OWNER_ROLE_CHANGED"
    | "LAST_TENANT_OWNER_ACTION_DENIED",
  input: {
    actingUserId: string;
    tenantId?: string | null;
    subjectUserId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    const { writePlatformAuditEvent } = await import("@/lib/platform-audit.server");
    await writePlatformAuditEvent({
      eventType: eventType as never,
      actingUserId: input.actingUserId,
      tenantId: input.tenantId,
      subjectUserId: input.subjectUserId,
      metadata: input.metadata,
    });
  } catch {
    /* best-effort */
  }
}

async function loadTenantByCompanyCode(companyCode: string): Promise<TenantRow | null> {
  const { data, error } = await db
    .from("tenants")
    .select("id, company_code, company_name, slug, status, tenant_type")
    .eq("company_code", companyCode)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as TenantRow | null;
}

async function countActiveOwners(tenantId: string, exceptUserId?: string): Promise<number> {
  let q = db
    .from("tenant_memberships")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("role", "owner")
    .eq("active", true);
  if (exceptUserId) q = q.neq("user_id", exceptUserId);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
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

export async function listPlatformCompanyOwnersImpl(input: {
  userId: string;
  companyCode: string;
}): Promise<PlatformCompanyOwnersView> {
  await requireSuperOwner(input.userId);
  const tenant = await loadTenantByCompanyCode(input.companyCode);
  if (!tenant) throw new PlatformTenantOwnerError("NOT_FOUND", "Company not found.");

  const { data: memberRows, error: memErr } = await db
    .from("tenant_memberships")
    .select("user_id, active, created_at")
    .eq("tenant_id", tenant.id)
    .eq("role", "owner")
    .order("created_at", { ascending: true });
  if (memErr) throw new Error(memErr.message);

  const userIds = [...new Set((memberRows ?? []).map((r: { user_id: string }) => r.user_id))];
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

  const owners: PlatformTenantOwnerRow[] = (memberRows ?? [])
    .filter((r: { active: boolean }) => r.active)
    .map((r: { user_id: string; active: boolean; created_at: string | null }) => {
      const profile = profileMap.get(r.user_id);
      return {
        email: profile?.email ?? "(unknown)",
        fullName: profile?.full_name ?? null,
        status: "active" as const,
        joinedAt: r.created_at,
      };
    })
    .filter((o) => o.email !== "(unknown)" || o.fullName);

  const { data: invites, error: invErr } = await db
    .from("staff_invitations")
    .select("email, company_name, expires_at, created_at, used_at")
    .eq("tenant_id", tenant.id)
    .eq("membership_role", "owner")
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (invErr) throw new Error(invErr.message);

  const pendingInvites: PlatformPendingOwnerInvite[] = (invites ?? [])
    .filter((i: { email: string | null }) => Boolean(i.email))
    .map((i: { email: string; company_name: string | null; expires_at: string; created_at: string }) => {
      const displayName =
        i.company_name &&
        i.company_name.trim() &&
        i.company_name.trim().toLowerCase() !== tenant.company_name.trim().toLowerCase()
          ? i.company_name.trim()
          : null;
      return {
        email: i.email.toLowerCase(),
        displayName,
        expiresAt: i.expires_at,
        createdAt: i.created_at,
      };
    });

  return {
    companyCode: tenant.company_code,
    companyName: tenant.company_name,
    tenantStatus: tenant.status,
    owners,
    pendingInvites,
    hasActiveOwner: owners.length > 0,
    hasValidPendingInvite: pendingInvites.length > 0,
  };
}

export async function addPlatformTenantOwnerImpl(input: {
  userId: string;
  companyCode: string;
  firstName: string;
  lastName: string;
  email: string;
  confirmElevate?: boolean;
}): Promise<
  | { outcome: "already_owner"; email: string }
  | { outcome: "added"; email: string }
  | { outcome: "invited"; email: string; expiresAt: string }
  | { outcome: "needs_confirmation"; email: string; existingRoles: string[] }
> {
  await requireSuperOwner(input.userId);
  const tenant = await loadTenantByCompanyCode(input.companyCode);
  if (!tenant) throw new PlatformTenantOwnerError("NOT_FOUND", "Company not found.");

  const email = input.email.trim().toLowerCase();
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!email || !firstName || !lastName) {
    throw new PlatformTenantOwnerError("INVALID", "First name, last name, and email are required.");
  }
  const displayName = `${firstName} ${lastName}`.trim();

  const existingUserId = await findAuthUserIdByEmail(email);

  if (existingUserId) {
    const { data: memberships, error } = await db
      .from("tenant_memberships")
      .select("id, role, active")
      .eq("tenant_id", tenant.id)
      .eq("user_id", existingUserId);
    if (error) throw new Error(error.message);

    const activeOwner = (memberships ?? []).find(
      (m: { role: string; active: boolean }) => m.role === "owner" && m.active,
    );
    if (activeOwner) {
      return { outcome: "already_owner", email };
    }

    const otherActive = (memberships ?? []).filter(
      (m: { role: string; active: boolean }) => m.active && m.role !== "owner",
    );
    if (otherActive.length > 0 && !input.confirmElevate) {
      return {
        outcome: "needs_confirmation",
        email,
        existingRoles: otherActive.map((m: { role: string }) => m.role),
      };
    }

    const inactiveOwner = (memberships ?? []).find(
      (m: { role: string; active: boolean }) => m.role === "owner" && !m.active,
    );
    if (inactiveOwner) {
      const { error: reactivateErr } = await db
        .from("tenant_memberships")
        .update({ active: true })
        .eq("id", inactiveOwner.id)
        .eq("tenant_id", tenant.id);
      if (reactivateErr) {
        if (isLastOwnerProtectedError(reactivateErr.message)) {
          await writeOwnerAudit("LAST_TENANT_OWNER_ACTION_DENIED", {
            actingUserId: input.userId,
            tenantId: tenant.id,
            subjectUserId: existingUserId,
            metadata: { companyCode: tenant.company_code, action: "reactivate_owner" },
          });
          throw new PlatformTenantOwnerError("LAST_OWNER", LAST_OWNER_USER_MESSAGE);
        }
        throw new Error(reactivateErr.message);
      }
    } else {
      const { error: insertErr } = await db.from("tenant_memberships").insert({
        tenant_id: tenant.id,
        user_id: existingUserId,
        role: "owner",
        active: true,
      });
      if (insertErr) {
        // Unique collision — treat as already owner if race.
        if (insertErr.message.toLowerCase().includes("unique") || insertErr.code === "23505") {
          return { outcome: "already_owner", email };
        }
        throw new Error(insertErr.message);
      }
    }

    // Best-effort profile name update; do not touch platform_roles.
    await db
      .from("profiles")
      .upsert({ id: existingUserId, email, full_name: displayName }, { onConflict: "id" });

    await writeOwnerAudit("TENANT_OWNER_ADDED", {
      actingUserId: input.userId,
      tenantId: tenant.id,
      subjectUserId: existingUserId,
      metadata: {
        companyCode: tenant.company_code,
        action: "add_owner",
        elevated: otherActive.length > 0,
      },
    });
    if (otherActive.length > 0) {
      await writeOwnerAudit("TENANT_OWNER_ROLE_CHANGED", {
        actingUserId: input.userId,
        tenantId: tenant.id,
        subjectUserId: existingUserId,
        metadata: {
          companyCode: tenant.company_code,
          action: "add_owner_role",
          priorRoles: otherActive.map((m: { role: string }) => m.role),
        },
      });
    }
    return { outcome: "added", email };
  }

  // New user → staff_invitations owner invite (7 days, matching Create Company).
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
  const { data: invite, error: invErr } = await db
    .from("staff_invitations")
    .insert({
      role: "admin",
      membership_role: "owner",
      email,
      create_company: false,
      company_code: null,
      company_name: displayName,
      created_by: input.userId,
      expires_at: expiresAt,
      tenant_id: tenant.id,
    })
    .select("expires_at")
    .single();
  if (invErr || !invite) throw new Error(invErr?.message || "Failed to create Owner invitation.");

  await writeOwnerAudit("TENANT_OWNER_INVITED", {
    actingUserId: input.userId,
    tenantId: tenant.id,
    metadata: { companyCode: tenant.company_code, action: "invite_owner" },
  });

  return { outcome: "invited", email, expiresAt: invite.expires_at as string };
}

export async function removePlatformTenantOwnerImpl(input: {
  userId: string;
  companyCode: string;
  ownerEmail: string;
}): Promise<{ ok: true }> {
  await requireSuperOwner(input.userId);
  const tenant = await loadTenantByCompanyCode(input.companyCode);
  if (!tenant) throw new PlatformTenantOwnerError("NOT_FOUND", "Company not found.");

  const email = input.ownerEmail.trim().toLowerCase();
  const targetUserId = await findAuthUserIdByEmail(email);
  if (!targetUserId) throw new PlatformTenantOwnerError("NOT_FOUND", "Owner not found.");

  const { data: membership, error } = await db
    .from("tenant_memberships")
    .select("id, role, active, user_id")
    .eq("tenant_id", tenant.id)
    .eq("user_id", targetUserId)
    .eq("role", "owner")
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!membership) throw new PlatformTenantOwnerError("NOT_FOUND", "Active Owner membership not found.");

  const remaining = await countActiveOwners(tenant.id, targetUserId);
  if (tenant.status === "active" && remaining < 1) {
    await writeOwnerAudit("LAST_TENANT_OWNER_ACTION_DENIED", {
      actingUserId: input.userId,
      tenantId: tenant.id,
      subjectUserId: targetUserId,
      metadata: { companyCode: tenant.company_code, action: "remove_owner" },
    });
    throw new PlatformTenantOwnerError("LAST_OWNER", LAST_OWNER_USER_MESSAGE);
  }

  const { error: updErr } = await db
    .from("tenant_memberships")
    .update({ active: false })
    .eq("id", membership.id)
    .eq("tenant_id", tenant.id)
    .eq("user_id", targetUserId)
    .eq("role", "owner");
  if (updErr) {
    if (isLastOwnerProtectedError(updErr.message)) {
      await writeOwnerAudit("LAST_TENANT_OWNER_ACTION_DENIED", {
        actingUserId: input.userId,
        tenantId: tenant.id,
        subjectUserId: targetUserId,
        metadata: { companyCode: tenant.company_code, action: "remove_owner_db" },
      });
      throw new PlatformTenantOwnerError("LAST_OWNER", LAST_OWNER_USER_MESSAGE);
    }
    throw new Error(updErr.message);
  }

  await writeOwnerAudit("TENANT_OWNER_REMOVED", {
    actingUserId: input.userId,
    tenantId: tenant.id,
    subjectUserId: targetUserId,
    metadata: { companyCode: tenant.company_code, action: "remove_owner" },
  });
  return { ok: true };
}

export async function cancelPlatformOwnerInviteImpl(input: {
  userId: string;
  companyCode: string;
  inviteEmail: string;
}): Promise<{ ok: true }> {
  await requireSuperOwner(input.userId);
  const tenant = await loadTenantByCompanyCode(input.companyCode);
  if (!tenant) throw new PlatformTenantOwnerError("NOT_FOUND", "Company not found.");

  const email = input.inviteEmail.trim().toLowerCase();
  // Mark as used without assigning a user — cancels pending invite safely.
  // Prefer used_at stamp so token cannot be replayed.
  const { data: rows, error } = await db
    .from("staff_invitations")
    .update({ used_at: new Date().toISOString(), used_by: input.userId })
    .eq("tenant_id", tenant.id)
    .eq("membership_role", "owner")
    .eq("email", email)
    .is("used_at", null)
    .select("id");
  if (error) throw new Error(error.message);
  if (!rows?.length) throw new PlatformTenantOwnerError("NOT_FOUND", "Pending Owner invitation not found.");
  return { ok: true };
}
