/**
 * Authoritative post-authentication destination.
 * Precedence: platform_roles → tenant context → legacy /home.
 * Intent query params are navigation only — never a grant.
 * Never reads email, owner-email lists, global role tables, or admin profile rows.
 */
import { normalisePublicTenantSlug } from "@/lib/tenant-presentation";
import { buildHomePathAfterAuth, type PostAuthStart } from "@/lib/post-auth-journey";

export type PostAuthDestinationKind =
  | "platform"
  | "tenant"
  | "legacy_home"
  | "platform_denied";

export type PostAuthDestination = {
  to: string;
  kind: PostAuthDestinationKind;
};

export type PostAuthDestinationInput = {
  canAccessPlatform: boolean;
  requestedTenantSlug?: string | null;
  soleMembershipSlug?: string | null;
  start?: PostAuthStart | null;
  /** Navigation intent from Platform sign in. Never grants authority. */
  platformIntent?: boolean;
};

/**
 * Choose the path after a successful authentication.
 * `canAccessPlatform` must already be derived from platform_roles only.
 */
export function resolvePostAuthDestination(input: PostAuthDestinationInput): PostAuthDestination {
  if (input.canAccessPlatform) {
    return { to: "/platform", kind: "platform" };
  }

  const requested = normalisePublicTenantSlug(input.requestedTenantSlug);
  if (requested) {
    return {
      to: buildHomePathAfterAuth(input.start ?? null, requested),
      kind: "tenant",
    };
  }

  const sole = normalisePublicTenantSlug(input.soleMembershipSlug);
  if (sole) {
    return {
      to: buildHomePathAfterAuth(input.start ?? null, sole),
      kind: "tenant",
    };
  }

  if (input.platformIntent) {
    return { to: "/platform", kind: "platform_denied" };
  }

  return {
    to: buildHomePathAfterAuth(input.start ?? null, null),
    kind: "legacy_home",
  };
}

/**
 * Generic authenticated /home is not a platform surface.
 * Platform-only users (no tenant UI context) leave /home for /platform.
 */
export function resolveAuthenticatedHomeRedirect(input: {
  canAccessPlatform: boolean;
  tenantSlug?: string | null;
}): "/platform" | null {
  if (!input.canAccessPlatform) return null;
  if (normalisePublicTenantSlug(input.tenantSlug)) return null;
  return "/platform";
}

export function isPlatformLoginIntent(value: unknown): boolean {
  return value === "platform" || value === true;
}
