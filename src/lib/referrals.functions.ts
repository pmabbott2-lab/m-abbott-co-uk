import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { isTwilioConfigured, sendSms, getAppBaseUrl } from "@/lib/sms.server";
import { rafShareMessage } from "@/lib/referral";

// ============================================================================
// Refer a friend (RAF) — ADMIN-DRIVEN.
//
// An admin mints a referral CODE for a specific REFERRER (an existing
// customer/user, or an off-system person captured via name + phone). The
// referrer shares /raf/<code> with their friends. A friend landing via that
// link gets a 'raf_ref' cookie (kept SEPARATE from introducer attribution);
// on the friend's first authenticated /home load the referral is recorded
// crediting the referrer (claimReferral). The bonus is TRACKED ONLY — the admin
// advances bonus_status from the dashboard. There is NO customer self-serve.
// ============================================================================

// RAF codes: 8-char, URL-safe, unambiguous alphabet (no I/O/0/1) so they read
// cleanly when texted. Matches the DB CHECK (^[A-Za-z0-9]{4,16}$).
const RAF_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RAF_CODE_LENGTH = 8;

function randomReferralCode(): string {
  let code = "";
  for (let i = 0; i < RAF_CODE_LENGTH; i += 1) {
    code += RAF_CODE_ALPHABET[Math.floor(Math.random() * RAF_CODE_ALPHABET.length)];
  }
  return code;
}

// The referral_codes / referrals tables only exist once the RAF migration has
// been applied. Treat "missing table/column" errors as "no RAF yet" so the
// dashboard keeps working before the user runs APPLY_NEW_FEATURES.sql.
function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const msg = (error.message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    code === "PGRST106" ||
    msg.includes("referral_codes") ||
    msg.includes("referrals") ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

async function getRolesForUser(userId: string): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  return (data ?? []).map((r) => r.role);
}

async function requireAdmin(userId: string): Promise<void> {
  const roles = await getRolesForUser(userId);
  if (!roles.includes("admin")) throw new Error("Forbidden");
}

async function requireRafView(userId: string, email?: string): Promise<void> {
  const { resolveAdminAccess } = await import("@/lib/admin.functions");
  const { canView } = await import("@/lib/admin-access");
  const access = await resolveAdminAccess(userId, email);
  if (access.isOwner || access.isSupervisor || canView(access, "raf")) return;
  await requireAdmin(userId);
}

async function requireRafAmend(userId: string, email?: string): Promise<void> {
  const { resolveAdminAccess } = await import("@/lib/admin.functions");
  const { canAmend } = await import("@/lib/admin-access");
  const access = await resolveAdminAccess(userId, email);
  if (access.isOwner || access.isSupervisor || canAmend(access, "raf")) return;
  await requireAdmin(userId);
}

// Generate a referral code that doesn't collide with an existing one.
async function generateUniqueReferralCode(): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  for (let i = 0; i < 50; i += 1) {
    const code = randomReferralCode();
    const { data, error } = await supabaseAdmin
      .from("referral_codes")
      .select("id")
      .eq("code", code)
      .maybeSingle();
    if (error && !isMissingTableError(error)) throw new Error(error.message);
    if (!data) return code;
  }
  return `${randomReferralCode()}${Date.now().toString(36).slice(-3).toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// ADMIN: server-side search of customers/users by name, email or phone. Used by
// the "Create referral link" dialog so picking a referrer scales to hundreds of
// records without loading them all into the client. Returns a short list.
// ---------------------------------------------------------------------------
export const searchCustomers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ query: z.string().max(120) }).parse(d))
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    await requireRafView(context.userId, email);
    // Sanitise: PostgREST `.or()` uses , and () as delimiters, and ilike treats
    // % and _ as wildcards. Strip those so a raw query can't break the filter.
    const safe = data.query.replace(/[,%_()*]/g, " ").trim();
    if (safe.length < 2)
      return [] as Array<{
        id: string;
        full_name: string | null;
        email: string | null;
        phone: string | null;
      }>;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const like = `%${safe}%`;

    // Phone column may not exist yet (pre-migration) — fall back to name/email.
    const withPhone = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, phone")
      .or(`full_name.ilike.${like},email.ilike.${like},phone.ilike.${like}`)
      .order("full_name", { ascending: true })
      .limit(10);
    if (withPhone.error) {
      const { data: basic, error } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email")
        .or(`full_name.ilike.${like},email.ilike.${like}`)
        .order("full_name", { ascending: true })
        .limit(10);
      if (error) throw new Error(error.message);
      return (basic ?? []).map((p) => ({ ...p, phone: null as string | null }));
    }
    return withPhone.data ?? [];
  });

// Public share base URL (APP_BASE_URL on server — used when copying RAF messages from localhost).
export const getPublicShareBaseUrl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => ({ baseUrl: getAppBaseUrl().replace(/\/$/, "") }));

// ---------------------------------------------------------------------------
// PUBLIC: resolve a code → its (active) referrer. Used by the /raf/<code> route
// to validate before setting the 'raf_ref' cookie. Mirrors resolveReferralSlug.
// ---------------------------------------------------------------------------
export async function resolveReferralCodeMeta(code: string): Promise<{
  id: string;
  code: string;
  referrer_name: string | null;
} | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: row, error } = await supabaseAdmin
    .from("referral_codes")
    .select("id, code, referrer_name, referrer_user_id")
    .eq("code", code)
    .eq("active", true)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw new Error(error.message);
  }
  if (!row) return null;

  let referrerName = row.referrer_name?.trim() || null;
  if (!referrerName && row.referrer_user_id) {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, email")
      .eq("id", row.referrer_user_id)
      .maybeSingle();
    referrerName = profile?.full_name?.trim() || profile?.email?.split("@")[0] || null;
  }

  return { id: row.id, code: row.code, referrer_name: referrerName };
}

export const resolveReferralCode = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ code: z.string().min(1).max(16) }).parse(d))
  .handler(async ({ data }) => resolveReferralCodeMeta(data.code));

// ---------------------------------------------------------------------------
// FRIEND: record a referral from the 'raf_ref' cookie. Called on the friend's
// first authenticated /home load. Idempotent (UNIQUE (code, referred_user_id))
// and self-referral guarded. Uses service_role to insert.
// ---------------------------------------------------------------------------
export const claimReferral = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ code: z.string().min(1).max(16) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: link, error: linkErr } = await supabaseAdmin
      .from("referral_codes")
      .select("id, code, referrer_user_id, active")
      .eq("code", data.code)
      .maybeSingle();
    if (linkErr) {
      if (isMissingTableError(linkErr)) return { ok: false, reason: "not_ready" as const };
      throw new Error(linkErr.message);
    }
    if (!link || link.active === false) return { ok: false, reason: "invalid" as const };

    // Self-referral guard: a user must not refer themselves.
    if (link.referrer_user_id && link.referrer_user_id === context.userId) {
      return { ok: false, reason: "self" as const };
    }

    // Already recorded for this friend + code? (idempotent)
    const { data: existing } = await supabaseAdmin
      .from("referrals")
      .select("id")
      .eq("code", link.code)
      .eq("referred_user_id", context.userId)
      .maybeSingle();
    if (existing) return { ok: true, reason: "already" as const };

    const email = (context.claims as { email?: string }).email ?? null;
    const { error: insErr } = await supabaseAdmin.from("referrals").insert({
      referral_code_id: link.id,
      code: link.code,
      referrer_user_id: link.referrer_user_id,
      referred_user_id: context.userId,
      referred_email: email,
      status: "signed_up",
      bonus_status: "none",
    });
    if (insErr) {
      // 23505 = the unique guard fired in a race → treat as already recorded.
      if (insErr.code === "23505") return { ok: true, reason: "already" as const };
      if (isMissingTableError(insErr)) return { ok: false, reason: "not_ready" as const };
      throw new Error(insErr.message);
    }
    return { ok: true, reason: "recorded" as const };
  });

// Advance the referral for a friend to 'qualified' once they complete a
// fact-find or book. Called from submitSession. Best-effort: swallows missing
// table errors and never throws into the caller's happy path.
export async function markReferralQualified(referredUserId: string): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: updated, error } = await supabaseAdmin
      .from("referrals")
      .update({
        status: "qualified",
        bonus_status: "eligible",
        updated_at: new Date().toISOString(),
      })
      .eq("referred_user_id", referredUserId)
      .in("status", ["pending", "signed_up"])
      .select("id");
    if (error && !isMissingTableError(error)) {
      console.error("markReferralQualified failed", error);
      return;
    }
    const { ensureRafCommissionLedgerEntry } = await import("@/lib/finance.functions");
    for (const row of updated ?? []) {
      await ensureRafCommissionLedgerEntry(row.id);
    }
  } catch (e) {
    console.error("markReferralQualified threw", e);
  }
}

// ---------------------------------------------------------------------------
// ADMIN: create a referral link for a referrer (existing user OR name+phone).
// ---------------------------------------------------------------------------
export const createReferralLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        referrerUserId: z.string().uuid().optional(),
        referrerName: z.string().min(2).max(120).optional(),
        referrerPhone: z.string().min(7).max(32).optional(),
      })
      .refine((v) => v.referrerUserId || (v.referrerName && v.referrerName.trim().length >= 2), {
        message: "Pick an existing customer or enter a referrer name.",
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    await requireRafAmend(context.userId, email);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Resolve referrer details. When an existing user is picked, backfill their
    // name/phone from their profile so the ledger + SMS have something to show.
    let referrerName = data.referrerName?.trim() || null;
    let referrerPhone = data.referrerPhone?.trim() || null;
    if (data.referrerUserId) {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("full_name, email, phone")
        .eq("id", data.referrerUserId)
        .maybeSingle();
      if (!referrerName) {
        referrerName = profile?.full_name?.trim() || profile?.email?.split("@")[0] || "Referrer";
      }
      if (!referrerPhone) referrerPhone = profile?.phone ?? null;
    }

    const code = await generateUniqueReferralCode();
    const { data: created, error } = await supabaseAdmin
      .from("referral_codes")
      .insert({
        code,
        referrer_user_id: data.referrerUserId ?? null,
        referrer_name: referrerName,
        referrer_phone: referrerPhone,
        created_by: context.userId,
      })
      .select("id, code, referrer_user_id, referrer_name, referrer_phone, active, created_at")
      .single();
    if (error) {
      if (isMissingTableError(error)) {
        throw new Error("Run the Refer-a-friend migration (APPLY_NEW_FEATURES.sql) first.");
      }
      throw new Error(error.message);
    }
    return created;
  });

// ---------------------------------------------------------------------------
// ADMIN: text the referral link to the REFERRER's phone so they can forward it.
// For texting a friend's number directly with the share message, use
// textRafInviteToFriend instead.
// ---------------------------------------------------------------------------
export const textReferralLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    await requireRafAmend(context.userId, email);
    if (!isTwilioConfigured()) {
      throw new Error(
        "SMS is not configured yet. Add Twilio credentials to your server environment.",
      );
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: link, error } = await supabaseAdmin
      .from("referral_codes")
      .select("id, code, referrer_name, referrer_phone")
      .eq("id", data.id)
      .single();
    if (error) {
      if (isMissingTableError(error)) throw new Error("Run the Refer-a-friend migration first.");
      throw new Error(error.message);
    }
    if (!link.referrer_phone) {
      throw new Error("This referrer has no phone number. Add one or copy the link instead.");
    }

    const url = `${getAppBaseUrl()}/raf/${link.code}`;
    const name = link.referrer_name ? `${link.referrer_name}, ` : "";
    const body = `Hi ${name}thanks for recommending Mortgage Hub! Share your personal link with friends: ${url}`;

    const { sid } = await sendSms({ to: link.referrer_phone, body });

    // Log to sms_messages if present (mirror booking.functions logSms).
    try {
      await supabaseAdmin.from("sms_messages").insert({
        direction: "outbound",
        from_number: process.env.TWILIO_PHONE_NUMBER!,
        to_number: link.referrer_phone,
        body,
        twilio_sid: sid,
      });
    } catch (e) {
      console.error("log RAF sms failed", e);
    }

    return { ok: true };
  });

// ---------------------------------------------------------------------------
// ADMIN: text a FRIEND's number with the full share message (who recommended +
// link). Use when the admin has the friend's mobile and wants to send the invite
// directly rather than asking the referrer to forward.
// ---------------------------------------------------------------------------
export const textRafInviteToFriend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), friendPhone: z.string().min(7).max(32) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string }).email;
    await requireRafAmend(context.userId, email);
    if (!isTwilioConfigured()) {
      throw new Error(
        "SMS is not configured yet. Add Twilio credentials to your server environment.",
      );
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: link, error } = await supabaseAdmin
      .from("referral_codes")
      .select("id, code, referrer_name")
      .eq("id", data.id)
      .single();
    if (error) {
      if (isMissingTableError(error)) throw new Error("Run the Refer-a-friend migration first.");
      throw new Error(error.message);
    }

    const body = rafShareMessage(link.referrer_name, link.code, getAppBaseUrl());
    const { sid } = await sendSms({ to: data.friendPhone, body });

    try {
      await supabaseAdmin.from("sms_messages").insert({
        direction: "outbound",
        from_number: process.env.TWILIO_PHONE_NUMBER!,
        to_number: data.friendPhone,
        body,
        twilio_sid: sid,
      });
    } catch (e) {
      console.error("log RAF friend sms failed", e);
    }

    return { ok: true };
  });

// ---------------------------------------------------------------------------
// ADMIN: list all referral links (with their referrer + referral counts).
// ---------------------------------------------------------------------------
export const listReferralLinks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string }).email;
    await requireRafView(context.userId, email);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: links, error } = await supabaseAdmin
      .from("referral_codes")
      .select("id, code, referrer_user_id, referrer_name, referrer_phone, active, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      if (isMissingTableError(error)) return [];
      throw new Error(error.message);
    }

    // Count referrals per code so the admin sees uptake at a glance.
    const counts = new Map<string, number>();
    const { data: refs, error: refErr } = await supabaseAdmin.from("referrals").select("code");
    if (refErr && !isMissingTableError(refErr)) throw new Error(refErr.message);
    for (const r of refs ?? []) {
      if (r.code) counts.set(r.code, (counts.get(r.code) ?? 0) + 1);
    }

    return (links ?? []).map((l) => ({ ...l, referralCount: counts.get(l.code) ?? 0 }));
  });

// ---------------------------------------------------------------------------
// ADMIN: list the full referral ledger (with referrer + referred names).
// ---------------------------------------------------------------------------
export const listAllReferrals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string }).email;
    await requireRafView(context.userId, email);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: refs, error } = await supabaseAdmin
      .from("referrals")
      .select(
        "id, code, referrer_user_id, referred_user_id, referred_email, status, bonus_status, notes, created_at, updated_at",
      )
      .order("created_at", { ascending: false });
    if (error) {
      if (isMissingTableError(error)) return [];
      throw new Error(error.message);
    }

    // Resolve referrer display names. Code-level referrer_name covers off-system
    // referrers; profile names cover existing users.
    const { data: codes, error: codeErr } = await supabaseAdmin
      .from("referral_codes")
      .select("code, referrer_name");
    if (codeErr && !isMissingTableError(codeErr)) throw new Error(codeErr.message);
    const codeName = new Map<string, string | null>();
    for (const c of codes ?? []) codeName.set(c.code, c.referrer_name ?? null);

    const userIds = Array.from(
      new Set(
        [
          ...(refs ?? []).map((r) => r.referrer_user_id),
          ...(refs ?? []).map((r) => r.referred_user_id),
        ].filter(Boolean) as string[],
      ),
    );
    const profileMap = new Map<string, { full_name: string | null; email: string | null; phone: string | null }>();
    if (userIds.length > 0) {
      const withPhone = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email, phone")
        .in("id", userIds);
      if (withPhone.error) {
        const { data: basic } = await supabaseAdmin
          .from("profiles")
          .select("id, full_name, email")
          .in("id", userIds);
        for (const p of basic ?? []) {
          profileMap.set(p.id, { full_name: p.full_name, email: p.email, phone: null });
        }
      } else {
        for (const p of withPhone.data ?? []) {
          profileMap.set(p.id, {
            full_name: p.full_name,
            email: p.email,
            phone: (p as { phone?: string | null }).phone ?? null,
          });
        }
      }
    }

    return (refs ?? []).map((r) => {
      const refProfile = r.referrer_user_id ? profileMap.get(r.referrer_user_id) : null;
      const friendProfile = r.referred_user_id ? profileMap.get(r.referred_user_id) : null;
      return {
        ...r,
        referrerName:
          refProfile?.full_name ||
          refProfile?.email ||
          (r.code ? codeName.get(r.code) : null) ||
          "Referrer",
        referredName:
          friendProfile?.full_name || friendProfile?.email || r.referred_email || "Friend",
        referredPhone: friendProfile?.phone ?? null,
        referredEmail: friendProfile?.email ?? r.referred_email ?? null,
      };
    });
  });

// ---------------------------------------------------------------------------
// ADMIN: update a referral's bonus_status (and optionally its status / notes).
// ---------------------------------------------------------------------------
export const updateReferralBonusStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        bonusStatus: z.enum(["none", "eligible", "paid", "rejected"]).optional(),
        status: z.enum(["pending", "signed_up", "qualified", "rewarded"]).optional(),
        notes: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { resolveAdminAccess } = await import("@/lib/admin.functions");
    const { canAmend } = await import("@/lib/admin-access");
    const email = (context.claims as { email?: string }).email;
    const access = await resolveAdminAccess(context.userId, email);
    if (!canAmend(access, "finance_raf") && !access.isOwner && !access.isSupervisor) {
      await requireAdmin(context.userId);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { ensureRafCommissionLedgerEntry } = await import("@/lib/finance.functions");

    const patch: {
      updated_at: string;
      bonus_status?: string;
      status?: string;
      notes?: string | null;
    } = { updated_at: new Date().toISOString() };
    if (data.bonusStatus) patch.bonus_status = data.bonusStatus;
    if (data.status) patch.status = data.status;
    if (data.notes !== undefined) patch.notes = data.notes || null;

    const { error } = await supabaseAdmin.from("referrals").update(patch).eq("id", data.id);
    if (error) {
      if (isMissingTableError(error)) throw new Error("Run the Refer-a-friend migration first.");
      throw new Error(error.message);
    }

    if (data.bonusStatus === "eligible") {
      await ensureRafCommissionLedgerEntry(data.id, context.userId);
    }

    if (data.bonusStatus === "paid" || data.bonusStatus === "rejected") {
      const payoutStatus = data.bonusStatus === "paid" ? "paid" : "rejected";
      const { data: ledgerRow } = await supabaseAdmin
        .from("finance_ledger")
        .select("id")
        .eq("referral_id", data.id)
        .eq("kind", "commission")
        .maybeSingle();
      if (ledgerRow) {
        await supabaseAdmin
          .from("finance_ledger")
          .update({
            payout_status: payoutStatus,
            payout_at: new Date().toISOString(),
            payout_by: context.userId,
          })
          .eq("id", ledgerRow.id);
      }
    }

    return { ok: true };
  });

// ---------------------------------------------------------------------------
// CUSTOMER: self-serve RAF — view referral links and track referred friends.
// ---------------------------------------------------------------------------
export const listMyReferralActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: codes, error: codeErr } = await supabaseAdmin
      .from("referral_codes")
      .select("id, code, active, created_at")
      .eq("referrer_user_id", context.userId)
      .order("created_at", { ascending: false });
    if (codeErr) {
      if (isMissingTableError(codeErr)) return { codes: [], referrals: [], migrationRequired: true };
      throw new Error(codeErr.message);
    }

    const codeList = (codes ?? []).map((c) => c.code);
    let referrals: Array<{
      id: string;
      code: string;
      referredEmail: string | null;
      referredPhone: string | null;
      status: string;
      bonusStatus: string;
      createdAt: string;
    }> = [];
    if (codeList.length > 0) {
      const { data: refs, error: refErr } = await supabaseAdmin
        .from("referrals")
        .select("id, code, referred_email, referred_phone, status, bonus_status, created_at")
        .in("code", codeList)
        .order("created_at", { ascending: false });
      if (refErr && !isMissingTableError(refErr)) throw new Error(refErr.message);
      referrals = (refs ?? []).map((r) => ({
        id: r.id,
        code: r.code,
        referredEmail: r.referred_email ?? null,
        referredPhone: r.referred_phone ?? null,
        status: r.status,
        bonusStatus: r.bonus_status,
        createdAt: r.created_at,
      }));
    }

    return {
      codes: codes ?? [],
      referrals,
      migrationRequired: false,
    };
  });

export const ensureMyReferralLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin
      .from("referral_codes")
      .select("id, code")
      .eq("referrer_user_id", context.userId)
      .eq("active", true)
      .limit(1)
      .maybeSingle();
    if (existing) return { code: existing.code };

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, phone")
      .eq("id", context.userId)
      .maybeSingle();

    const code = await generateUniqueReferralCode();
    const { data: inserted, error } = await supabaseAdmin
      .from("referral_codes")
      .insert({
        code,
        referrer_user_id: context.userId,
        referrer_name: profile?.full_name ?? null,
        referrer_phone: profile?.phone ?? null,
        active: true,
        created_by: context.userId,
      })
      .select("code")
      .single();
    if (error) {
      if (isMissingTableError(error)) throw new Error("Run the Refer-a-friend migration first.");
      throw new Error(error.message);
    }
    return { code: inserted.code };
  });
