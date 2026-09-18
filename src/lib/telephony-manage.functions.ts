import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normaliseUkPhone } from "@/lib/sms.server";
import { resolveAdminAccess } from "@/lib/admin.functions";
import {
  requireTenantMembership,
  resolveSoleMembershipTenant,
  withForcedTenantId,
} from "@/lib/tenant-assert.server";

async function requireOwner(userId: string, claims?: { email?: string } | null) {
  const access = await resolveAdminAccess(userId, claims?.email);
  if (!access.isOwner) throw new Error("Only the owner can manage telephony.");
  return access;
}

const actionEnum = z.enum(["voicemail", "reroute_personal", "ring_anyway"]);
const noAnswerEnum = z.enum(["voicemail", "reroute_personal"]);
const unownedEnum = z.enum(["voicemail", "ring_fallback_user"]);

export type TelephonyNumberRow = {
  id: string;
  e164: string;
  label: string;
  kind: "landline" | "mobile";
  isFirmInbound: boolean;
  allocatedUserId: string | null;
  allocatedEmail: string | null;
  allocatedName: string | null;
  active: boolean;
};

export type AdvisorTelephonyRow = {
  userId: string;
  email: string | null;
  fullName: string | null;
  enabled: boolean;
  ringSoftphone: boolean;
  ringAllocatedMobile: boolean;
  ringPersonalMobile: boolean;
  usePersonalRerouteAsFallback: boolean;
  respectOutlookBusy: boolean;
  respectHubAppointments: boolean;
  personalRerouteE164: string | null;
  allocatedMobileNumberId: string | null;
  allocatedMobileE164: string | null;
  outlookLinked: boolean;
  notes: string | null;
};

export type TelephonyControlSnapshot = {
  numbers: TelephonyNumberRow[];
  agents: AdvisorTelephonyRow[];
  unallocatedMobiles: Array<{ id: string; e164: string; label: string }>;
  staffOptions: Array<{ userId: string; email: string | null; fullName: string | null }>;
  settings: {
    timezone: string;
    businessHours: unknown;
    voiceBrand: "mortgage_easy" | "trent_valley";
    outOfHoursAction: string;
    inAppointmentAction: string;
    noAnswerAction: string;
    unownedCallerAction: string;
    fallbackUserId: string | null;
    ringTimeoutSeconds: number;
  };
  env: {
    landlineFromEnv: string;
    mobileFromEnv: string;
  };
};

export const getTelephonyControlPanel = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TelephonyControlSnapshot> => {
    await requireOwner(context.userId, context.claims as { email?: string });
    const authorised = await resolveSoleMembershipTenant(context.userId);
    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    let numbersQuery = supabaseAdmin
      .from("telephony_numbers")
      .select("id, e164, label, kind, is_firm_inbound, allocated_user_id, active")
      .order("kind")
      .order("e164");
    // Mortgage Easy alone may read historical 001 rows that pre-date tenant_id.
    numbersQuery =
      authorised.tenant.slug === "mortgageeasy"
        ? numbersQuery.or(`tenant_id.eq.${authorised.tenant.id},tenant_id.is.null`)
        : numbersQuery.eq("tenant_id", authorised.tenant.id);
    const { data: numbers, error: numErr } = await numbersQuery;
    if (numErr) throw new Error(numErr.message);

    const allocatedIds = (numbers ?? []).map((n) => n.allocated_user_id).filter(Boolean) as string[];
    const { data: profiles } = allocatedIds.length
      ? await supabaseAdmin.from("profiles").select("id, email, full_name").in("id", allocatedIds)
      : { data: [] as Array<{ id: string; email: string | null; full_name: string | null }> };
    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

    const numberRows: TelephonyNumberRow[] = (numbers ?? []).map((n) => {
      const p = n.allocated_user_id ? profileMap.get(n.allocated_user_id) : null;
      return {
        id: n.id,
        e164: n.e164,
        label: n.label,
        kind: n.kind,
        isFirmInbound: n.is_firm_inbound,
        allocatedUserId: n.allocated_user_id,
        allocatedEmail: p?.email ?? null,
        allocatedName: p?.full_name ?? null,
        active: n.active,
      };
    });

    let agentsQuery = supabaseAdmin
      .from("advisor_telephony")
      .select(
        "user_id, enabled, ring_softphone, ring_allocated_mobile, ring_personal_mobile, use_personal_reroute_as_fallback, respect_outlook_busy, respect_hub_appointments, personal_reroute_e164, allocated_mobile_number_id, notes",
      );
    agentsQuery =
      authorised.tenant.slug === "mortgageeasy"
        ? agentsQuery.or(`tenant_id.eq.${authorised.tenant.id},tenant_id.is.null`)
        : agentsQuery.eq("tenant_id", authorised.tenant.id);
    const { data: agents, error: agentErr } = await agentsQuery;
    if (agentErr) throw new Error(agentErr.message);

    const agentIds = (agents ?? []).map((a) => a.user_id);
    const { data: agentProfiles } = agentIds.length
      ? await supabaseAdmin.from("profiles").select("id, email, full_name").in("id", agentIds)
      : { data: [] as Array<{ id: string; email: string | null; full_name: string | null }> };
    const agentProfileMap = new Map((agentProfiles ?? []).map((p) => [p.id, p]));

    const mobileById = new Map(numberRows.filter((n) => n.kind === "mobile").map((n) => [n.id, n]));

    let outlookLinked = new Set<string>();
    try {
      const { data: ap } = await supabaseAdmin
        .from("advisor_profiles")
        .select("user_id, teams_calendar_enabled, ms_refresh_token")
        .in("user_id", agentIds.length ? agentIds : ["00000000-0000-0000-0000-000000000000"]);
      outlookLinked = new Set(
        (ap ?? [])
          .filter((r) => r.teams_calendar_enabled && r.ms_refresh_token)
          .map((r) => r.user_id),
      );
    } catch {
      /* calendar columns may be missing */
    }

    const agentRows: AdvisorTelephonyRow[] = (agents ?? []).map((a) => {
      const p = agentProfileMap.get(a.user_id);
      const mobile = a.allocated_mobile_number_id ? mobileById.get(a.allocated_mobile_number_id) : null;
      return {
        userId: a.user_id,
        email: p?.email ?? null,
        fullName: p?.full_name ?? null,
        enabled: a.enabled,
        ringSoftphone: a.ring_softphone,
        ringAllocatedMobile: a.ring_allocated_mobile,
        ringPersonalMobile: a.ring_personal_mobile ?? true,
        usePersonalRerouteAsFallback: a.use_personal_reroute_as_fallback,
        respectOutlookBusy: a.respect_outlook_busy,
        respectHubAppointments: a.respect_hub_appointments,
        personalRerouteE164: a.personal_reroute_e164,
        allocatedMobileNumberId: a.allocated_mobile_number_id,
        allocatedMobileE164: mobile?.e164 ?? null,
        outlookLinked: outlookLinked.has(a.user_id),
        notes: a.notes,
      };
    });

    const { data: settings, error: setErr } = await supabaseAdmin
      .from("telephony_routing_settings")
      .select("*")
      .eq("id", 1)
      .eq("tenant_id", authorised.tenant.id)
      .maybeSingle();
    if (setErr) throw new Error(setErr.message);

    const { data: roleRows } = await supabaseAdmin
      .from("tenant_memberships")
      .select("user_id, role")
      .eq("tenant_id", authorised.tenant.id)
      .eq("active", true)
      .in("role", ["owner", "supervisor", "general", "adviser"]);
    const staffIds = Array.from(new Set((roleRows ?? []).map((r) => r.user_id)));
    const { data: staffProfiles } = staffIds.length
      ? await supabaseAdmin.from("profiles").select("id, email, full_name").in("id", staffIds)
      : { data: [] as Array<{ id: string; email: string | null; full_name: string | null }> };

    return {
      numbers: numberRows,
      agents: agentRows,
      unallocatedMobiles: numberRows
        .filter((n) => n.kind === "mobile" && n.active && !n.allocatedUserId)
        .map((n) => ({ id: n.id, e164: n.e164, label: n.label })),
      staffOptions: (staffProfiles ?? []).map((p) => ({
        userId: p.id,
        email: p.email,
        fullName: p.full_name,
      })),
      settings: {
        timezone: settings?.timezone ?? "Europe/London",
        businessHours: settings?.business_hours ?? {},
        voiceBrand: settings?.voice_brand === "trent_valley" ? "trent_valley" : "mortgage_easy",
        outOfHoursAction: settings?.out_of_hours_action ?? "voicemail",
        inAppointmentAction: settings?.in_appointment_action ?? "voicemail",
        noAnswerAction: settings?.no_answer_action ?? "voicemail",
        unownedCallerAction: settings?.unowned_caller_action ?? "voicemail",
        fallbackUserId: settings?.fallback_user_id ?? null,
        ringTimeoutSeconds: settings?.ring_timeout_seconds ?? 25,
      },
      env: {
        landlineFromEnv: process.env.TWILIO_VOICE_PHONE_NUMBER?.trim() || "",
        mobileFromEnv: process.env.TWILIO_PHONE_NUMBER?.trim() || "",
      },
    };
  });

/** Clone the agent-mobile template onto another advisor (optionally allocate a free mobile). */
export const provisionAdvisorTelephony = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        mobileNumberId: z.string().uuid().optional().nullable(),
        personalRerouteE164: z.string().optional().nullable(),
        cloneFromUserId: z.string().uuid().optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireOwner(context.userId, context.claims as { email?: string });
    const authorised = await resolveSoleMembershipTenant(context.userId);
    await requireTenantMembership(data.userId, authorised.tenant.id);
    if (data.cloneFromUserId) {
      await requireTenantMembership(data.cloneFromUserId, authorised.tenant.id);
    }
    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    let template: {
      ring_softphone: boolean;
      ring_allocated_mobile: boolean;
      ring_personal_mobile: boolean;
      use_personal_reroute_as_fallback: boolean;
      respect_outlook_busy: boolean;
      respect_hub_appointments: boolean;
    } = {
      ring_softphone: true,
      ring_allocated_mobile: false,
      ring_personal_mobile: true,
      use_personal_reroute_as_fallback: true,
      respect_outlook_busy: true,
      respect_hub_appointments: true,
    };

    if (data.cloneFromUserId) {
      const { data: src } = await supabaseAdmin
        .from("advisor_telephony")
        .select(
          "ring_softphone, ring_allocated_mobile, ring_personal_mobile, use_personal_reroute_as_fallback, respect_outlook_busy, respect_hub_appointments",
        )
        .eq("user_id", data.cloneFromUserId)
        .eq("tenant_id", authorised.tenant.id)
        .maybeSingle();
      if (src) {
        template = {
          ...src,
          ring_personal_mobile: src.ring_personal_mobile ?? true,
        };
      }
    }

    const mobileId = data.mobileNumberId ?? null;
    if (mobileId) {
      const { data: mobile, error } = await supabaseAdmin
        .from("telephony_numbers")
        .select("id, kind, allocated_user_id")
        .eq("id", mobileId)
        .eq("tenant_id", authorised.tenant.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!mobile || mobile.kind !== "mobile") throw new Error("Select a mobile number.");
      if (mobile.allocated_user_id && mobile.allocated_user_id !== data.userId) {
        throw new Error("That mobile number is already allocated to someone else.");
      }
      await supabaseAdmin
        .from("telephony_numbers")
        .update({ allocated_user_id: data.userId, updated_at: new Date().toISOString() })
        .eq("id", mobileId)
        .eq("tenant_id", authorised.tenant.id);
    }

    const personal = data.personalRerouteE164?.trim()
      ? normaliseUkPhone(data.personalRerouteE164)
      : null;

    const advisorPayload = withForcedTenantId({
      user_id: data.userId,
      allocated_mobile_number_id: mobileId,
      personal_reroute_e164: personal,
      enabled: true,
      ...template,
      notes: "Provisioned from telephony control panel (cloneable agent-mobile template)",
      updated_at: new Date().toISOString(),
    }, authorised.tenant.id);
    const { data: existingAdvisor } = await supabaseAdmin
      .from("advisor_telephony")
      .select("user_id")
      .eq("user_id", data.userId)
      .eq("tenant_id", authorised.tenant.id)
      .maybeSingle();
    const { error: upsertErr } = existingAdvisor
      ? await supabaseAdmin
          .from("advisor_telephony")
          .update(advisorPayload)
          .eq("user_id", data.userId)
          .eq("tenant_id", authorised.tenant.id)
      : await supabaseAdmin.from("advisor_telephony").insert(advisorPayload);
    if (upsertErr) throw new Error(upsertErr.message);
    return { ok: true as const };
  });

export const updateAdvisorTelephony = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        enabled: z.boolean().optional(),
        ringSoftphone: z.boolean().optional(),
        ringAllocatedMobile: z.boolean().optional(),
        ringPersonalMobile: z.boolean().optional(),
        usePersonalRerouteAsFallback: z.boolean().optional(),
        respectOutlookBusy: z.boolean().optional(),
        respectHubAppointments: z.boolean().optional(),
        personalRerouteE164: z.string().optional().nullable(),
        allocatedMobileNumberId: z.string().uuid().optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireOwner(context.userId, context.claims as { email?: string });
    const authorised = await resolveSoleMembershipTenant(context.userId);
    await requireTenantMembership(data.userId, authorised.tenant.id);
    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    if (data.allocatedMobileNumberId !== undefined) {
      // Clear previous allocation for this user
      await supabaseAdmin
        .from("telephony_numbers")
        .update({ allocated_user_id: null, updated_at: new Date().toISOString() })
        .eq("allocated_user_id", data.userId)
        .eq("kind", "mobile")
        .eq("tenant_id", authorised.tenant.id);

      if (data.allocatedMobileNumberId) {
        const { data: mobile, error } = await supabaseAdmin
          .from("telephony_numbers")
          .select("id, kind, allocated_user_id")
          .eq("id", data.allocatedMobileNumberId)
          .eq("tenant_id", authorised.tenant.id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!mobile || mobile.kind !== "mobile") throw new Error("Select a mobile number.");
        if (mobile.allocated_user_id && mobile.allocated_user_id !== data.userId) {
          throw new Error("That mobile is already allocated.");
        }
        await supabaseAdmin
          .from("telephony_numbers")
          .update({ allocated_user_id: data.userId, updated_at: new Date().toISOString() })
          .eq("id", data.allocatedMobileNumberId)
          .eq("tenant_id", authorised.tenant.id);
      }
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.enabled !== undefined) patch.enabled = data.enabled;
    if (data.ringSoftphone !== undefined) patch.ring_softphone = data.ringSoftphone;
    if (data.ringAllocatedMobile !== undefined) patch.ring_allocated_mobile = data.ringAllocatedMobile;
    if (data.ringPersonalMobile !== undefined) patch.ring_personal_mobile = data.ringPersonalMobile;
    if (data.usePersonalRerouteAsFallback !== undefined) {
      patch.use_personal_reroute_as_fallback = data.usePersonalRerouteAsFallback;
    }
    if (data.respectOutlookBusy !== undefined) patch.respect_outlook_busy = data.respectOutlookBusy;
    if (data.respectHubAppointments !== undefined) {
      patch.respect_hub_appointments = data.respectHubAppointments;
    }
    if (data.personalRerouteE164 !== undefined) {
      patch.personal_reroute_e164 = data.personalRerouteE164?.trim()
        ? normaliseUkPhone(data.personalRerouteE164)
        : null;
    }
    if (data.allocatedMobileNumberId !== undefined) {
      patch.allocated_mobile_number_id = data.allocatedMobileNumberId;
    }

    const { data: existingAdvisor } = await supabaseAdmin
      .from("advisor_telephony")
      .select("user_id")
      .eq("user_id", data.userId)
      .eq("tenant_id", authorised.tenant.id)
      .maybeSingle();
    const advisorPayload = withForcedTenantId(
      { user_id: data.userId, ...patch },
      authorised.tenant.id,
    );
    const { error } = existingAdvisor
      ? await supabaseAdmin
          .from("advisor_telephony")
          .update(advisorPayload)
          .eq("user_id", data.userId)
          .eq("tenant_id", authorised.tenant.id)
      : await supabaseAdmin.from("advisor_telephony").insert(advisorPayload);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const updateTelephonyRoutingSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        voiceBrand: z.enum(["mortgage_easy", "trent_valley"]).optional(),
        outOfHoursAction: actionEnum.optional(),
        inAppointmentAction: actionEnum.optional(),
        noAnswerAction: noAnswerEnum.optional(),
        unownedCallerAction: unownedEnum.optional(),
        fallbackUserId: z.string().uuid().optional().nullable(),
        ringTimeoutSeconds: z.number().int().min(10).max(60).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireOwner(context.userId, context.claims as { email?: string });
    const authorised = await resolveSoleMembershipTenant(context.userId);
    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.voiceBrand) patch.voice_brand = data.voiceBrand;
    if (data.outOfHoursAction) patch.out_of_hours_action = data.outOfHoursAction;
    if (data.inAppointmentAction) patch.in_appointment_action = data.inAppointmentAction;
    if (data.noAnswerAction) patch.no_answer_action = data.noAnswerAction;
    if (data.unownedCallerAction) patch.unowned_caller_action = data.unownedCallerAction;
    if (data.fallbackUserId !== undefined) patch.fallback_user_id = data.fallbackUserId;
    if (data.ringTimeoutSeconds !== undefined) patch.ring_timeout_seconds = data.ringTimeoutSeconds;

    const { error } = await supabaseAdmin
      .from("telephony_routing_settings")
      .update(patch)
      .eq("id", 1)
      .eq("tenant_id", authorised.tenant.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const addTelephonyMobileNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ e164: z.string().min(8), label: z.string().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireOwner(context.userId, context.claims as { email?: string });
    const authorised = await resolveSoleMembershipTenant(context.userId);
    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const e164 = normaliseUkPhone(data.e164);
    const { error } = await supabaseAdmin.from("telephony_numbers").insert(withForcedTenantId({
      e164,
      label: data.label?.trim() || "Agent mobile",
      kind: "mobile",
      is_firm_inbound: false,
      active: true,
    }, authorised.tenant.id));
    if (error) throw new Error(error.message);
    return { ok: true as const, e164 };
  });

/** Assign a Twilio mobile to an advisor (existing or new profile), or clear allocation. */
export const allocateTelephonyNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        numberId: z.string().uuid(),
        /** null / empty = unallocate */
        userId: z.string().uuid().nullable(),
        personalRerouteE164: z.string().optional().nullable(),
        cloneFromUserId: z.string().uuid().optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireOwner(context.userId, context.claims as { email?: string });
    const authorised = await resolveSoleMembershipTenant(context.userId);
    if (data.userId) {
      await requireTenantMembership(data.userId, authorised.tenant.id);
    }
    if (data.cloneFromUserId) {
      await requireTenantMembership(data.cloneFromUserId, authorised.tenant.id);
    }
    const { supabaseAdminUntyped: supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { data: mobile, error: mobileErr } = await supabaseAdmin
      .from("telephony_numbers")
      .select("id, kind, allocated_user_id, e164")
      .eq("id", data.numberId)
      .eq("tenant_id", authorised.tenant.id)
      .maybeSingle();
    if (mobileErr) throw new Error(mobileErr.message);
    if (!mobile || mobile.kind !== "mobile") throw new Error("Select a mobile number.");

    const now = new Date().toISOString();
    const previousOwnerId = mobile.allocated_user_id as string | null;

    // Unallocate
    if (!data.userId) {
      await supabaseAdmin
        .from("telephony_numbers")
        .update({ allocated_user_id: null, updated_at: now })
        .eq("id", data.numberId)
        .eq("tenant_id", authorised.tenant.id);

      if (previousOwnerId) {
        await supabaseAdmin
          .from("advisor_telephony")
          .update({ allocated_mobile_number_id: null, updated_at: now })
          .eq("user_id", previousOwnerId)
          .eq("allocated_mobile_number_id", data.numberId)
          .eq("tenant_id", authorised.tenant.id);
      }
      return { ok: true as const, allocatedUserId: null };
    }

    const targetUserId = data.userId;

    // Clear this number from any previous owner profile
    if (previousOwnerId && previousOwnerId !== targetUserId) {
      await supabaseAdmin
        .from("advisor_telephony")
        .update({ allocated_mobile_number_id: null, updated_at: now })
        .eq("user_id", previousOwnerId)
        .eq("allocated_mobile_number_id", data.numberId)
        .eq("tenant_id", authorised.tenant.id);
    }

    // Clear any other mobile currently held by the target advisor
    await supabaseAdmin
      .from("telephony_numbers")
      .update({ allocated_user_id: null, updated_at: now })
      .eq("allocated_user_id", targetUserId)
      .eq("kind", "mobile")
      .eq("tenant_id", authorised.tenant.id)
      .neq("id", data.numberId);

    await supabaseAdmin
      .from("advisor_telephony")
      .update({ allocated_mobile_number_id: null, updated_at: now })
      .eq("user_id", targetUserId)
      .eq("tenant_id", authorised.tenant.id)
      .neq("allocated_mobile_number_id", data.numberId);

    // Assign number row
    const { error: assignErr } = await supabaseAdmin
      .from("telephony_numbers")
      .update({ allocated_user_id: targetUserId, updated_at: now })
      .eq("id", data.numberId)
      .eq("tenant_id", authorised.tenant.id);
    if (assignErr) throw new Error(assignErr.message);

    // Ensure advisor telephony profile exists (clone template if new)
    const { data: existing } = await supabaseAdmin
      .from("advisor_telephony")
      .select("user_id")
      .eq("user_id", targetUserId)
      .eq("tenant_id", authorised.tenant.id)
      .maybeSingle();

    let template: {
      ring_softphone: boolean;
      ring_allocated_mobile: boolean;
      ring_personal_mobile: boolean;
      use_personal_reroute_as_fallback: boolean;
      respect_outlook_busy: boolean;
      respect_hub_appointments: boolean;
    } = {
      ring_softphone: true,
      ring_allocated_mobile: false,
      ring_personal_mobile: true,
      use_personal_reroute_as_fallback: true,
      respect_outlook_busy: true,
      respect_hub_appointments: true,
    };

    const cloneFrom = data.cloneFromUserId || previousOwnerId || null;
    if (!existing && cloneFrom) {
      const { data: src } = await supabaseAdmin
        .from("advisor_telephony")
        .select(
          "ring_softphone, ring_allocated_mobile, ring_personal_mobile, use_personal_reroute_as_fallback, respect_outlook_busy, respect_hub_appointments",
        )
        .eq("user_id", cloneFrom)
        .eq("tenant_id", authorised.tenant.id)
        .maybeSingle();
      if (src) {
        template = {
          ...src,
          ring_personal_mobile: src.ring_personal_mobile ?? true,
        };
      }
    }

    const personal =
      data.personalRerouteE164 !== undefined
        ? data.personalRerouteE164?.trim()
          ? normaliseUkPhone(data.personalRerouteE164)
          : null
        : undefined;

    const upsertRow: Record<string, unknown> = {
      user_id: targetUserId,
      allocated_mobile_number_id: data.numberId,
      enabled: true,
      updated_at: now,
    };
    if (!existing) {
      Object.assign(upsertRow, template);
      upsertRow.notes = "Allocated from telephony Amend (number → advisor)";
    }
    if (personal !== undefined) {
      upsertRow.personal_reroute_e164 = personal;
    }

    const advisorPayload = withForcedTenantId(upsertRow, authorised.tenant.id);
    const { error: upsertErr } = existing
      ? await supabaseAdmin
          .from("advisor_telephony")
          .update(advisorPayload)
          .eq("user_id", targetUserId)
          .eq("tenant_id", authorised.tenant.id)
      : await supabaseAdmin.from("advisor_telephony").insert(advisorPayload);
    if (upsertErr) throw new Error(upsertErr.message);

    return { ok: true as const, allocatedUserId: targetUserId };
  });
