/**
 * Tenant context and adviser pool for public availability discovery.
 * The pool is always scoped to one server-resolved tenant; no tenant means no pool.
 */

export type BookableAdvisor = {
  id: string;
  fullName: string;
  email: string | null;
  isTest: boolean;
  teamsLinked: boolean;
};

export type AvailabilityTenantContext =
  | { kind: "tenant"; tenantId: string }
  | { kind: "none" }
  | { kind: "denied" };

const POOL_MEMBERSHIP_ROLES = ["adviser", "owner", "supervisor", "general"];

export type ActiveIntroducer = {
  id: string;
  company_name: string | null;
  slug: string;
  tenant_id: string | null;
};

export async function resolveActiveIntroducerBySlug(
  slug?: string | null,
): Promise<ActiveIntroducer | null> {
  if (!slug) return null;
  const { supabaseAdminUntyped: supabaseAdmin } =
    await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("introducers")
    .select("id, company_name, slug, tenant_id")
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();
  return (data as ActiveIntroducer | null) ?? null;
}

/**
 * Tenant for availability discovery. A route tenant slug keeps its existing
 * fail-loud checks. A referral slug is resolved to its introducer's tenant
 * server-side; an unknown, inactive or mismatched referral is denied (never
 * widened to another tenant or to a tenant-less pool).
 */
export async function resolveAvailabilityTenant(input: {
  tenantSlug?: string | null;
  referralSlug?: string | null;
}): Promise<AvailabilityTenantContext> {
  const tenantSlug = input.tenantSlug?.trim() || null;
  const referralSlug = input.referralSlug?.trim() || null;

  let routeTenantId: string | null = null;
  if (tenantSlug) {
    const { getTenantContextBySlug } = await import("@/lib/tenant-assert.server");
    const { requireTenantFeature } = await import("@/lib/tenant-features.server");
    const ctx = await getTenantContextBySlug(tenantSlug);
    await requireTenantFeature(ctx.tenant.id, "appointment_booking");
    routeTenantId = ctx.tenant.id;
  }

  if (!referralSlug) {
    return routeTenantId ? { kind: "tenant", tenantId: routeTenantId } : { kind: "none" };
  }

  try {
    const introducer = await resolveActiveIntroducerBySlug(referralSlug);
    const introducerTenantId = introducer?.tenant_id ?? null;
    if (!introducerTenantId) return { kind: "denied" };
    if (routeTenantId) {
      return introducerTenantId === routeTenantId
        ? { kind: "tenant", tenantId: routeTenantId }
        : { kind: "denied" };
    }

    const { resolveTenantById } = await import("@/lib/tenant-assert.server");
    const { isTenantFeatureEnabled } = await import("@/lib/tenant-features.server");
    const tenant = await resolveTenantById(introducerTenantId);
    if (tenant.status !== "active") return { kind: "denied" };
    if (!(await isTenantFeatureEnabled(tenant.id, "appointment_booking"))) {
      return { kind: "denied" };
    }
    return { kind: "tenant", tenantId: tenant.id };
  } catch {
    return { kind: "denied" };
  }
}

/** Advisers with an active staff membership in the tenant, restricted to `ids`. */
export async function filterAdvisorIdsToTenant(
  ids: string[],
  tenantId: string,
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { supabaseAdminUntyped: supabaseAdmin } =
    await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("tenant_memberships")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .in("role", POOL_MEMBERSHIP_ROLES)
    .in("user_id", ids);
  if (error) throw new Error(error.message);
  return new Set(((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id));
}

/**
 * Advisors who can receive customer bookings.
 * - Live advisors: Teams/Outlook must be linked (availability defaults to Outlook).
 * - Test advisor accounts: included while live, Hub diary only (no Outlook required).
 */
export async function listBookableAdvisorsForTenant(
  tenantId?: string | null,
): Promise<BookableAdvisor[]> {
  const { supabaseAdminUntyped: supabaseAdmin } =
    await import("@/integrations/supabase/client.server");
  const { isTestAccountEmail } = await import("@/lib/test-accounts");

  let ids: string[] = [];
  if (tenantId) {
    const { data: members, error: memErr } = await supabaseAdmin
      .from("tenant_memberships")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .in("role", POOL_MEMBERSHIP_ROLES);
    if (memErr) throw new Error(memErr.message);
    const rows = (members ?? []) as Array<{ user_id: string }>;
    const memberIds = [...new Set(rows.map((m) => m.user_id))];
    if (memberIds.length === 0) return [];
    ids = memberIds;
  } else {
    ids = [];
  }
  if (ids.length === 0) return [];

  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, email")
    .in("id", ids);

  const { data: advProfiles } = await supabaseAdmin
    .from("advisor_profiles")
    .select("user_id, deleted_at, teams_calendar_enabled, teams_calendar_linked_at")
    .in("user_id", ids);

  const advById = new Map(
    (
      (advProfiles ?? []) as Array<{
        user_id: string;
        deleted_at?: string | null;
        teams_calendar_enabled?: boolean | null;
        teams_calendar_linked_at?: string | null;
      }>
    ).map((r) => [r.user_id, r]),
  );

  const out: BookableAdvisor[] = [];
  for (const p of (profiles ?? []) as Array<{
    id: string;
    full_name: string | null;
    email: string | null;
  }>) {
    const ap = advById.get(p.id);
    if (ap?.deleted_at) continue;
    const email = p.email ?? null;
    const isTest = isTestAccountEmail(email);
    const teamsLinked = Boolean(ap?.teams_calendar_enabled);
    // Live advisors need Teams/Outlook linked. Test advisors stay bookable on Hub hours.
    if (!isTest && !teamsLinked) continue;
    out.push({
      id: p.id,
      fullName: (p.full_name ?? "").trim() || email || "Advisor",
      email,
      isTest,
      teamsLinked,
    });
  }
  return out.sort((a, b) => a.fullName.localeCompare(b.fullName));
}
