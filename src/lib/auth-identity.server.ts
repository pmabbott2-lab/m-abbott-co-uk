/**
 * Canonical Auth identity helpers (G7F-4S3B). Server-only.
 * Identity is read from auth.users via the Admin API — never from profiles.email,
 * which the account holder can edit.
 */
import {
  APPOINTMENT_CUSTOMER_IDENTITY,
  isSyntheticCustomerAuthEmail,
} from "@/lib/customer-account-email";

export function normaliseAuthEmail(email: string | null | undefined): string | null {
  const value = (email ?? "").trim().toLowerCase();
  return value || null;
}

export type CanonicalAuthIdentity = {
  userId: string;
  email: string | null;
  emailConfirmed: boolean;
  appointmentCustomer: boolean;
  metadataFullName: string | null;
  metadataPhone: string | null;
};

type AdminAuthUser = {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  app_metadata?: Record<string, unknown> | null;
  user_metadata?: Record<string, unknown> | null;
  banned_until?: string | null;
  deleted_at?: string | null;
  is_anonymous?: boolean | null;
};

function toIdentity(user: AdminAuthUser): CanonicalAuthIdentity {
  const email = normaliseAuthEmail(user.email);
  const banned = Boolean(user.banned_until && new Date(user.banned_until).getTime() > Date.now());
  const usable = !banned && !user.deleted_at && !user.is_anonymous;
  return {
    userId: user.id,
    email,
    emailConfirmed: usable && Boolean(email) && Boolean(user.email_confirmed_at),
    appointmentCustomer:
      user.app_metadata?.mh_identity === APPOINTMENT_CUSTOMER_IDENTITY ||
      isSyntheticCustomerAuthEmail(email),
    metadataFullName: metadataText(user.user_metadata?.full_name),
    metadataPhone: metadataText(user.user_metadata?.phone),
  };
}

function metadataText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 200) : null;
}

export async function loadCanonicalAuthIdentity(
  userId: string,
): Promise<CanonicalAuthIdentity | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error || !data?.user) return null;
  return toIdentity(data.user as AdminAuthUser);
}

/** Confirmed canonical auth.users email for the acting user, or null. */
export async function loadConfirmedAuthEmail(userId: string): Promise<string | null> {
  const identity = await loadCanonicalAuthIdentity(userId);
  if (!identity?.emailConfirmed) return null;
  return identity.email;
}

const LIST_PAGE_SIZE = 1000;
const LIST_MAX_PAGES = 50;

/** Look up an Auth user by exact normalised auth.users email (Admin API scan). */
export async function findAuthUserByEmail(
  email: string,
): Promise<{ id: string; emailConfirmed: boolean } | null> {
  const normalised = normaliseAuthEmail(email);
  if (!normalised) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  for (let page = 1; page <= LIST_MAX_PAGES; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: LIST_PAGE_SIZE,
    });
    if (error) throw new Error(error.message);
    const users = (data?.users ?? []) as AdminAuthUser[];
    const hit = users.find((u) => normaliseAuthEmail(u.email) === normalised);
    if (hit) {
      const identity = toIdentity(hit);
      return { id: identity.userId, emailConfirmed: identity.emailConfirmed };
    }
    if (users.length < LIST_PAGE_SIZE) break;
  }
  return null;
}
