// Client-safe phone helpers. Mirrors the normalisation in sms.server.ts so a
// number captured here is stored in the same +44 E.164 format as signup, but
// without pulling in any server-only Twilio/Buffer code.

export function normaliseUkPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("44")) return `+${digits}`;
  if (digits.startsWith("0")) return `+44${digits.slice(1)}`;
  if (digits.length === 10) return `+44${digits}`;
  return phone.startsWith("+") ? phone : `+${digits}`;
}

// A valid UK mobile normalises to +447 followed by 9 digits (e.g. +447123456789).
export function isValidUkMobile(phone: string): boolean {
  return /^\+447\d{9}$/.test(normaliseUkPhone(phone));
}
