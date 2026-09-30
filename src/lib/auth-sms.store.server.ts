// In-memory login SMS codes (per dev server process). Codes expire after 10 minutes.

type Challenge = { code: string; expiresAt: number };

const challenges = new Map<string, Challenge>();
const TTL_MS = 10 * 60 * 1000;

export function storeLoginSmsCode(userId: string, code: string): void {
  challenges.set(userId, { code, expiresAt: Date.now() + TTL_MS });
}

export function verifyLoginSmsCode(userId: string, code: string): boolean {
  const entry = challenges.get(userId);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    challenges.delete(userId);
    return false;
  }
  if (entry.code !== code.trim()) return false;
  challenges.delete(userId);
  return true;
}

export function clearLoginSmsCode(userId: string): void {
  challenges.delete(userId);
}

// Appointment-signup codes are a separate namespace from login codes: a login code must never be
// redeemable as an appointment-signup sign-in. Each challenge is bound to the phone it was sent to
// and the account created in the same signup request.
type AppointmentSignupChallenge = {
  userId: string;
  code: string;
  expiresAt: number;
  failedAttempts: number;
};

const appointmentSignupChallenges = new Map<string, AppointmentSignupChallenge>();
const APPOINTMENT_SIGNUP_MAX_FAILED_ATTEMPTS = 5;

export function storeAppointmentSignupChallenge(phone: string, userId: string, code: string): void {
  appointmentSignupChallenges.set(phone, {
    userId,
    code,
    expiresAt: Date.now() + TTL_MS,
    failedAttempts: 0,
  });
}

/** Returns the bound user id on success; the challenge is single-use. */
export function consumeAppointmentSignupChallenge(phone: string, code: string): string | null {
  const entry = appointmentSignupChallenges.get(phone);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    appointmentSignupChallenges.delete(phone);
    return null;
  }
  if (entry.code !== code.trim()) {
    entry.failedAttempts += 1;
    if (entry.failedAttempts >= APPOINTMENT_SIGNUP_MAX_FAILED_ATTEMPTS) {
      appointmentSignupChallenges.delete(phone);
    }
    return null;
  }
  appointmentSignupChallenges.delete(phone);
  return entry.userId;
}

export function clearAppointmentSignupChallenge(phone: string): void {
  appointmentSignupChallenges.delete(phone);
}

// Customer phone re-entry sends are throttled per destination phone, whether or not the number
// matches an account, so the throttle itself reveals nothing.
const CUSTOMER_SMS_MIN_INTERVAL_MS = 60 * 1000;
const CUSTOMER_SMS_WINDOW_MS = 60 * 60 * 1000;
const CUSTOMER_SMS_MAX_PER_WINDOW = 5;
const customerSmsSends = new Map<string, number[]>();

/** Records a send attempt for `phone`; returns false when the attempt must be refused. */
export function reserveCustomerSmsSend(phone: string, now: number = Date.now()): boolean {
  const recent = (customerSmsSends.get(phone) ?? []).filter(
    (t) => now - t < CUSTOMER_SMS_WINDOW_MS,
  );
  const last = recent[recent.length - 1];
  if (
    (last !== undefined && now - last < CUSTOMER_SMS_MIN_INTERVAL_MS) ||
    recent.length >= CUSTOMER_SMS_MAX_PER_WINDOW
  ) {
    customerSmsSends.set(phone, recent);
    return false;
  }
  recent.push(now);
  customerSmsSends.set(phone, recent);
  return true;
}
