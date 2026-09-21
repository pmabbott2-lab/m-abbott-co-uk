import { getPublicAppUrl } from "@/lib/app-url";
import { normalisePublicTenantSlug } from "@/lib/tenant-presentation";
import {
  buildTenantPath,
  tryBuildCanonicalBookUrl,
  tryBuildCanonicalRafUrl,
  tryBuildCanonicalRefUrl,
} from "@/lib/tenant-url";

const REFERRAL_COOKIE = "introducer_ref";
const REFERRAL_MAX_AGE_DAYS = 30;

export function setReferralCookie(slug: string) {
  if (typeof document === "undefined") return;
  const maxAge = REFERRAL_MAX_AGE_DAYS * 24 * 60 * 60;
  document.cookie = `${REFERRAL_COOKIE}=${encodeURIComponent(slug)}; path=/; max-age=${maxAge}; samesite=lax`;
}

export function getReferralSlug(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${REFERRAL_COOKIE}=([^;]*)`));
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function clearReferralCookie() {
  if (typeof document === "undefined") return;
  document.cookie = `${REFERRAL_COOKIE}=; path=/; max-age=0`;
}

function publicOrigin(origin?: string): string {
  return (origin ?? (typeof window !== "undefined" ? window.location.origin : getPublicAppUrl())).replace(
    /\/$/,
    "",
  );
}

/**
 * Shareable introducer hub link. Requires the introducer's real tenant slug
 * (from introducer.tenant_id → tenants.slug). Empty when tenant is unknown —
 * never /go, never /home, never a hardcoded 001 URL.
 */
export function referralLinkForSlug(
  introducerSlug: string,
  tenantSlug?: string | null,
  origin?: string,
): string {
  return tryBuildCanonicalRefUrl(tenantSlug, introducerSlug, publicOrigin(origin));
}

/**
 * Marketing / calculator base for a known tenant. Empty when slug missing —
 * never defaults to mortgageeasy.
 */
export function getMarketingSiteUrl(tenantSlug?: string | null, origin?: string): string {
  const slug = normalisePublicTenantSlug(tenantSlug);
  if (!slug) return "";
  try {
    const path = buildTenantPath(slug, "/");
    return `${publicOrigin(origin)}${path}`;
  } catch {
    return "";
  }
}

/** Partner link to the tenant landing — three ways to start (voice, chat, book). */
export function marketingJourneyLinkForSlug(
  introducerSlug: string,
  tenantSlug?: string | null,
  origin?: string,
): string {
  const base = getMarketingSiteUrl(tenantSlug, origin).replace(/\/$/, "");
  if (!base || !introducerSlug) return "";
  return `${base}/?ref=${encodeURIComponent(introducerSlug)}#your-journey`;
}

/** Partner link to the tenant calculator path with attribution. */
export function marketingCalculatorLinkForSlug(
  introducerSlug: string,
  tenantSlug?: string | null,
  origin?: string,
): string {
  const slug = normalisePublicTenantSlug(tenantSlug);
  if (!slug || !introducerSlug) return "";
  try {
    const path = buildTenantPath(slug, "/calculator.html");
    return `${publicOrigin(origin)}${path}?ref=${encodeURIComponent(introducerSlug)}`;
  } catch {
    return "";
  }
}

export function bookingLinkForSlug(
  introducerSlug: string,
  tenantSlug?: string | null,
  origin?: string,
  leadId?: string,
): string {
  return tryBuildCanonicalBookUrl(tenantSlug, introducerSlug, publicOrigin(origin), leadId);
}

// ---------------------------------------------------------------------------
// Refer a friend (RAF) attribution.
//
// Kept DELIBERATELY SEPARATE from the introducer attribution above: RAF uses
// its OWN cookie ('raf_ref') so a customer referral and an introducer referral
// can both be present without clobbering each other. The introducer cookie
// credits a business introducer at booking time; the RAF cookie credits a
// referring customer when their friend signs up.
// ---------------------------------------------------------------------------
const RAF_COOKIE = "raf_ref";
const RAF_MAX_AGE_DAYS = 30;

export function setRafCookie(code: string) {
  if (typeof document === "undefined") return;
  const maxAge = RAF_MAX_AGE_DAYS * 24 * 60 * 60;
  document.cookie = `${RAF_COOKIE}=${encodeURIComponent(code)}; path=/; max-age=${maxAge}; samesite=lax`;
}

export function getRafCode(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${RAF_COOKIE}=([^;]*)`));
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function clearRafCookie() {
  if (typeof document === "undefined") return;
  document.cookie = `${RAF_COOKIE}=; path=/; max-age=0`;
}

export function rafLinkForCode(
  code: string,
  tenantSlug?: string | null,
  origin?: string,
): string {
  return tryBuildCanonicalRafUrl(tenantSlug, code, publicOrigin(origin));
}

/** Short OG / meta description for a RAF landing page. */
export function rafShareDescription(referrerName: string | null): string {
  if (referrerName?.trim()) {
    return `${referrerName.trim()} has recommended Mortgage Hub — a friendly way to get your mortgage fact-find done before you meet your advisor.`;
  }
  return "A friend has recommended Mortgage Hub — a friendly way to get your mortgage fact-find done before you meet your advisor.";
}

/** Full shareable message (SMS, email, WhatsApp) including who recommended and the link. */
export function rafShareMessage(
  referrerName: string | null,
  code: string,
  tenantSlug?: string | null,
  origin?: string,
): string {
  const url = rafLinkForCode(code, tenantSlug, origin);
  if (!url) return "";
  const who = referrerName?.trim()
    ? `${referrerName.trim()} has recommended Mortgage Hub`
    : "A friend has recommended Mortgage Hub";
  return `${who} — a friendly way to get your mortgage fact-find done before you meet your advisor. Start here: ${url}`;
}
