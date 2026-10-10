import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { isTwilioConfigured, sendSms, getAppBaseUrl, getSmsSenderLabel } from "@/lib/sms.server";
import { rafShareMessage } from "@/lib/referral";
import { normalisePublicTenantSlug } from "@/lib/tenant-presentation";
import { canAmend, canView } from "@/lib/admin-access";
import type { ResourceCapability } from "@/lib/tenant-assert.server";
import type { TenantRoleView } from "@/lib/tenant-role";

// ============================================================================
// Refer a friend (RAF) — ADMIN-DRIVEN.
//
// An admin mints a referral CODE for a specific REFERRER (an existing
// customer/user, or an off-system person captured via name + phone). The
// referrer shares /raf/<code> with their friends. A friend landing via that
// link gets a 'raf_ref' cookie (kept SEPARATE from introducer attribution);
// on the friend's first authenticated /home load the referral is recorded
// crediting the referrer (claimReferral). The bonus is TRACKED ONLY — no RAF
// ledger accrual exists.
//
// B4c-1 lifecycle (referrals.bonus_status): none (referral recorded) → provisional
// (the friend submitted a fact-find while the programme is enabled and a bonus is
// configured) → completion_verified → earned → payment_approved → paid, or
// rejected / cancelled. A bonus is earned only upon verified completion of the
// referred customer's mortgage; until the completion record exists (B4c-2) no
// referral can reach completion_verified or later. eligible is a legacy value,
// kept as recorded. Every change goes through a database RPC that records an
// append-only transition and an audit row.
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

async function slugMapForTenantIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: { from: (table: string) => any },
  tenantIds: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const ids = [...new Set(tenantIds.filter((id): id is string => Boolean(id)))];
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const { data } = await admin
    .from("tenants")
    .select("id, slug, status")
    .in("id", ids)
    .eq("status", "active");
  for (const row of (data ?? []) as Array<{ id: string; slug: string | null }>) {
    const slug = normalisePublicTenantSlug(row.slug);
    if (slug) map.set(row.id, slug);
  }
  return map;
}

async function tenantSlugFromReferralRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: { from: (table: string) => any },
  tenantId: string | null | undefined,
): Promise<string | null> {
  const map = await slugMapForTenantIds(admin, [tenantId]);
  return tenantId ? map.get(tenantId) ?? null : null;
}

async function getRolesForUser(userId: string): Promise<string[]> {
  const { resolveActingTenantRole } = await import("@/lib/tenant-role.server");
  const view = await resolveActingTenantRole(userId);
  const roles: string[] = [];
  if (view.isAdvisor) roles.push("advisor");
  if (view.isMainAdmin) roles.push("admin");
  if (view.isIntroducer) roles.push("introducer");
  return roles;
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

function rafViewCapability(): ResourceCapability {
  return {
    mutate: false,
    allocation: "none",
    allow: (v) =>
      v.adminAccess.isOwner ||
      v.adminAccess.isSupervisor ||
      canView(v.adminAccess, "raf") ||
      v.isMainAdmin,
  };
}

// The isMainAdmin fallback keeps General Admin's pre-B1c RAF authority (allocation is S4D).
function rafAmendCapability(): ResourceCapability {
  return {
    mutate: true,
    allocation: "none",
    allow: (v) =>
      v.adminAccess.isOwner ||
      v.adminAccess.isSupervisor ||
      canAmend(v.adminAccess, "raf") ||
      v.isMainAdmin,
  };
}

const RAF_DECISION_FORBIDDEN_MESSAGE =
  "Only an Owner or Supervisor of this company can make Refer a Friend bonus decisions.";
const RAF_PLATFORM_DECISION_MESSAGE =
  "Refer a Friend bonus decisions are made by the company's own Owner or Supervisor. Platform access cannot make them.";

/** Bonus decisions: an Owner or Supervisor by active membership of the acting tenant. */
function assertRafDecisionMaker(view: TenantRoleView): void {
  if (view.accessContext === "platform_access") throw new Error(RAF_PLATFORM_DECISION_MESSAGE);
  if (!view.member || !(view.isOwner || view.isSupervisor)) {
    throw new Error(RAF_DECISION_FORBIDDEN_MESSAGE);
  }
}

/** Customer-facing progress for a referral's bonus status. */
function referralProgressLabel(bonusStatus: string | null | undefined): string {
  switch (bonusStatus) {
    case "provisional":
    case "eligible":
      return "Fact-find submitted";
    case "completion_verified":
    case "earned":
      return "Bonus earned";
    case "payment_approved":
      return "Bonus approved";
    case "paid":
      return "Bonus paid";
    case "rejected":
      return "Not eligible";
    case "cancelled":
      return "Cancelled";
    default:
      return "Signed up";
  }
}

/** The tenant's Refer a Friend programme: feature enabled and the configured bonus (if any). */
async function rafProgrammeForTenant(
  tenantId: string,
): Promise<{ enabled: boolean; bonusPence: number | null }> {
  const { supabaseAdminUntyped: supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );
  const { isTenantFeatureEnabled } = await import("@/lib/tenant-features.server");
  const { getRafBonusPence } = await import("@/lib/finance.functions");
  const [enabled, configured] = await Promise.all([
    isTenantFeatureEnabled(tenantId, "refer_a_friend"),
    getRafBonusPence(supabaseAdmin, tenantId),
  ]);
  return { enabled, bonusPence: configured != null && configured > 0 ? configured : null };
}

/** People related to a tenant: active members (any role) and customers of its sessions. */
async function tenantPeopleIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: { from: (table: string) => any },
  tenantId: string,
): Promise<string[]> {
  const ids = new Set<string>();
  const { data: members, error: mErr } = await admin
    .from("tenant_memberships")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("active", true);
  if (mErr) throw new Error(mErr.message);
  for (const m of (members ?? []) as Array<{ user_id: string | null }>) {
    if (m.user_id) ids.add(m.user_id);
  }
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data: rows, error } = await admin
      .from("interview_sessions")
      .select("customer_id")
      .eq("tenant_id", tenantId)
      .not("customer_id", "is", null)
      .order("id", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as Array<{ customer_id: string | null }>;
    for (const r of list) if (r.customer_id) ids.add(r.customer_id);
    if (list.length < page) break;
  }
  return [...ids];
}

/** Effective tenant of RAF rows: own tenant_id, else the referral code's tenant. */
async function scopeReferralRowsToTenant<
  T extends { tenant_id?: string | null; referral_code_id?: string | null },
>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: { from: (table: string) => any },
  rows: T[],
  tenantId: string,
): Promise<T[]> {
  const codeIds = [
    ...new Set(
      rows
        .filter((r) => !r.tenant_id && r.referral_code_id)
        .map((r) => r.referral_code_id as string),
    ),
  ];
  const codeTenant = new Map<string, string | null>();
  if (codeIds.length > 0) {
    const { data, error } = await admin
      .from("referral_codes")
      .select("id, tenant_id")
      .in("id", codeIds);
    if (error && !isMissingTableError(error)) throw new Error(error.message);
    for (const c of (data ?? []) as Array<{ id: string; tenant_id: string | null }>) {
      codeTenant.set(c.id, c.tenant_id);
    }
  }
  return rows.filter((r) => {
    const effective =
      r.tenant_id ?? (r.referral_code_id ? (codeTenant.get(r.referral_code_id) ?? null) : null);
    return effective === tenantId;
  });
}

// Generate a referral code that doesn't collide with an existing one.
async function generateUniqueReferralCode(): Promise<string> {
  const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
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
    type CustomerHit = {
      id: string;
      full_name: string | null;
      email: string | null;
      phone: string | null;
    };
    const { resolveActingTenantForList, selectInChunks } =
      await import("@/lib/tenant-assert.server");
    const { tenantId } = await resolveActingTenantForList(context.userId, rafViewCapability());
    // Sanitise: PostgREST `.or()` uses , and () as delimiters, and ilike treats
    // % and _ as wildcards. Strip those so a raw query can't break the filter.
    const safe = data.query.replace(/[,%_()*]/g, " ").trim();
    if (safe.length < 2) return [] as CustomerHit[];

    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const like = `%${safe}%`;

    const candidateIds = await tenantPeopleIds(supabaseAdmin, tenantId);
    if (candidateIds.length === 0) return [] as CustomerHit[];

    const byName = (a: CustomerHit, b: CustomerHit) =>
      String(a.full_name ?? "").localeCompare(String(b.full_name ?? ""));

    // Phone column may not exist yet (pre-migration) — fall back to name/email.
    try {
      const hits = await selectInChunks(candidateIds, async (chunk) => {
        const { data: part, error } = await supabaseAdmin
          .from("profiles")
          .select("id, full_name, email, phone")
          .in("id", chunk)
          .or(`full_name.ilike.${like},email.ilike.${like},phone.ilike.${like}`)
          .order("full_name", { ascending: true })
          .limit(10);
        if (error) throw error;
        return (part ?? []) as CustomerHit[];
      });
      return hits.sort(byName).slice(0, 10);
    } catch {
      const hits = await selectInChunks(candidateIds, async (chunk) => {
        const { data: part, error } = await supabaseAdmin
          .from("profiles")
          .select("id, full_name, email")
          .in("id", chunk)
          .or(`full_name.ilike.${like},email.ilike.${like}`)
          .order("full_name", { ascending: true })
          .limit(10);
        if (error) throw new Error(error.message);
        return ((part ?? []) as Omit<CustomerHit, "phone">[]).map((p) => ({
          ...p,
          phone: null as string | null,
        }));
      });
      return hits.sort(byName).slice(0, 10);
    }
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
  tenantSlug: string | null;
} | null> {
  const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
  const { data: row, error } = await supabaseAdmin
    .from("referral_codes")
    .select("id, code, referrer_name, referrer_user_id, tenant_id")
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

  let tenantSlug: string | null = null;
  const tenantId = (row as { tenant_id?: string | null }).tenant_id;
  if (tenantId) {
    const { data: tenantRow } = await supabaseAdmin
      .from("tenants")
      .select("slug, status")
      .eq("id", tenantId)
      .maybeSingle();
    if (tenantRow?.status === "active") {
      tenantSlug = normalisePublicTenantSlug(tenantRow.slug);
    }
  }

  return { id: row.id, code: row.code, referrer_name: referrerName, tenantSlug };
}

// PUBLIC: resolve a code → ONLY its owning tenant slug (never the referrer identity). Used by
// the bare /raf/<code> route to bootstrap-redirect into the code's tenant. Exposing the tenant
// is intentional (B2a allows the bootstrap redirect); the referrer name is withheld until a
// tenant is proven.
export async function resolveReferralCodeTenantSlug(
  code: string,
): Promise<{ tenantSlug: string | null }> {
  const meta = await resolveReferralCodeMeta(code);
  return { tenantSlug: meta?.tenantSlug ?? null };
}

// TENANT-SCOPED: resolve a code → referrer identity ONLY when the caller already presents the
// code's owning tenant slug (the tenant-prefixed /$tenantSlug/raf/<code> route). A mismatched or
// unknown tenant yields null, so the referrer name is never disclosed before tenant validation.
export async function resolveReferralCodeMetaForTenant(
  code: string,
  tenantSlug: string,
): Promise<{ referrer_name: string | null; tenantSlug: string } | null> {
  const meta = await resolveReferralCodeMeta(code);
  if (!meta?.tenantSlug || meta.tenantSlug !== tenantSlug) return null;
  return { referrer_name: meta.referrer_name, tenantSlug: meta.tenantSlug };
}

// ---------------------------------------------------------------------------
// FRIEND: record a referral from the 'raf_ref' cookie. Called on the friend's
// first authenticated /home load. Idempotent (UNIQUE (code, referred_user_id))
// and self-referral guarded. Uses service_role to insert.
// ---------------------------------------------------------------------------
export const claimReferral = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ code: z.string().min(1).max(16) }).parse(d))
  .handler(async ({ data, context }) => {
    // B2a: the RAF code (from the untrusted 'raf_ref' cookie) is referral context, not tenant
    // authority. Resolve the caller's canonical acting tenant first; an ambiguous or missing
    // tenant fails closed (no claim) rather than guessing a membership or trusting the code.
    const { resolveActingTenant, withForcedTenantId } = await import("@/lib/tenant-assert.server");
    let tenantId: string;
    try {
      ({ tenantId } = await resolveActingTenant(context.userId));
    } catch {
      // No verified single acting tenant (0 / 2+ memberships, no verified slug): record nothing
      // and let the customer's legitimate journey continue. The code itself was not judged, so
      // the caller keeps it for a later attempt.
      return { ok: false, reason: "tenant_unresolved" as const };
    }

    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    // Tenant-scoped code lookup: a code that exists only in another tenant is indistinguishable
    // from an unknown code (no cross-tenant existence leak).
    const { data: link, error: linkErr } = await supabaseAdmin
      .from("referral_codes")
      .select("id, code, referrer_user_id, active, tenant_id")
      .eq("code", data.code)
      .eq("tenant_id", tenantId)
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

    // Already recorded for this friend + code in this tenant? (idempotent, tenant-bound so a
    // referral in another tenant can never satisfy or suppress a legitimate claim here).
    const { data: existing } = await supabaseAdmin
      .from("referrals")
      .select("id")
      .eq("code", link.code)
      .eq("referred_user_id", context.userId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (existing) return { ok: true, reason: "already" as const };

    const email = (context.claims as { email?: string }).email ?? null;
    const { error: insErr } = await supabaseAdmin.from("referrals").insert(
      withForcedTenantId(
        {
          referral_code_id: link.id,
          code: link.code,
          referrer_user_id: link.referrer_user_id,
          referred_user_id: context.userId,
          referred_email: email,
          status: "signed_up",
          bonus_status: "none",
        },
        tenantId,
      ),
    );
    if (insErr) {
      // 23505 = the unique guard fired in a race → treat as already recorded.
      if (insErr.code === "23505") return { ok: true, reason: "already" as const };
      // The database refuses a claim whose code is no longer active or no longer matches.
      if ((insErr.message ?? "").includes("raf_referral_invalid")) {
        return { ok: false, reason: "invalid" as const };
      }
      if (isMissingTableError(insErr)) return { ok: false, reason: "not_ready" as const };
      throw new Error(insErr.message);
    }
    return { ok: true, reason: "recorded" as const };
  });

// A friend's submitted fact-find provisionally qualifies their referral. Called from
// submitSession. Best-effort: never throws into the caller's happy path.
export async function markReferralQualified(
  referredUserId: string,
  tenantId: string | null,
  sessionId: string,
): Promise<void> {
  // B2b: RAF qualification is tenant-scoped. The authoritative tenant is the submitted interview
  // session's tenant (passed by submitSession) — never derived from the referral, cookie, email,
  // phone, or a membership guess. Without an authoritative tenant we FAIL CLOSED: no referral is
  // qualified, so foreign-tenant and tenantless referrals are never touched.
  if (!tenantId) return;
  try {
    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    // B4c-1: provisional only, and only from this customer's own submitted session in that tenant
    // while Refer a Friend is enabled and a bonus is configured. A fact-find never earns a bonus
    // and creates no financial record (RAF ledger accrual stays deferred).
    const { error } = await supabaseAdmin.rpc("record_referral_provisional_qualification", {
      p_tenant_id: tenantId,
      p_customer_user_id: referredUserId,
      p_session_id: sessionId,
    });
    if (error && !isMissingTableError(error)) {
      console.error("markReferralQualified failed", error);
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
    const { resolveActingTenantForList, RESOURCE_NOT_FOUND_MESSAGE, withForcedTenantId } =
      await import("@/lib/tenant-assert.server");
    const { tenantId, view } = await resolveActingTenantForList(
      context.userId,
      rafAmendCapability(),
    );
    // Referral codes attribute future bonuses, so they are minted by the company's own staff.
    if (!view.member) {
      throw new Error(
        "Referral links are created by the company's own staff. Platform access cannot create them.",
      );
    }
    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    // Resolve referrer details. When an existing user is picked, backfill their
    // name/phone from their profile so the ledger + SMS have something to show.
    let referrerName = data.referrerName?.trim() || null;
    let referrerPhone = data.referrerPhone?.trim() || null;
    if (data.referrerUserId) {
      const people = await tenantPeopleIds(supabaseAdmin, tenantId);
      if (!people.includes(data.referrerUserId)) throw new Error(RESOURCE_NOT_FOUND_MESSAGE);
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
      .insert(
        withForcedTenantId(
          {
            code,
            referrer_user_id: data.referrerUserId ?? null,
            referrer_name: referrerName,
            referrer_phone: referrerPhone,
            created_by: context.userId,
          },
          tenantId,
        ),
      )
      .select("id, code, referrer_user_id, referrer_name, referrer_phone, active, created_at, tenant_id")
      .single();
    if (error) {
      if (/raf_referral_code_(forbidden|invalid)/.test(error.message ?? "")) {
        throw new Error("You cannot create a referral link for this referrer in this company.");
      }
      if (isMissingTableError(error)) {
        throw new Error("Run the Refer-a-friend migration (APPLY_NEW_FEATURES.sql) first.");
      }
      throw new Error(error.message);
    }
    return { ...created, tenantSlug: view.tenantSlug ?? null };
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
    const { resolveActingTenantForList, RESOURCE_NOT_FOUND_MESSAGE } =
      await import("@/lib/tenant-assert.server");
    const { tenantId } = await resolveActingTenantForList(context.userId, rafAmendCapability());
    if (!isTwilioConfigured()) {
      throw new Error(
        "SMS is not configured yet. Add Twilio credentials to your server environment.",
      );
    }
    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { data: link, error } = await supabaseAdmin
      .from("referral_codes")
      .select("id, code, referrer_name, referrer_phone, tenant_id")
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) {
      if (isMissingTableError(error)) throw new Error("Run the Refer-a-friend migration first.");
      throw new Error(error.message);
    }
    if (!link) throw new Error(RESOURCE_NOT_FOUND_MESSAGE);
    if (!link.referrer_phone) {
      throw new Error("This referrer has no phone number. Add one or copy the link instead.");
    }

    const tenantSlug = await tenantSlugFromReferralRow(
      supabaseAdmin,
      (link as { tenant_id?: string | null }).tenant_id,
    );
    if (!tenantSlug) {
      throw new Error("Cannot send this referral link because the firm is not available.");
    }
    const { buildCanonicalRafPath } = await import("@/lib/tenant-url");
    const url = `${getAppBaseUrl().replace(/\/$/, "")}${buildCanonicalRafPath(tenantSlug, link.code)}`;
    const name = link.referrer_name ? `${link.referrer_name}, ` : "";
    const body = `Hi ${name}thanks for recommending Mortgage Hub! Share your personal link with friends: ${url}`;

    const { sid } = await sendSms({ to: link.referrer_phone, body });

    // Log to sms_messages if present (mirror booking.functions logSms).
    try {
      await supabaseAdmin.from("sms_messages").insert({
        direction: "outbound",
        from_number: getSmsSenderLabel(),
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
    const { resolveActingTenantForList, RESOURCE_NOT_FOUND_MESSAGE } =
      await import("@/lib/tenant-assert.server");
    const { tenantId } = await resolveActingTenantForList(context.userId, rafAmendCapability());
    if (!isTwilioConfigured()) {
      throw new Error(
        "SMS is not configured yet. Add Twilio credentials to your server environment.",
      );
    }
    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { data: link, error } = await supabaseAdmin
      .from("referral_codes")
      .select("id, code, referrer_name, tenant_id")
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) {
      if (isMissingTableError(error)) throw new Error("Run the Refer-a-friend migration first.");
      throw new Error(error.message);
    }
    if (!link) throw new Error(RESOURCE_NOT_FOUND_MESSAGE);

    const tenantSlug = await tenantSlugFromReferralRow(
      supabaseAdmin,
      (link as { tenant_id?: string | null }).tenant_id,
    );
    if (!tenantSlug) {
      throw new Error("Cannot send this referral link because the firm is not available.");
    }
    const body = rafShareMessage(link.referrer_name, link.code, tenantSlug, getAppBaseUrl());
    if (!body) {
      throw new Error("Cannot send this referral link because the firm is not available.");
    }
    const { sid } = await sendSms({ to: data.friendPhone, body });

    try {
      await supabaseAdmin.from("sms_messages").insert({
        direction: "outbound",
        from_number: getSmsSenderLabel(),
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
    const { resolveActingTenantForList } = await import("@/lib/tenant-assert.server");
    const { tenantId } = await resolveActingTenantForList(context.userId, rafViewCapability());
    const { supabaseAdminUntyped: supabaseAdmin } =
      await import("@/integrations/supabase/client.server");

    const { data: links, error } = await supabaseAdmin
      .from("referral_codes")
      .select(
        "id, code, referrer_user_id, referrer_name, referrer_phone, active, created_at, tenant_id",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (error) {
      if (isMissingTableError(error)) return [];
      throw new Error(error.message);
    }

    // Count referrals per code so the admin sees uptake at a glance.
    const counts = new Map<string, number>();
    const { data: refsRaw, error: refErr } = await supabaseAdmin
      .from("referrals")
      .select("code, tenant_id, referral_code_id");
    if (refErr && !isMissingTableError(refErr)) throw new Error(refErr.message);
    const refs = await scopeReferralRowsToTenant(
      supabaseAdmin,
      (refsRaw ?? []) as Array<{
        code: string | null;
        tenant_id: string | null;
        referral_code_id: string | null;
      }>,
      tenantId,
    );
    for (const r of refs) {
      if (r.code) counts.set(r.code, (counts.get(r.code) ?? 0) + 1);
    }

    const slugByTenant = await slugMapForTenantIds(
      supabaseAdmin,
      (links ?? []).map((l: { tenant_id?: string | null }) => l.tenant_id),
    );

    return (links ?? []).map((l: { tenant_id?: string | null; code: string }) => ({
      ...l,
      referralCount: counts.get(l.code) ?? 0,
      tenantSlug: (l as { tenant_id?: string | null }).tenant_id
        ? slugByTenant.get((l as { tenant_id: string }).tenant_id) ?? null
        : null,
    }));
  });

// ---------------------------------------------------------------------------
// ADMIN: list the full referral ledger (with referrer + referred names).
// ---------------------------------------------------------------------------
export const listAllReferrals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { resolveActingTenantForList } = await import("@/lib/tenant-assert.server");
    const { tenantId } = await resolveActingTenantForList(context.userId, rafViewCapability());
    const { supabaseAdminUntyped: supabaseAdmin } =
      await import("@/integrations/supabase/client.server");

    const { data: refsRaw, error } = await supabaseAdmin
      .from("referrals")
      .select(
        "id, code, referrer_user_id, referred_user_id, referred_email, status, bonus_status, notes, created_at, updated_at, tenant_id, referral_code_id",
      )
      .order("created_at", { ascending: false });
    if (error) {
      if (isMissingTableError(error)) return [];
      throw new Error(error.message);
    }
    const refs = await scopeReferralRowsToTenant(
      supabaseAdmin,
      (refsRaw ?? []) as Array<{
        id: string;
        code: string | null;
        referrer_user_id: string | null;
        referred_user_id: string | null;
        referred_email: string | null;
        status: string;
        bonus_status: string;
        notes: string | null;
        created_at: string;
        updated_at: string;
        tenant_id: string | null;
        referral_code_id: string | null;
      }>,
      tenantId,
    );

    // Resolve referrer display names. Code-level referrer_name covers off-system
    // referrers; profile names cover existing users.
    const { data: codes, error: codeErr } = await supabaseAdmin
      .from("referral_codes")
      .select("code, referrer_name")
      .eq("tenant_id", tenantId);
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

    // Several referrers may have claimed the same customer: every claim stays recorded, and only
    // one of them may progress to a financial state.
    const claimsByCustomer = new Map<string, number>();
    for (const r of refs) {
      if (r.referred_user_id) {
        claimsByCustomer.set(r.referred_user_id, (claimsByCustomer.get(r.referred_user_id) ?? 0) + 1);
      }
    }

    const lastTransition = new Map<
      string,
      { toStatus: string; reason: string | null; actorRole: string; recordedAt: string }
    >();
    if (refs.length > 0) {
      const { selectInChunks } = await import("@/lib/tenant-assert.server");
      const transitions = await selectInChunks(
        refs.map((r) => r.id),
        async (chunk) => {
          const { data: part, error: tErr } = await supabaseAdmin
            .from("referral_bonus_transitions")
            .select("referral_id, to_status, reason, actor_role, recorded_at")
            .eq("tenant_id", tenantId)
            .in("referral_id", chunk);
          if (tErr) {
            if (isMissingTableError(tErr)) return [];
            throw new Error(tErr.message);
          }
          return (part ?? []) as Array<{
            referral_id: string;
            to_status: string;
            reason: string | null;
            actor_role: string;
            recorded_at: string;
          }>;
        },
      );
      for (const t of transitions) {
        const seen = lastTransition.get(t.referral_id);
        if (!seen || seen.recordedAt < t.recorded_at) {
          lastTransition.set(t.referral_id, {
            toStatus: t.to_status,
            reason: t.reason,
            actorRole: t.actor_role,
            recordedAt: t.recorded_at,
          });
        }
      }
    }

    return (refs ?? []).map((r) => {
      const refProfile = r.referrer_user_id ? profileMap.get(r.referrer_user_id) : null;
      const friendProfile = r.referred_user_id ? profileMap.get(r.referred_user_id) : null;
      return {
        ...r,
        competingClaims: r.referred_user_id ? (claimsByCustomer.get(r.referred_user_id) ?? 1) - 1 : 0,
        lastTransition: lastTransition.get(r.id) ?? null,
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
// ADMIN: Refer a Friend programme settings for the acting tenant (display only).
// ---------------------------------------------------------------------------
export const getRafProgrammeSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { resolveActingTenantForList } = await import("@/lib/tenant-assert.server");
    const { tenantId } = await resolveActingTenantForList(context.userId, rafViewCapability());
    return rafProgrammeForTenant(tenantId);
  });

// ---------------------------------------------------------------------------
// ADMIN: Owner/Supervisor bonus decision on one referral. The database RPC is the authority: it
// re-checks the actor's membership role, compares-and-sets on expectedStatus, records the
// append-only transition and the audit row atomically, and replays a repeated requestId.
// Outcomes: "applied" (this request changed the bonus status) or "already_applied" (a replay of
// this request, or the status already holds the requested value); anything else throws.
// ---------------------------------------------------------------------------
const REFERRAL_BONUS_CONFLICT_MESSAGE =
  "This referral bonus was changed by someone else. Refresh and try again.";

const RAF_BONUS_STATUSES = [
  "none",
  "provisional",
  "eligible",
  "completion_verified",
  "earned",
  "payment_approved",
  "paid",
  "rejected",
  "cancelled",
] as const;

const RAF_DECISION_ERRORS: Array<[string, string]> = [
  ["finance_forbidden", RAF_DECISION_FORBIDDEN_MESSAGE],
  ["raf_status_conflict", REFERRAL_BONUS_CONFLICT_MESSAGE],
  [
    "raf_request_conflict",
    "This request was already used for a different change. Refresh and try again.",
  ],
  ["raf_bonus_terminal", "A paid or cancelled referral bonus cannot be changed."],
  [
    "raf_completion_record_required",
    "A Refer a Friend bonus is earned only when the referred customer's mortgage completion has been verified. Completion verification is not available yet.",
  ],
  ["raf_reason_required", "A reason is required for this change."],
  [
    "raf_programme_not_configured",
    "Refer a Friend is not enabled or no bonus is configured, so this referral cannot return to provisionally qualified.",
  ],
  [
    "raf_competing_referral",
    "Another referral for this customer is already progressing to a bonus.",
  ],
  ["raf_transition_invalid", "That bonus status change is not allowed."],
];

export const updateReferralBonusStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        bonusStatus: z.enum(RAF_BONUS_STATUSES),
        expectedStatus: z.enum(RAF_BONUS_STATUSES),
        reason: z.string().max(500).optional(),
        requestId: z.string().uuid(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { resolveActingTenantForList, RESOURCE_NOT_FOUND_MESSAGE } =
      await import("@/lib/tenant-assert.server");
    const { tenantId, view } = await resolveActingTenantForList(
      context.userId,
      rafViewCapability(),
    );
    assertRafDecisionMaker(view);

    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: result, error } = await supabaseAdmin.rpc("set_referral_bonus_status", {
      p_tenant_id: tenantId,
      p_actor_user_id: context.userId,
      p_referral_id: data.id,
      p_expected_status: data.expectedStatus,
      p_to_status: data.bonusStatus,
      p_reason: data.reason?.trim() || null,
      p_request_id: data.requestId,
    });
    if (error) {
      const message = error.message ?? "";
      if (message.includes("raf_resource_not_found")) throw new Error(RESOURCE_NOT_FOUND_MESSAGE);
      for (const [code, friendly] of RAF_DECISION_ERRORS) {
        if (message.includes(code)) throw new Error(friendly);
      }
      if (isMissingTableError(error)) throw new Error("Run the Refer-a-friend migration first.");
      throw new Error(message);
    }
    const outcome = (result as { outcome?: string } | null)?.outcome;
    if (outcome !== "applied" && outcome !== "already_applied") {
      throw new Error(REFERRAL_BONUS_CONFLICT_MESSAGE);
    }
    return {
      ok: true,
      outcome,
      bonusStatus: (result as { bonus_status?: string }).bonus_status ?? data.bonusStatus,
    };
  });

// ---------------------------------------------------------------------------
// CUSTOMER: self-serve RAF — view referral links and track referred friends.
// ---------------------------------------------------------------------------
export const listMyReferralActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: codes, error: codeErr } = await supabaseAdmin
      .from("referral_codes")
      .select("id, code, active, created_at, tenant_id")
      .eq("referrer_user_id", context.userId)
      .order("created_at", { ascending: false });
    if (codeErr) {
      if (isMissingTableError(codeErr)) return { codes: [], referrals: [], migrationRequired: true };
      throw new Error(codeErr.message);
    }

    // The referrer sees each friend's progress, never the friend's contact details.
    const codeList = (codes ?? []).map((c) => c.code);
    let referrals: Array<{
      id: string;
      code: string;
      status: string;
      bonusStatus: string;
      progressLabel: string;
      createdAt: string;
    }> = [];
    if (codeList.length > 0) {
      const { data: refs, error: refErr } = await supabaseAdmin
        .from("referrals")
        .select("id, code, status, bonus_status, created_at")
        .in("code", codeList)
        .order("created_at", { ascending: false });
      if (refErr) throw new Error(refErr.message);
      referrals = (refs ?? []).map((r) => ({
        id: r.id,
        code: r.code,
        status: r.status,
        bonusStatus: r.bonus_status,
        progressLabel: referralProgressLabel(r.bonus_status),
        createdAt: r.created_at,
      }));
    }

    const slugByTenant = await slugMapForTenantIds(
      supabaseAdmin,
      (codes ?? []).map((c: { tenant_id?: string | null }) => c.tenant_id),
    );

    // The bonus on offer is the acting tenant's configured amount, shown only while the programme
    // is enabled; no default amount is ever assumed.
    let bonusPence: number | null = null;
    try {
      const { resolveActingTenant } = await import("@/lib/tenant-assert.server");
      const { tenantId } = await resolveActingTenant(context.userId);
      const programme = await rafProgrammeForTenant(tenantId);
      bonusPence = programme.enabled ? programme.bonusPence : null;
    } catch {
      bonusPence = null;
    }

    return {
      bonusPence,
      codes: (codes ?? []).map((c: { tenant_id?: string | null; id: string; code: string; active: boolean; created_at: string }) => ({
        ...c,
        tenantSlug: (c as { tenant_id?: string | null }).tenant_id
          ? slugByTenant.get((c as { tenant_id: string }).tenant_id) ?? null
          : null,
      })),
      referrals,
      migrationRequired: false,
    };
  });

/**
 * B2b: RAF self-service tenant = the canonical verified acting tenant (A1/A2). Never the first or
 * an arbitrary membership, a referral code, a cookie or a caller value. 0 authority, or 2+
 * memberships without a verified tenant context, fail closed inside resolveActingTenant.
 * Membership is still required, so platform entry into a foreign company cannot mint a code.
 */
async function resolveRafSelfServiceTenant(
  userId: string,
): Promise<{ tenant: { id: string; slug: string } }> {
  const { resolveActingTenant, TenantContextError } = await import("@/lib/tenant-assert.server");
  const { tenantId, view } = await resolveActingTenant(userId);
  if (!view.member || !view.tenantSlug) {
    throw new TenantContextError("TENANT_DATA_ACCESS_DENIED", "Tenant access denied.");
  }
  return { tenant: { id: tenantId, slug: view.tenantSlug } };
}

export const ensureMyReferralLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { withForcedTenantId } = await import("@/lib/tenant-assert.server");
    const actingUserId = context!.userId;
    const authorised = await resolveRafSelfServiceTenant(actingUserId);

    const { data: existing } = await supabaseAdmin
      .from("referral_codes")
      .select("id, code")
      .eq("referrer_user_id", actingUserId)
      .eq("tenant_id", authorised.tenant.id)
      .eq("active", true)
      .limit(1)
      .maybeSingle();
    if (existing) return { code: existing.code, tenantSlug: authorised.tenant.slug };

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, phone")
      .eq("id", actingUserId)
      .maybeSingle();

    const code = await generateUniqueReferralCode();
    const { data: inserted, error } = await supabaseAdmin
      .from("referral_codes")
      .insert(
        withForcedTenantId(
          {
            code,
            referrer_user_id: actingUserId,
            referrer_name: profile?.full_name ?? null,
            referrer_phone: profile?.phone ?? null,
            active: true,
            created_by: actingUserId,
          },
          authorised.tenant.id,
        ),
      )
      .select("code")
      .single();
    if (error) {
      if (isMissingTableError(error)) throw new Error("Run the Refer-a-friend migration first.");
      throw new Error(error.message);
    }
    return { code: inserted.code, tenantSlug: authorised.tenant.slug };
  });

/** Customer self-serve: text or email their own referral link. */
export const sendMyReferralLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ channel: z.enum(["sms", "email"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { withForcedTenantId } = await import("@/lib/tenant-assert.server");
    const authorised = await resolveRafSelfServiceTenant(context.userId);
    const { requireTenantFeature } = await import("@/lib/tenant-features.server");
    await requireTenantFeature(authorised.tenant.id, "refer_a_friend");

    const { data: existing } = await supabaseAdmin
      .from("referral_codes")
      .select("code")
      .eq("referrer_user_id", context.userId)
      .eq("tenant_id", authorised.tenant.id)
      .eq("active", true)
      .limit(1)
      .maybeSingle();

    let code = existing?.code;
    if (!code) {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("full_name, phone")
        .eq("id", context.userId)
        .maybeSingle();
      code = await generateUniqueReferralCode();
      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from("referral_codes")
        .insert(
          withForcedTenantId(
            {
              code,
              referrer_user_id: context.userId,
              referrer_name: profile?.full_name ?? null,
              referrer_phone: profile?.phone ?? null,
              active: true,
              created_by: context.userId,
            },
            authorised.tenant.id,
          ),
        )
        .select("code")
        .single();
      if (insertErr) {
        if (isMissingTableError(insertErr)) throw new Error("Run the Refer-a-friend migration first.");
        throw new Error(insertErr.message);
      }
      code = inserted.code;
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, email, phone")
      .eq("id", context.userId)
      .maybeSingle();

    const baseUrl = getAppBaseUrl();
    const { buildCanonicalRafPath } = await import("@/lib/tenant-url");
    const link = `${baseUrl.replace(/\/$/, "")}${buildCanonicalRafPath(authorised.tenant.slug, code)}`;
    const message = rafShareMessage(profile?.full_name ?? null, code, authorised.tenant.slug, baseUrl);
    if (!message) {
      throw new Error("Cannot send this referral link because the firm is not available.");
    }

    if (data.channel === "sms") {
      if (!profile?.phone) throw new Error("Add your mobile number to your profile first.");
      if (!isTwilioConfigured()) throw new Error("Text messaging is not configured.");
      // sendSms expects { to, body } — positional (phone, message) was a G2/G3 bug.
      await sendSms({ to: profile.phone, body: message });
      return { ok: true, channel: "sms" as const };
    }

    const subject = encodeURIComponent("Refer a friend to Mortgage Hub");
    const body = encodeURIComponent(message);
    return { ok: true, channel: "email" as const, mailto: `mailto:?subject=${subject}&body=${body}`, link };
  });
