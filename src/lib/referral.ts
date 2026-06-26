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
