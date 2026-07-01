import { getPublicAppUrl } from "@/lib/app-url";

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

export function referralLinkForSlug(slug: string, origin?: string) {
  const base = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/go/${slug}`;
}

export function bookingLinkForSlug(slug: string, origin?: string, leadId?: string) {
  const base = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  const url = `${base}/book/${slug}`;
  return leadId ? `${url}?lead=${leadId}` : url;
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

export function rafLinkForCode(code: string, origin?: string) {
  const base = (origin ?? getPublicAppUrl()).replace(/\/$/, "");
  return `${base}/raf/${code}`;
}

/** Short OG / meta description for a RAF landing page. */
export function rafShareDescription(referrerName: string | null): string {
  if (referrerName?.trim()) {
    return `${referrerName.trim()} has recommended Mortgage Hub — a friendly way to get your mortgage fact-find done before you meet your advisor.`;
  }
  return "A friend has recommended Mortgage Hub — a friendly way to get your mortgage fact-find done before you meet your advisor.";
}

/** Full shareable message (SMS, email, WhatsApp) including who recommended and the link. */
export function rafShareMessage(referrerName: string | null, code: string, origin?: string): string {
  const url = rafLinkForCode(code, origin);
  const who = referrerName?.trim()
    ? `${referrerName.trim()} has recommended Mortgage Hub`
    : "A friend has recommended Mortgage Hub";
  return `${who} — a friendly way to get your mortgage fact-find done before you meet your advisor. Start here: ${url}`;
}
