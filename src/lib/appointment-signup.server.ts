import { randomInt } from "node:crypto";
import {
  APPOINTMENT_CUSTOMER_IDENTITY,
  syntheticCustomerAuthEmail,
} from "@/lib/customer-account-email";
import {
  clearAppointmentSignupChallenge,
  consumeAppointmentSignupChallenge,
  reserveCustomerSmsSend,
  storeAppointmentSignupChallenge,
} from "@/lib/auth-sms.store.server";
import { isValidUkMobile } from "@/lib/phone";
import { isTwilioConfigured, normaliseUkPhone, sendSms } from "@/lib/sms.server";

/**
 * Identity resolution for bookings made on behalf of a customer who is not the caller.
 * An existing account is only ever read: booking data must never redefine its email, phone,
 * name or credentials.
 */
export type CustomerIdentityResolution =
  | { kind: "existing"; userId: string }
  | { kind: "created"; userId: string }
  | { kind: "ambiguous" };

export type CustomerIdentityInput = {
  customerName: string;
  customerPhone: string;
  customerEmail: string;
};

async function loadAdmin() {
  const { supabaseAdminUntyped } = await import("@/integrations/supabase/client.server");
  return supabaseAdminUntyped;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function isAuthUserAlreadyExistsError(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "email_exists" ||
    error.code === "user_already_exists" ||
    /already (been )?registered|already exists/i.test(error.message ?? "")
  );
}

export async function resolveOrCreateCustomerProfile(
  input: CustomerIdentityInput,
): Promise<CustomerIdentityResolution> {
  const supabaseAdmin = await loadAdmin();
  const phone = normaliseUkPhone(input.customerPhone);
  const email = input.customerEmail.trim().toLowerCase();

  if (email) {
    const { data: byEmail, error } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("email", escapeLikePattern(email))
      .limit(2);
    if (error) throw new Error(error.message);
    const rows = (byEmail ?? []) as Array<{ id: string }>;
    if (rows.length > 1) return { kind: "ambiguous" };
    if (rows.length === 1) {
      // profiles.email is user-editable; only treat it as this account's email when Auth agrees
      // (the Auth email, or the service-role-only contact_email of an appointment identity).
      const { data: authUser, error: authErr } = await supabaseAdmin.auth.admin.getUserById(
        rows[0].id,
      );
      const user = authErr ? null : authUser?.user;
      const authEmail = user?.email?.trim().toLowerCase();
      const appMeta = (user?.app_metadata ?? {}) as {
        mh_identity?: unknown;
        contact_email?: unknown;
      };
      const contactEmail =
        appMeta.mh_identity === APPOINTMENT_CUSTOMER_IDENTITY &&
        typeof appMeta.contact_email === "string"
          ? appMeta.contact_email.trim().toLowerCase()
          : null;
      return authEmail === email || contactEmail === email
        ? { kind: "existing", userId: rows[0].id }
        : { kind: "ambiguous" };
    }
  }

  if (phone) {
    const { data: byPhone, error } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("phone", phone)
      .limit(2);
    if (error) throw new Error(error.message);
    const rows = (byPhone ?? []) as Array<{ id: string }>;
    if (rows.length > 1) return { kind: "ambiguous" };
    if (rows.length === 1) return { kind: "existing", userId: rows[0].id };
  }

  // Nobody has proved ownership of the supplied email, so the Auth identity uses the
  // phone-derived synthetic address; the real email is contact data only.
  const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
    email: syntheticCustomerAuthEmail(phone),
    email_confirm: true,
    app_metadata: { mh_identity: APPOINTMENT_CUSTOMER_IDENTITY, contact_email: email || null },
    user_metadata: { full_name: input.customerName, phone },
  });
  if (error) {
    if (isAuthUserAlreadyExistsError(error)) return { kind: "ambiguous" };
    throw new Error(error.message);
  }

  const userId = created.user.id as string;
  await supabaseAdmin.from("profiles").upsert({
    id: userId,
    full_name: input.customerName,
    email: email || null,
    phone,
  });
  await supabaseAdmin
    .from("user_roles")
    .upsert({ user_id: userId, role: "customer" }, { onConflict: "user_id,role" });
  return { kind: "created", userId };
}

/** Staff/introducer booking: link an existing customer read-only, or create a new one. */
export async function resolveCustomerIdForStaffBooking(
  input: CustomerIdentityInput,
): Promise<string> {
  const resolution = await resolveOrCreateCustomerProfile(input);
  if (resolution.kind === "ambiguous") {
    throw new Error(
      "This email or mobile number matches more than one account. Book from the customer's record instead.",
    );
  }
  return resolution.userId;
}

export type AppointmentSignupInput = {
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  startsAt: string;
  advisorId?: string;
  preferAnyAdvisor?: boolean;
  journey?: "voice" | "chat" | "book";
  slug?: string;
};

export type AppointmentSignupBooking = {
  customerId?: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  startsAt: string;
  advisorId?: string;
  preferAnyAdvisor: boolean;
  channel: "voice" | "text" | "direct_booking";
  slug?: string;
};

export type AppointmentSignupDeps = {
  book: (booking: AppointmentSignupBooking, actingUserId?: string) => Promise<unknown>;
  sendSms?: (opts: { to: string; body: string }) => Promise<unknown>;
  isTwilioConfigured?: () => boolean;
};

export type AppointmentSignupResult = {
  needsSmsCode: boolean;
  signInRequired: boolean;
  bookedAt: string;
};

/**
 * Public appointment signup. The caller is unauthenticated, so it can only ever establish
 * credentials for an account created by this same request. A match on an existing account is
 * booked unlinked and never receives a sign-in code.
 */
export async function customerAppointmentSignupImpl(
  data: AppointmentSignupInput,
  deps: AppointmentSignupDeps,
): Promise<AppointmentSignupResult> {
  const phone = normaliseUkPhone(data.customerPhone);
  const emailRaw = data.customerEmail?.trim().toLowerCase() || "";

  const identity = await resolveOrCreateCustomerProfile({
    customerName: data.customerName,
    customerPhone: data.customerPhone,
    customerEmail: emailRaw,
  });

  const booking: AppointmentSignupBooking = {
    customerName: data.customerName,
    customerPhone: data.customerPhone,
    customerEmail: emailRaw,
    startsAt: data.startsAt,
    advisorId: data.advisorId,
    preferAnyAdvisor: data.preferAnyAdvisor ?? !data.advisorId,
    channel:
      data.journey === "voice" ? "voice" : data.journey === "chat" ? "text" : "direct_booking",
    slug: data.slug,
  };

  if (identity.kind !== "created") {
    await deps.book(booking);
    return { needsSmsCode: false, signInRequired: true, bookedAt: data.startsAt };
  }

  await deps.book({ ...booking, customerId: identity.userId }, identity.userId);

  const twilioReady = (deps.isTwilioConfigured ?? isTwilioConfigured)();
  if (!twilioReady) {
    return { needsSmsCode: false, signInRequired: true, bookedAt: data.startsAt };
  }

  const code = String(randomInt(100000, 1000000));
  storeAppointmentSignupChallenge(phone, identity.userId, code);
  const whenLabel = new Date(data.startsAt).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  await (deps.sendSms ?? sendSms)({
    to: phone,
    body: `Hi ${data.customerName}, your mortgage appointment is confirmed for ${whenLabel}. Sign-in code: ${code} (10 min).`,
  });
  return { needsSmsCode: true, signInRequired: false, bookedAt: data.startsAt };
}

const INVALID_CODE_MESSAGE = "That code is invalid or expired. Request a new one.";

async function hasRowsOrError(
  query: PromiseLike<{ data: unknown; error: unknown }>,
): Promise<boolean> {
  const { data, error } = await query;
  if (error) return true;
  return Array.isArray(data) && data.length > 0;
}

/** Fails closed: any privileged or staff relationship (or lookup error) blocks SMS sign-in. */
async function isEligibleForAppointmentSmsSignIn(userId: string): Promise<boolean> {
  const supabaseAdmin = await loadAdmin();
  const blocked = await Promise.all([
    hasRowsOrError(
      supabaseAdmin.from("platform_roles").select("user_id").eq("user_id", userId).limit(1),
    ),
    hasRowsOrError(
      supabaseAdmin
        .from("platform_break_glass_identities")
        .select("user_id")
        .eq("user_id", userId)
        .limit(1),
    ),
    hasRowsOrError(
      supabaseAdmin
        .from("tenant_memberships")
        .select("user_id")
        .eq("user_id", userId)
        .neq("role", "customer")
        .limit(1),
    ),
    hasRowsOrError(
      supabaseAdmin
        .from("user_roles")
        .select("user_id")
        .eq("user_id", userId)
        .neq("role", "customer")
        .limit(1),
    ),
  ]);
  return !blocked.some(Boolean);
}

/**
 * Exchanges an appointment-signup SMS code for a magic-link token. The account is the one bound to
 * the challenge when the code was issued; the link email comes from Auth, never from profiles.
 */
export async function verifyAppointmentSignupSmsImpl(data: {
  phone: string;
  code: string;
}): Promise<{ tokenHash: string }> {
  const phone = normaliseUkPhone(data.phone);
  const userId = consumeAppointmentSignupChallenge(phone, data.code);
  if (!userId) throw new Error(INVALID_CODE_MESSAGE);

  if (!(await isEligibleForAppointmentSmsSignIn(userId))) {
    throw new Error(INVALID_CODE_MESSAGE);
  }

  const supabaseAdmin = await loadAdmin();
  const { data: authUser, error: authErr } = await supabaseAdmin.auth.admin.getUserById(userId);
  const authEmail = authErr ? null : (authUser?.user?.email as string | undefined);
  if (!authEmail) throw new Error("Could not complete sign-in.");
  // The code went to `phone`; only the identity whose Auth email is derived from that phone
  // may be signed in with it.
  if (authEmail.trim().toLowerCase() !== syntheticCustomerAuthEmail(phone)) {
    throw new Error(INVALID_CODE_MESSAGE);
  }

  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email: authEmail,
  });
  if (linkError) throw new Error(linkError.message);
  if (linkData?.user?.id !== userId) throw new Error("Could not complete sign-in.");

  const tokenHash = linkData.properties?.hashed_token as string | undefined;
  if (!tokenHash) throw new Error("Could not complete sign-in.");
  return { tokenHash };
}

type AuthIdentityLookupRow = {
  user_id: string;
  appointment_identity: boolean;
  disabled: boolean;
};

export type CustomerPhoneSignInDeps = {
  sendSms?: (opts: { to: string; body: string }) => Promise<unknown>;
  isTwilioConfigured?: () => boolean;
};

export const CUSTOMER_PHONE_SIGN_IN_SENT =
  "If this mobile number belongs to a customer account, we've texted it a 6-digit sign-in code.";
const CUSTOMER_PHONE_SIGN_IN_UNAVAILABLE =
  "Mobile sign-in isn't available right now. Please try again later.";
const CUSTOMER_PHONE_SIGN_IN_THROTTLED = "Please wait a minute before requesting another code.";

/**
 * Re-entry for appointment-created customers. The account is derived from the phone number alone:
 * it must be the single appointment identity whose Auth email is that phone's synthetic address.
 * The response is identical whether or not a code was sent.
 */
export async function startCustomerPhoneSignInImpl(
  data: { phone: string },
  deps: CustomerPhoneSignInDeps = {},
): Promise<{ message: string }> {
  if (!isValidUkMobile(data.phone)) {
    throw new Error("Enter a valid UK mobile number (e.g. 07123 456789).");
  }
  const phone = normaliseUkPhone(data.phone);
  if (!(deps.isTwilioConfigured ?? isTwilioConfigured)()) {
    throw new Error(CUSTOMER_PHONE_SIGN_IN_UNAVAILABLE);
  }
  if (!reserveCustomerSmsSend(phone)) throw new Error(CUSTOMER_PHONE_SIGN_IN_THROTTLED);

  const userId = await resolveCustomerPhoneSignInUser(phone);
  if (!userId) return { message: CUSTOMER_PHONE_SIGN_IN_SENT };

  const code = String(randomInt(100000, 1000000));
  storeAppointmentSignupChallenge(phone, userId, code);
  try {
    await (deps.sendSms ?? sendSms)({
      to: phone,
      body: `Your Mortgage Hub sign-in code is ${code} (10 min). Don't share it with anyone.`,
    });
  } catch {
    clearAppointmentSignupChallenge(phone);
    console.error("customer phone sign-in: SMS send failed");
  }
  return { message: CUSTOMER_PHONE_SIGN_IN_SENT };
}

async function resolveCustomerPhoneSignInUser(phone: string): Promise<string | null> {
  const supabaseAdmin = await loadAdmin();
  const { data, error } = await supabaseAdmin.rpc("lookup_auth_identity_by_email", {
    p_email: syntheticCustomerAuthEmail(phone),
  });
  if (error) return null;
  const rows = (Array.isArray(data) ? data : []) as AuthIdentityLookupRow[];
  if (rows.length !== 1) return null;
  const [row] = rows;
  if (!row.appointment_identity || row.disabled) return null;
  if (!(await isEligibleForAppointmentSmsSignIn(row.user_id))) return null;
  return row.user_id;
}

export type CustomerSignupEmailCheck = { status: "ok" } | { status: "use_phone_sign_in" };

/**
 * Self-signup pre-check. An email already recorded as the contact email of an appointment-created
 * account must not become a second, separate account; the caller is sent to phone sign-in instead.
 * One, several, or privileged matches all produce the same answer, and nothing is merged.
 */
export async function checkCustomerSignupEmailImpl(data: {
  email: string;
}): Promise<CustomerSignupEmailCheck> {
  const email = data.email.trim().toLowerCase();
  if (!email) return { status: "ok" };
  const supabaseAdmin = await loadAdmin();
  const { data: rows, error } = await supabaseAdmin.rpc(
    "lookup_appointment_identities_by_contact_email",
    { p_email: email },
  );
  if (error) throw new Error("Could not check this email address. Please try again.");
  return Array.isArray(rows) && rows.length > 0
    ? { status: "use_phone_sign_in" }
    : { status: "ok" };
}
