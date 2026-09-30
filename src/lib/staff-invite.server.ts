/**
 * Staff invitations (G7F-4S3B). Server-only.
 *
 * Tokens exist in raw form only in the create response (and the one-time owner
 * provisioning response); the database stores SHA-256 hashes. Acceptance binds the
 * invitation to the acting user's confirmed auth.users email inside the atomic
 * public.accept_staff_invite RPC — a token alone never grants authority.
 */
import { createHash, randomBytes, randomInt } from "node:crypto";
import { supabaseAdminUntyped as db } from "@/integrations/supabase/client.server";
import { loadCanonicalAuthIdentity, normaliseAuthEmail } from "@/lib/auth-identity.server";
import {
  defaultMembershipRoleForAppRole,
  invitableMembershipRoles,
  inviterRankFromFlags,
  isValidStaffInvitePair,
  staffInviteRegisterPath,
  type CreateStaffInviteInput,
  type StaffInviteAppRole,
  type StaffInviteListRow,
  type StaffInviteMembershipRole,
  type StaffInvitePreview,
  type StaffInviterRank,
  type TenantInviteMembershipRole,
} from "@/lib/staff-invite-contract";
import { normalisePublicTenantSlug } from "@/lib/tenant-presentation";

export class StaffInviteError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "StaffInviteError";
    this.code = code;
  }
}

const INVALID_LINK = "This invite link is not valid.";

const RPC_MESSAGES: Record<string, string> = {
  staff_invite_invalid: INVALID_LINK,
  staff_invite_role_invalid: INVALID_LINK,
  staff_invite_email_required: "This invite link is not valid. Ask an admin for a new one.",
  staff_invite_used: "This invite link has already been used.",
  staff_invite_expired: "This invite link has expired. Ask an admin for a new one.",
  staff_invite_tenant_inactive: "This company is not currently accepting new staff.",
  staff_invite_identity:
    "This account can't accept staff invites. Sign in with the invited email address.",
  staff_invite_email_unconfirmed:
    "Confirm your email address, then sign in again to accept this invite.",
  staff_invite_email_mismatch:
    "This invite was sent to a different email address. Sign in with the invited email address.",
  staff_invite_admin_profile_conflict:
    "This account already has admin access for another company. Contact support.",
  staff_invite_introducer_conflict:
    "This account is already an introducer for another company. Contact support.",
  staff_invite_introducer_company_conflict:
    "This account is already an introducer for a different business. Its company code can't be changed by an invite. Contact support.",
  staff_invite_company_missing:
    "The company for this invite no longer exists. Ask an admin for a new invite.",
};

function inviteError(code: keyof typeof RPC_MESSAGES | string): StaffInviteError {
  return new StaffInviteError(code, RPC_MESSAGES[code] ?? "This invite could not be accepted.");
}

const UUID_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** SHA-256 hex of a raw token. Legacy uuid tokens hash in lower case (migration backfill). */
export function hashStaffInviteToken(rawToken: string): string {
  const trimmed = rawToken.trim();
  const normalised = UUID_TOKEN.test(trimmed) ? trimmed.toLowerCase() : trimmed;
  return createHash("sha256").update(normalised, "utf8").digest("hex");
}

export function newStaffInviteToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashStaffInviteToken(raw) };
}

// ---------------------------------------------------------------------------
// Inviter authority
// ---------------------------------------------------------------------------

type InviterContext = { tenantId: string; rank: StaffInviterRank };

async function resolveInviter(actorUserId: string): Promise<InviterContext> {
  const { resolveSoleMembershipTenant } = await import("@/lib/tenant-assert.server");
  const { loadTenantRoleForTenantId } = await import("@/lib/tenant-role.server");
  const { assertTenantViewMayMutate } = await import("@/lib/tenant-role");
  const authorised = await resolveSoleMembershipTenant(actorUserId);
  const view = await loadTenantRoleForTenantId(actorUserId, authorised.tenant.id);
  if (!view.isMainAdmin) throw new Error("Forbidden");
  assertTenantViewMayMutate(view);
  const rank = inviterRankFromFlags(view);
  if (rank === "none") throw new Error("Forbidden");
  return { tenantId: authorised.tenant.id, rank };
}

function legacyMembershipRole(row: {
  role: string;
  membership_role: string | null;
}): StaffInviteMembershipRole | null {
  if (row.membership_role) return row.membership_role as StaffInviteMembershipRole;
  if (row.role === "advisor" || row.role === "introducer" || row.role === "admin") {
    return defaultMembershipRoleForAppRole(row.role);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Create / list / revoke (tenant admins)
// ---------------------------------------------------------------------------

export type CreatedStaffInvite = {
  id: string;
  role: StaffInviteAppRole;
  membershipRole: TenantInviteMembershipRole;
  email: string;
  expiresAt: string;
  /** Raw token — returned once, to the creator only. Never persisted or listed. */
  token: string;
  registerPath: string;
};

export async function createStaffInviteImpl(input: {
  actorUserId: string;
  data: CreateStaffInviteInput;
}): Promise<CreatedStaffInvite> {
  const inviter = await resolveInviter(input.actorUserId);
  const { data } = input;
  const membershipRole = data.membershipRole ?? defaultMembershipRoleForAppRole(data.role);
  if (!isValidStaffInvitePair(data.role, membershipRole)) {
    throw new StaffInviteError("role_invalid", "That role and access level don't match.");
  }
  if (!invitableMembershipRoles(inviter.rank).includes(membershipRole)) {
    throw new StaffInviteError("role_forbidden", "You can't invite staff at that level.");
  }
  const email = normaliseAuthEmail(data.email);
  if (!email) throw new StaffInviteError("email_required", "Enter the invitee's email address.");

  const isIntroducer = data.role === "introducer";
  const isJoin = isIntroducer && data.companyMode === "join";
  let companyName: string | null = null;
  if (isJoin) {
    if (!data.companyCode) throw new Error("Enter the 4-digit company code to join.");
    const { data: company, error: companyErr } = await db
      .from("introducers")
      .select("company_name")
      .eq("company_code", data.companyCode)
      .eq("tenant_id", inviter.tenantId)
      .limit(1)
      .maybeSingle();
    if (companyErr) throw new Error(companyErr.message);
    if (!company) throw new Error(`No company found with code ${data.companyCode}.`);
    companyName = (company as { company_name?: string | null }).company_name ?? null;
  }

  const token = newStaffInviteToken();
  const { data: row, error } = await db
    .from("staff_invitations")
    .insert({
      token_hash: token.hash,
      tenant_id: inviter.tenantId,
      role: data.role,
      membership_role: membershipRole,
      email,
      create_company: isIntroducer ? !isJoin : false,
      company_code: isJoin ? data.companyCode : null,
      company_name: companyName,
      created_by: input.actorUserId,
    })
    .select("id, role, membership_role, email, expires_at")
    .single();
  if (error) throw new Error(error.message);
  const created = row as { id: string; email: string; expires_at: string };
  return {
    id: created.id,
    role: data.role,
    membershipRole,
    email: created.email,
    expiresAt: created.expires_at,
    token: token.raw,
    registerPath: staffInviteRegisterPath(token.raw),
  };
}

const LIST_COLUMNS =
  "id, role, membership_role, email, company_code, company_name, create_company, created_at, expires_at, used_at";

export async function listStaffInvitesImpl(input: {
  actorUserId: string;
}): Promise<StaffInviteListRow[]> {
  const inviter = await resolveInviter(input.actorUserId);
  const revocable = invitableMembershipRoles(inviter.rank) as string[];
  const { data, error } = await db
    .from("staff_invitations")
    .select(LIST_COLUMNS)
    .eq("tenant_id", inviter.tenantId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Omit<StaffInviteListRow, "can_revoke">>).map((r) => {
    const membership = legacyMembershipRole(r);
    return {
      id: r.id,
      role: r.role,
      membership_role: r.membership_role,
      email: r.email,
      company_code: r.company_code,
      company_name: r.company_name,
      create_company: r.create_company,
      created_at: r.created_at,
      expires_at: r.expires_at,
      used_at: r.used_at,
      can_revoke: !r.used_at && membership !== null && revocable.includes(membership),
    };
  });
}

export async function revokeStaffInviteImpl(input: {
  actorUserId: string;
  id: string;
}): Promise<{ ok: true }> {
  const inviter = await resolveInviter(input.actorUserId);
  const { data: row, error } = await db
    .from("staff_invitations")
    .select("id, role, membership_role, used_at")
    .eq("id", input.id)
    .eq("tenant_id", inviter.tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new StaffInviteError("not_found", "Invite not found.");
  const invite = row as { role: string; membership_role: string | null; used_at: string | null };
  if (invite.used_at) throw new StaffInviteError("used", "This invite has already been used.");
  const membership = legacyMembershipRole(invite);
  if (!membership || !(invitableMembershipRoles(inviter.rank) as string[]).includes(membership)) {
    throw new StaffInviteError("role_forbidden", "You can't revoke invites at that level.");
  }
  const { error: delErr } = await db
    .from("staff_invitations")
    .delete()
    .eq("id", input.id)
    .eq("tenant_id", inviter.tenantId)
    .is("used_at", null);
  if (delErr) throw new Error(delErr.message);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Public preview + authenticated acceptance
// ---------------------------------------------------------------------------

type InviteRow = {
  id: string;
  tenant_id: string | null;
  role: string;
  membership_role: string | null;
  email: string | null;
  company_code: string | null;
  company_name: string | null;
  create_company: boolean | null;
  expires_at: string;
  used_at: string | null;
};

async function loadUsableInvite(
  rawToken: string,
): Promise<{ invite: InviteRow; tenantSlug: string | null; email: string }> {
  const { data, error } = await db
    .from("staff_invitations")
    .select(
      "id, tenant_id, role, membership_role, email, company_code, company_name, create_company, expires_at, used_at",
    )
    .eq("token_hash", hashStaffInviteToken(rawToken))
    .maybeSingle();
  if (error) throw new Error(error.message);
  const invite = data as InviteRow | null;
  if (!invite) throw inviteError("staff_invite_invalid");
  if (invite.used_at) throw inviteError("staff_invite_used");
  if (new Date(invite.expires_at).getTime() <= Date.now())
    throw inviteError("staff_invite_expired");
  if (!invite.tenant_id) throw inviteError("staff_invite_invalid");
  const email = normaliseAuthEmail(invite.email);
  if (!email) throw inviteError("staff_invite_email_required");
  if (!isValidStaffInvitePair(invite.role, invite.membership_role)) {
    throw inviteError("staff_invite_role_invalid");
  }
  const { data: tenant, error: tenantErr } = await db
    .from("tenants")
    .select("slug, status")
    .eq("id", invite.tenant_id)
    .maybeSingle();
  if (tenantErr) throw new Error(tenantErr.message);
  if (!tenant || (tenant as { status?: string }).status !== "active") {
    throw inviteError("staff_invite_tenant_inactive");
  }
  return {
    invite,
    tenantSlug: normalisePublicTenantSlug((tenant as { slug?: string }).slug),
    email,
  };
}

export async function resolveStaffInvitePreviewImpl(input: {
  rawToken: string;
}): Promise<StaffInvitePreview> {
  const { invite, tenantSlug, email } = await loadUsableInvite(input.rawToken);
  return {
    tenantSlug,
    role: invite.role as StaffInviteAppRole,
    membershipRole: invite.membership_role as StaffInviteMembershipRole,
    email,
    companyName: invite.company_name ?? null,
    companyCode: invite.company_code ?? null,
    createCompany: Boolean(invite.create_company),
  };
}

const ADVISOR_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function advisorCodeCandidate(): string {
  let code = "";
  for (let i = 0; i < 5; i += 1)
    code += ADVISOR_CODE_ALPHABET[randomInt(ADVISOR_CODE_ALPHABET.length)];
  return code;
}

function slugRoot(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "introducer";
}

const MAX_IDENTIFIER_ATTEMPTS = 5;

export type AcceptedStaffInvite = {
  ok: true;
  role: StaffInviteAppRole;
  membershipRole: StaffInviteMembershipRole;
  tenantSlug: string | null;
};

/**
 * userId MUST be the authenticated actor from server context (requireSupabaseAuth).
 * The acting identity is always auth.users — never profiles.email or client input.
 */
export async function acceptStaffInviteImpl(input: {
  userId: string;
  rawToken: string;
}): Promise<AcceptedStaffInvite> {
  const identity = await loadCanonicalAuthIdentity(input.userId);
  if (!identity || identity.appointmentCustomer) throw inviteError("staff_invite_identity");
  if (!identity.emailConfirmed || !identity.email) {
    throw inviteError("staff_invite_email_unconfirmed");
  }

  const { invite, email: inviteEmail } = await loadUsableInvite(input.rawToken);
  if (identity.email !== inviteEmail) throw inviteError("staff_invite_email_mismatch");

  const isIntroducer = invite.membership_role === "introducer";
  let slugBase = identity.email.split("@")[0] || "introducer";
  if (isIntroducer) {
    const { data: profile } = await db
      .from("profiles")
      .select("full_name")
      .eq("id", input.userId)
      .maybeSingle();
    const profileName = (profile as { full_name?: string | null } | null)?.full_name?.trim();
    slugBase =
      (!invite.create_company && invite.company_name?.trim()) ||
      profileName ||
      identity.metadataFullName ||
      slugBase;
  }
  const root = slugRoot(slugBase);

  for (let attempt = 0; attempt < MAX_IDENTIFIER_ATTEMPTS; attempt += 1) {
    let companyCode: string | null = null;
    if (isIntroducer && invite.create_company) {
      const { generateUniqueCompanyCode } = await import("@/lib/introducer.functions");
      companyCode = await generateUniqueCompanyCode();
    }
    const { data, error } = await db.rpc("accept_staff_invite", {
      p_token_hash: hashStaffInviteToken(input.rawToken),
      p_user_id: input.userId,
      p_full_name: identity.metadataFullName,
      p_phone: identity.metadataPhone,
      p_advisor_code: advisorCodeCandidate(),
      p_company_code: companyCode,
      p_introducer_slug: attempt === 0 ? root : `${root}-${randomBytes(3).toString("hex")}`,
    });
    if (!error) {
      const row = (Array.isArray(data) ? data[0] : data) as {
        accepted_tenant_slug?: string | null;
        granted_role?: string;
        granted_membership_role?: string;
      } | null;
      if (!row?.granted_role || !row.granted_membership_role) {
        throw inviteError("staff_invite_unknown");
      }
      return {
        ok: true,
        role: row.granted_role as StaffInviteAppRole,
        membershipRole: row.granted_membership_role as StaffInviteMembershipRole,
        tenantSlug: normalisePublicTenantSlug(row.accepted_tenant_slug ?? null),
      };
    }
    const message = String(error.message ?? "");
    if (message.includes("staff_invite_retry_identifier") || error.code === "23505") continue;
    const known = Object.keys(RPC_MESSAGES).find((code) => message.includes(code));
    if (known) throw inviteError(known);
    console.error("accept_staff_invite failed", { code: error.code ?? null });
    throw inviteError("staff_invite_unknown");
  }
  throw new StaffInviteError(
    "staff_invite_retry_exhausted",
    "We couldn't finish setting up your access. Please try again.",
  );
}
