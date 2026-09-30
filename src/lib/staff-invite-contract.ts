/**
 * Staff invitation contract (G7F-4S3B). Client-safe: no server imports.
 *
 * Invitable role matrix (tenant-side; Owner invites are platform-provisioning only):
 *   owner      → supervisor, general, adviser, introducer
 *   supervisor → general, adviser, introducer
 *   general    → adviser, introducer
 *   anyone else (including platform entry without membership) → nothing
 */
import { z } from "zod";

export type StaffInviteAppRole = "advisor" | "introducer" | "admin";
export type StaffInviteMembershipRole =
  | "owner"
  | "supervisor"
  | "general"
  | "adviser"
  | "introducer";
export type TenantInviteMembershipRole = Exclude<StaffInviteMembershipRole, "owner">;
export type StaffInviterRank = "owner" | "supervisor" | "general" | "none";

const PAIRS: ReadonlyArray<readonly [StaffInviteAppRole, StaffInviteMembershipRole]> = [
  ["advisor", "adviser"],
  ["introducer", "introducer"],
  ["admin", "general"],
  ["admin", "supervisor"],
  ["admin", "owner"],
];

export function isValidStaffInvitePair(role: string, membershipRole: string | null | undefined) {
  return PAIRS.some(([r, m]) => r === role && m === membershipRole);
}

export function appRoleForMembershipRole(
  membershipRole: StaffInviteMembershipRole,
): StaffInviteAppRole {
  if (membershipRole === "adviser") return "advisor";
  if (membershipRole === "introducer") return "introducer";
  return "admin";
}

export function defaultMembershipRoleForAppRole(
  role: StaffInviteAppRole,
): TenantInviteMembershipRole {
  if (role === "admin") return "general";
  if (role === "introducer") return "introducer";
  return "adviser";
}

export function invitableMembershipRoles(rank: StaffInviterRank): TenantInviteMembershipRole[] {
  if (rank === "owner") return ["supervisor", "general", "adviser", "introducer"];
  if (rank === "supervisor") return ["general", "adviser", "introducer"];
  if (rank === "general") return ["adviser", "introducer"];
  return [];
}

export function inviterRankFromFlags(flags: {
  isOwner?: boolean;
  isSupervisor?: boolean;
  isGeneralAdmin?: boolean;
}): StaffInviterRank {
  if (flags.isOwner) return "owner";
  if (flags.isSupervisor) return "supervisor";
  if (flags.isGeneralAdmin) return "general";
  return "none";
}

export const staffInviteTokenSchema = z
  .string()
  .trim()
  .min(16)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/);

export const staffInviteTokenInputSchema = z.object({ token: staffInviteTokenSchema }).strict();

export const createStaffInviteInputSchema = z
  .object({
    role: z.enum(["advisor", "introducer", "admin"]),
    membershipRole: z.enum(["general", "supervisor", "adviser", "introducer"]).optional(),
    email: z.string().trim().toLowerCase().pipe(z.string().email().max(320)),
    companyMode: z.enum(["new", "join"]).optional(),
    companyCode: z
      .string()
      .regex(/^\d{4}$/)
      .optional(),
  })
  .strict();

export type CreateStaffInviteInput = z.infer<typeof createStaffInviteInputSchema>;

export function staffInviteRegisterPath(rawToken: string): string {
  return `/register?invite=${encodeURIComponent(rawToken)}`;
}

/** Public invite preview for /register. Never includes the token or tenant id. */
export type StaffInvitePreview = {
  tenantSlug: string | null;
  role: StaffInviteAppRole;
  membershipRole: StaffInviteMembershipRole;
  email: string;
  companyName: string | null;
  companyCode: string | null;
  createCompany: boolean;
};

/** Management listing row. Never includes the token or token hash. */
export type StaffInviteListRow = {
  id: string;
  role: StaffInviteAppRole;
  membership_role: StaffInviteMembershipRole | null;
  email: string | null;
  company_code: string | null;
  company_name: string | null;
  create_company: boolean | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  can_revoke: boolean;
};
