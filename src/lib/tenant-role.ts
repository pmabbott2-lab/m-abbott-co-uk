/**
 * Tenant-scoped role mapping.
 * tenant_memberships.role is authoritative for tenant UI and tenant authorization.
 * Global user_roles / admin_profiles / ADMIN_EMAILS are not consulted here.
 * Never infers mortgageeasy / 001.
 */
import {
  emptyPermissions,
  fullPermissions,
  type AdminAccess,
  type AdminLevel,
  type PermissionAccess,
  type PermissionKey,
  DEFAULT_GENERAL_PERMISSIONS,
} from "@/lib/admin-access";

export type TenantMemberRole =
  | "owner"
  | "supervisor"
  | "general"
  | "adviser"
  | "introducer"
  | "customer";

export const TENANT_MEMBER_ROLES: TenantMemberRole[] = [
  "owner",
  "supervisor",
  "general",
  "adviser",
  "introducer",
  "customer",
];

export type TenantShell =
  | "owner"
  | "supervisor"
  | "general"
  | "adviser"
  | "introducer"
  | "customer"
  | "platform_access"
  | "denied";

export type TenantAccessContext = "membership" | "platform_access" | "none";

export type TenantRoleView = {
  membershipRoles: TenantMemberRole[];
  tenantSlug: string | null;
  tenantId: string | null;
  member: boolean;
  accessContext: TenantAccessContext;
  platformAccessLevel: "read_only" | "operational_admin" | "emergency" | null;
  platformAccessBasisLabel: string | null;
  isOwner: boolean;
  isSupervisor: boolean;
  isGeneralAdmin: boolean;
  isMainAdmin: boolean;
  isAdvisor: boolean;
  isIntroducer: boolean;
  adminLevel: AdminLevel | null;
  adminAccess: AdminAccess;
  shell: TenantShell;
};

const RANK: Record<TenantMemberRole, number> = {
  owner: 50,
  supervisor: 40,
  general: 30,
  adviser: 20,
  introducer: 10,
  customer: 0,
};

export function isTenantMemberRole(value: string): value is TenantMemberRole {
  return (TENANT_MEMBER_ROLES as string[]).includes(value);
}

export function highestTenantRole(roles: TenantMemberRole[]): TenantMemberRole | null {
  let best: TenantMemberRole | null = null;
  let bestRank = -1;
  for (const role of roles) {
    const rank = RANK[role] ?? -1;
    if (rank > bestRank) {
      best = role;
      bestRank = rank;
    }
  }
  return best;
}

function emptyAdmin(): AdminAccess {
  return {
    isAdmin: false,
    adminLevel: null,
    isOwner: false,
    isSupervisor: false,
    permissions: emptyPermissions(),
  };
}

function ownerAdmin(): AdminAccess {
  return {
    isAdmin: true,
    adminLevel: "owner",
    isOwner: true,
    isSupervisor: true,
    permissions: fullPermissions(),
  };
}

function supervisorAdmin(): AdminAccess {
  return {
    isAdmin: true,
    adminLevel: "supervisor",
    isOwner: false,
    isSupervisor: true,
    permissions: fullPermissions(),
  };
}

function generalAdmin(permissions: Record<PermissionKey, PermissionAccess>): AdminAccess {
  return {
    isAdmin: true,
    adminLevel: "general",
    isOwner: false,
    isSupervisor: false,
    permissions,
  };
}

export function deniedTenantRoleView(input?: {
  tenantSlug?: string | null;
  tenantId?: string | null;
}): TenantRoleView {
  return {
    membershipRoles: [],
    tenantSlug: input?.tenantSlug ?? null,
    tenantId: input?.tenantId ?? null,
    member: false,
    accessContext: "none",
    platformAccessLevel: null,
    platformAccessBasisLabel: null,
    isOwner: false,
    isSupervisor: false,
    isGeneralAdmin: false,
    isMainAdmin: false,
    isAdvisor: false,
    isIntroducer: false,
    adminLevel: null,
    adminAccess: emptyAdmin(),
    shell: "denied",
  };
}

/** Platform entry presentation — never maps to Owner/Adviser/Customer shells. */
export function platformAccessTenantRoleView(input: {
  tenantSlug?: string | null;
  tenantId?: string | null;
  accessLevel: "read_only" | "operational_admin" | "emergency";
  basisLabel: string;
}): TenantRoleView {
  const canWrite =
    input.accessLevel === "operational_admin" || input.accessLevel === "emergency";
  return {
    membershipRoles: [],
    tenantSlug: input.tenantSlug ?? null,
    tenantId: input.tenantId ?? null,
    member: false,
    accessContext: "platform_access",
    platformAccessLevel: input.accessLevel,
    platformAccessBasisLabel: input.basisLabel,
    isOwner: false,
    isSupervisor: false,
    isGeneralAdmin: false,
    // operational entry uses admin-capable dashboard without claiming Owner
    isMainAdmin: true,
    isAdvisor: false,
    isIntroducer: false,
    adminLevel: canWrite ? "owner" : null,
    adminAccess: canWrite ? ownerAdmin() : emptyAdmin(),
    shell: "platform_access",
  };
}

/** Platform read_only sessions must not mutate tenant operational data. */
export function platformAccessMayMutate(view: TenantRoleView): boolean {
  if (view.accessContext !== "platform_access") return true;
  return (
    view.platformAccessLevel === "operational_admin" ||
    view.platformAccessLevel === "emergency"
  );
}

/**
 * Map active membership roles for ONE tenant into UI/server flags.
 * Extra global user_roles are intentionally not an input.
 */
export function resolveTenantRoleView(input: {
  membershipRoles: Iterable<string>;
  tenantSlug?: string | null;
  tenantId?: string | null;
  member?: boolean;
  generalPermissions?: Record<PermissionKey, PermissionAccess> | null;
}): TenantRoleView {
  const membershipRoles = [...new Set([...input.membershipRoles].filter(isTenantMemberRole))];
  const member = input.member ?? membershipRoles.length > 0;
  if (!member || membershipRoles.length === 0) {
    return deniedTenantRoleView({ tenantSlug: input.tenantSlug, tenantId: input.tenantId });
  }

  const highest = highestTenantRole(membershipRoles);
  const isOwner = membershipRoles.includes("owner");
  const isSupervisorMember = membershipRoles.includes("supervisor");
  const isGeneralAdmin = membershipRoles.includes("general");
  const isAdvisor = membershipRoles.includes("adviser");
  const isIntroducer = membershipRoles.includes("introducer");
  const isMainAdmin = isOwner || isSupervisorMember || isGeneralAdmin;

  let adminAccess = emptyAdmin();
  let adminLevel: AdminLevel | null = null;
  if (isOwner) {
    adminAccess = ownerAdmin();
    adminLevel = "owner";
  } else if (isSupervisorMember) {
    adminAccess = supervisorAdmin();
    adminLevel = "supervisor";
  } else if (isGeneralAdmin) {
    adminAccess = generalAdmin(input.generalPermissions ?? { ...DEFAULT_GENERAL_PERMISSIONS });
    adminLevel = "general";
  }

  const shell: TenantShell =
    highest === "owner"
      ? "owner"
      : highest === "supervisor"
        ? "supervisor"
        : highest === "general"
          ? "general"
          : highest === "adviser"
            ? "adviser"
            : highest === "introducer"
              ? "introducer"
              : "customer";

  return {
    membershipRoles,
    tenantSlug: input.tenantSlug ?? null,
    tenantId: input.tenantId ?? null,
    member: true,
    accessContext: "membership",
    platformAccessLevel: null,
    platformAccessBasisLabel: null,
    isOwner,
    isSupervisor: isOwner || isSupervisorMember,
    isGeneralAdmin,
    isMainAdmin,
    isAdvisor,
    isIntroducer,
    adminLevel,
    adminAccess,
    shell,
  };
}

/** True when current-tenant membership may administer that tenant (owner/supervisor/general). */
export function canAdministerAsTenantMember(view: TenantRoleView): boolean {
  return view.member && view.isMainAdmin;
}

export function canAdviseAsTenantMember(view: TenantRoleView): boolean {
  return view.member && view.isAdvisor;
}

export function canIntroduceAsTenantMember(view: TenantRoleView): boolean {
  return view.member && view.isIntroducer;
}

export function isTenantStaffMember(view: TenantRoleView): boolean {
  return view.member && (view.isMainAdmin || view.isAdvisor);
}

export function isPlatformAccessContext(view: TenantRoleView): boolean {
  return view.accessContext === "platform_access" && view.shell === "platform_access";
}
