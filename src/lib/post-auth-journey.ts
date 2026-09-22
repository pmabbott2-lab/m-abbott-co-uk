/** Persist which customer journey to open after brokerage → Hub sign-up. */
import { normalisePublicTenantSlug } from "@/lib/tenant-presentation";

export type PostAuthStart = "voice" | "chat" | "book";

const STORAGE_KEY = "hub_post_auth_start";

export function parsePostAuthStart(value: string | null | undefined): PostAuthStart | null {
  if (value === "voice" || value === "chat" || value === "book") return value;
  return null;
}

export function savePostAuthStart(start: PostAuthStart) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, start);
}

export function readPostAuthStart(): PostAuthStart | null {
  if (typeof window === "undefined") return null;
  return parsePostAuthStart(sessionStorage.getItem(STORAGE_KEY));
}

export function clearPostAuthStart() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(STORAGE_KEY);
}

export function readPostAuthStartFromUrl(): PostAuthStart | null {
  if (typeof window === "undefined") return null;
  return parsePostAuthStart(new URLSearchParams(window.location.search).get("start"));
}

/** Read broker entry intent from the live URL (reliable on external / full-page loads). */
export function readAuthEntryFromLocation(): {
  join: boolean;
  fromBroker: boolean;
  start: PostAuthStart | null;
} {
  if (typeof window === "undefined") {
    return { join: false, fromBroker: false, start: null };
  }
  const p = new URLSearchParams(window.location.search);
  const fromBroker = p.get("from") === "broker" || p.get("from") === "mortgageeasy";
  const start = parsePostAuthStart(p.get("start"));
  const joinParam = p.get("join");
  const join =
    joinParam === "1" ||
    joinParam === "true" ||
    joinParam === "signup" ||
    p.get("mode") === "signup" ||
    p.get("mode") === "join" ||
    start !== null;
  return { join, fromBroker, start };
}

/** URL `start` beats sessionStorage so a new journey choice overrides a stale voice default. */
export function resolvePostAuthStart(routeStart?: PostAuthStart | null): PostAuthStart | null {
  return readPostAuthStartFromUrl() ?? routeStart ?? readPostAuthStart() ?? null;
}

/** Persist journey from URL or route search only — never re-save stale sessionStorage. */
export function syncPostAuthStart(routeStart?: PostAuthStart | null): PostAuthStart | null {
  const fromUrl = readPostAuthStartFromUrl();
  if (fromUrl) {
    savePostAuthStart(fromUrl);
    return fromUrl;
  }
  if (routeStart) {
    savePostAuthStart(routeStart);
    return routeStart;
  }
  return readPostAuthStart();
}

export function isBrokerSignupUrl(): boolean {
  if (typeof window === "undefined") return false;
  const p = new URLSearchParams(window.location.search);
  return (
    p.get("from") === "broker" ||
    p.get("from") === "mortgageeasy" ||
    p.get("join") === "1" ||
    p.get("join") === "signup"
  );
}

export function buildAuthPath(opts?: {
  join?: boolean;
  fromBroker?: boolean;
  start?: PostAuthStart;
  tenantSlug?: string;
  platformIntent?: boolean;
}) {
  const params = new URLSearchParams();
  if (opts?.fromBroker) params.set("from", "broker");
  if (opts?.join) params.set("join", "1");
  if (opts?.start) params.set("start", opts.start);
  if (opts?.platformIntent) params.set("intent", "platform");
  if (opts?.tenantSlug) {
    const slug = normalisePublicTenantSlug(opts.tenantSlug);
    if (slug) params.set("tenant", slug);
  }
  const q = params.toString();
  return q ? `/auth?${q}` : "/auth";
}

/** After auth: prefer tenant workspace gate when a tenant slug was requested. */
export function buildHomePathAfterAuth(start: PostAuthStart | null, tenantSlug?: string | null) {
  const slug = normalisePublicTenantSlug(tenantSlug);
  if (slug) {
    const q = start ? `?start=${encodeURIComponent(start)}` : "";
    return `/${encodeURIComponent(slug)}/workspace${q}`;
  }
  return start ? `/home?start=${encodeURIComponent(start)}` : "/home";
}

export function readTenantSlugFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  return normalisePublicTenantSlug(new URLSearchParams(window.location.search).get("tenant"));
}

/** Shared `/auth` search. All keys optional so missing tenant fails to platform, never 001. */
export type AuthSearch = {
  recovery?: boolean;
  join?: boolean;
  fromBroker?: boolean;
  start?: PostAuthStart;
  tenant?: string;
  /** Navigation intent only. Never grants platform authority. */
  intent?: "platform";
};

export function buildAuthNavigateSearch(opts: {
  tenantSlug?: string | null;
  join?: boolean;
  fromBroker?: boolean;
  start?: PostAuthStart | null;
  recovery?: boolean;
  platformIntent?: boolean;
}): AuthSearch {
  const search: AuthSearch = {};
  const tenant = normalisePublicTenantSlug(opts.tenantSlug);
  if (tenant) search.tenant = tenant;
  if (opts.join) search.join = true;
  if (opts.fromBroker) search.fromBroker = true;
  if (opts.start) search.start = opts.start;
  if (opts.recovery) search.recovery = true;
  if (opts.platformIntent) search.intent = "platform";
  return search;
}

/** Only book uses appointment-first signup; voice and chat use the classic create-account form. */
export function usesAppointmentSignupFlow(start?: PostAuthStart | null): boolean {
  return start === "book";
}
