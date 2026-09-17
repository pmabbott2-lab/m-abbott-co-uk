import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  TEST_ACCOUNTS,
  TEST_ACCOUNT_PASSWORD,
  TEST_ACCOUNT_PHONE,
  isTestAccountEmail,
  type TestAccountSpec,
} from "@/lib/test-accounts";
import { DEFAULT_GENERAL_PERMISSIONS, PERMISSION_KEYS } from "@/lib/admin-access";

async function requireOwner(userId: string, email?: string): Promise<void> {
  const { resolveAdminAccess } = await import("@/lib/admin.functions");
  const access = await resolveAdminAccess(userId, email);
  if (!access.isOwner) throw new Error("Owner only");
}

async function listAllAuthUsers() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const all: Awaited<ReturnType<typeof supabaseAdmin.auth.admin.listUsers>>["data"]["users"] = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    all.push(...(data.users ?? []));
    if ((data.users ?? []).length < 200) break;
    page += 1;
  }
  return all;
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const msg = (error.message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    code === "PGRST106" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache") ||
    msg.includes("could not find")
  );
}

/** Best-effort delete; ignore missing tables/columns so revoke stays resilient. */
async function safeDelete(
  run: () => PromiseLike<{ error: { code?: string; message?: string } | null }>,
  table: string,
): Promise<void> {
  const { error } = await run();
  if (error && !isMissingTable(error)) {
    console.warn(`[test-accounts] wipe ${table}:`, error.message);
  }
}

async function ensureGeneralAdmin(
  userId: string,
  grantedBy?: string,
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const now = new Date().toISOString();

  await supabaseAdmin
    .from("user_roles")
    .upsert({ user_id: userId, role: "admin" }, { onConflict: "user_id,role" });

  const { error: profileErr } = await supabaseAdmin.from("admin_profiles").upsert(
    {
      user_id: userId,
      level: "general",
      granted_by: grantedBy ?? null,
      updated_at: now,
    },
    { onConflict: "user_id" },
  );
  if (profileErr) throw new Error(profileErr.message);

  const { data: existing, error: existingErr } = await supabaseAdmin
    .from("admin_permissions")
    .select("id")
    .eq("user_id", userId)
    .limit(1);
  if (existingErr) throw new Error(existingErr.message);
  if (!existing?.length) {
    const rows = PERMISSION_KEYS.map((key) => ({
      user_id: userId,
      permission_key: key,
      access: DEFAULT_GENERAL_PERMISSIONS[key],
    }));
    const { error: insErr } = await supabaseAdmin.from("admin_permissions").insert(rows);
    if (insErr) throw new Error(insErr.message);
  }
}

/**
 * Remove all Hub activity for a test account so the platform is clean after revoke.
 * Order respects common FKs; missing tables are skipped.
 */
async function wipeTestAccountActivity(userId: string, email: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const emailLower = email.toLowerCase();

  const { data: sessions } = await supabaseAdmin
    .from("interview_sessions")
    .select("id")
    .eq("customer_id", userId);
  const sessionIds = (sessions ?? []).map((s) => s.id);

  if (sessionIds.length) {
    // Session-scoped rows (many cascade, but not all migrations are CASCADE-safe).
    for (const table of [
      "interview_messages",
      "interview_answers",
      "advisor_notes",
      "session_advisors",
      "session_contact_tracking",
      "customer_contact_log",
      "advisor_contact_views",
      "customer_journey_milestones",
      "case_mortgage_details",
      "staff_contact_tasks",
      "finance_ledger",
      "finance_fee_lines",
      "appointments",
      "callback_requests",
      "phone_calls",
    ] as const) {
      await safeDelete(
        () => supabaseAdmin.from(table).delete().in("session_id", sessionIds),
        table,
      );
    }
    await safeDelete(
      () => supabaseAdmin.from("interview_sessions").delete().in("id", sessionIds),
      "interview_sessions",
    );
  }

  // Also clear sessions they advised / notes they wrote (non-customer roles).
  await safeDelete(
    () => supabaseAdmin.from("session_advisors").delete().eq("advisor_id", userId),
    "session_advisors",
  );
  await safeDelete(
    () => supabaseAdmin.from("advisor_notes").delete().eq("advisor_id", userId),
    "advisor_notes",
  );
  await safeDelete(
    () => supabaseAdmin.from("callback_requests").delete().eq("customer_id", userId),
    "callback_requests",
  );
  await safeDelete(
    () => supabaseAdmin.from("callback_requests").delete().eq("assigned_to", userId),
    "callback_requests",
  );
  await safeDelete(
    () => supabaseAdmin.from("appointments").delete().ilike("customer_email", emailLower),
    "appointments",
  );
  await safeDelete(
    () => supabaseAdmin.from("appointments").delete().eq("advisor_id", userId),
    "appointments",
  );
  await safeDelete(
    () => supabaseAdmin.from("advisor_availability").delete().eq("advisor_id", userId),
    "advisor_availability",
  );
  await safeDelete(
    () => supabaseAdmin.from("advisor_contact_views").delete().eq("advisor_id", userId),
    "advisor_contact_views",
  );
  await safeDelete(
    () => supabaseAdmin.from("staff_contact_tasks").delete().eq("assigned_to", userId),
    "staff_contact_tasks",
  );
  await safeDelete(
    () => supabaseAdmin.from("staff_contact_tasks").delete().eq("created_by", userId),
    "staff_contact_tasks",
  );

  // Introducer graph
  const { data: introducer } = await supabaseAdmin
    .from("introducers")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (introducer?.id) {
    await safeDelete(
      () => supabaseAdmin.from("introducer_leads").delete().eq("introducer_id", introducer.id),
      "introducer_leads",
    );
    await safeDelete(
      () =>
        supabaseAdmin.from("introducer_amendment_history").delete().eq("introducer_id", introducer.id),
      "introducer_amendment_history",
    );
    await safeDelete(
      () => supabaseAdmin.from("appointments").delete().eq("introducer_id", introducer.id),
      "appointments",
    );
    await safeDelete(
      () =>
        supabaseAdmin.from("customer_introducer_links").delete().eq("introducer_id", introducer.id),
      "customer_introducer_links",
    );
    await safeDelete(
      () => supabaseAdmin.from("introducers").delete().eq("id", introducer.id),
      "introducers",
    );
  }

  await safeDelete(
    () => supabaseAdmin.from("customer_introducer_links").delete().eq("customer_id", userId),
    "customer_introducer_links",
  );

  // Finance / commission tied to this user
  await safeDelete(
    () => supabaseAdmin.from("finance_ledger").delete().eq("beneficiary_user_id", userId),
    "finance_ledger",
  );
  await safeDelete(
    () => supabaseAdmin.from("commission_rate_history").delete().eq("user_id", userId),
    "commission_rate_history",
  );
  await safeDelete(
    () => supabaseAdmin.from("commission_rates").delete().eq("user_id", userId),
    "commission_rates",
  );
  await safeDelete(
    () => supabaseAdmin.from("finance_audit_log").delete().eq("actor_id", userId),
    "finance_audit_log",
  );
  await safeDelete(
    () => supabaseAdmin.from("finance_audit_log").delete().eq("actor_user_id", userId),
    "finance_audit_log",
  );

  // Network statement matches to this customer
  await safeDelete(
    () => supabaseAdmin.from("network_commission_lines").delete().eq("matched_customer_id", userId),
    "network_commission_lines",
  );

  // Refer-a-friend
  await safeDelete(
    () => supabaseAdmin.from("referrals").delete().eq("referrer_id", userId),
    "referrals",
  );
  await safeDelete(
    () => supabaseAdmin.from("referrals").delete().eq("referee_id", userId),
    "referrals",
  );
  await safeDelete(
    () => supabaseAdmin.from("referral_codes").delete().eq("user_id", userId),
    "referral_codes",
  );

  // Admin / advisor / telephony profiles
  await safeDelete(
    () => supabaseAdmin.from("admin_permissions").delete().eq("user_id", userId),
    "admin_permissions",
  );
  await safeDelete(
    () => supabaseAdmin.from("admin_profiles").delete().eq("user_id", userId),
    "admin_profiles",
  );
  await safeDelete(
    () => supabaseAdmin.from("advisor_profiles").delete().eq("user_id", userId),
    "advisor_profiles",
  );
  await safeDelete(
    () => supabaseAdmin.from("advisor_telephony").delete().eq("user_id", userId),
    "advisor_telephony",
  );
  await safeDelete(
    () => supabaseAdmin.from("view_as_audit_log").delete().eq("actor_id", userId),
    "view_as_audit_log",
  );
  await safeDelete(
    () => supabaseAdmin.from("view_as_audit_log").delete().eq("target_user_id", userId),
    "view_as_audit_log",
  );
  await safeDelete(
    () => supabaseAdmin.from("staff_invitations").delete().eq("created_by", userId),
    "staff_invitations",
  );
  await safeDelete(
    () => supabaseAdmin.from("staff_invitations").delete().ilike("email", emailLower),
    "staff_invitations",
  );
  await safeDelete(
    () => supabaseAdmin.from("sms_messages").delete().eq("created_by", userId),
    "sms_messages",
  );
  await safeDelete(
    () => supabaseAdmin.from("phone_calls").delete().eq("advisor_id", userId),
    "phone_calls",
  );
  await safeDelete(
    () => supabaseAdmin.from("phone_calls").delete().eq("customer_id", userId),
    "phone_calls",
  );

  await safeDelete(
    () => supabaseAdmin.from("user_roles").delete().eq("user_id", userId),
    "user_roles",
  );
  await safeDelete(() => supabaseAdmin.from("profiles").delete().eq("id", userId), "profiles");

  try {
    await supabaseAdmin.auth.admin.signOut(userId, "global");
  } catch {
    /* older API — fall through */
  }
}

/** Full purge: wipe Hub rows then delete the auth user. */
async function purgeTestAccount(userId: string, email: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await wipeTestAccountActivity(userId, email);
  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error && !/user not found|not found/i.test(error.message)) {
    throw new Error(`${email}: could not delete auth user — ${error.message}`);
  }
}

async function upsertTestUser(
  spec: TestAccountSpec,
  opts?: { grantedBy?: string; existingUsers?: Awaited<ReturnType<typeof listAllAuthUsers>> },
): Promise<{ email: string; userId: string; created: boolean }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const email = spec.email.toLowerCase();

  const existingUsers = opts?.existingUsers ?? (await listAllAuthUsers());
  const existing = existingUsers.find((u) => u.email?.toLowerCase() === email);

  let userId: string;
  let created = false;

  if (existing) {
    userId = existing.id;
    await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: TEST_ACCOUNT_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: spec.fullName, phone: TEST_ACCOUNT_PHONE, test_account: true },
      app_metadata: { test_account: true, test_email_bypass: true },
    });
  } else {
    const { data: createdUser, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: TEST_ACCOUNT_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: spec.fullName, phone: TEST_ACCOUNT_PHONE, test_account: true },
      app_metadata: { test_account: true, test_email_bypass: true },
    });
    if (error) throw new Error(`${email}: ${error.message}`);
    userId = createdUser.user.id;
    created = true;
  }

  await supabaseAdmin.from("profiles").upsert({
    id: userId,
    email,
    full_name: spec.fullName,
    phone: TEST_ACCOUNT_PHONE,
  });

  await supabaseAdmin
    .from("user_roles")
    .upsert({ user_id: userId, role: spec.role }, { onConflict: "user_id,role" });

  if (spec.role === "advisor") {
    const { ensureAdvisorCode } = await import("@/lib/sessions.functions");
    await ensureAdvisorCode(userId);
    // Always refresh weekday demo diary so test advisors stay bookable without Teams.
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    for (const day of [1, 2, 3, 4, 5]) {
      const { data: existing } = await admin
        .from("advisor_availability")
        .select("id")
        .eq("advisor_id", userId)
        .eq("day_of_week", day)
        .maybeSingle();
      if (existing?.id) {
        await admin
          .from("advisor_availability")
          .update({
            start_time: "09:00",
            end_time: "17:00",
            slot_minutes: 30,
            active: true,
          })
          .eq("id", existing.id);
      } else {
        await admin.from("advisor_availability").insert({
          advisor_id: userId,
          day_of_week: day,
          start_time: "09:00",
          end_time: "17:00",
          slot_minutes: 30,
          active: true,
        });
      }
    }
  }

  if (spec.role === "introducer") {
    const { grantIntroducerRoleForTestAccount } = await import("@/lib/sessions.functions");
    await grantIntroducerRoleForTestAccount(userId);
  }

  if (spec.role === "admin" && spec.adminLevel === "general") {
    try {
      await ensureGeneralAdmin(userId, opts?.grantedBy);
    } catch (e) {
      throw new Error(`${email}: ${e instanceof Error ? e.message : "Could not create admin profile"}`);
    }
  }

  return { email, userId, created };
}

export const provisionTestAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string }).email;
    await requireOwner(context.userId, email);

    const users = await listAllAuthUsers();
    const results = [];
    const errors: { email: string; error: string }[] = [];
    for (const spec of TEST_ACCOUNTS) {
      try {
        results.push(await upsertTestUser(spec, { grantedBy: context.userId, existingUsers: users }));
      } catch (e) {
        errors.push({
          email: spec.email,
          error: e instanceof Error ? e.message : "Unknown error",
        });
      }
    }

    if (!results.length) {
      throw new Error(errors[0]?.error ?? "Could not provision test accounts");
    }

    return {
      ok: true as const,
      password: TEST_ACCOUNT_PASSWORD,
      phone: TEST_ACCOUNT_PHONE,
      results,
      errors,
    };
  });

export const revokeTestAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string }).email;
    await requireOwner(context.userId, email);

    const revoked: string[] = [];
    const errors: { email: string; error: string }[] = [];
    const allUsers = await listAllAuthUsers();

    // Wipe customers before staff so shared appointment/session FKs clear cleanly.
    const order = [...TEST_ACCOUNTS].sort((a, b) => {
      const rank = (r: TestAccountSpec["role"]) =>
        r === "customer" ? 0 : r === "introducer" ? 1 : r === "advisor" ? 2 : 3;
      return rank(a.role) - rank(b.role);
    });

    for (const spec of order) {
      const user = allUsers.find((u) => u.email?.toLowerCase() === spec.email);
      if (!user) continue;
      try {
        await purgeTestAccount(user.id, spec.email);
        revoked.push(spec.email);
      } catch (e) {
        errors.push({
          email: spec.email,
          error: e instanceof Error ? e.message : "Unknown error",
        });
      }
    }

    if (!revoked.length && errors.length) {
      throw new Error(errors[0]?.error ?? "Could not revoke test accounts");
    }

    return { ok: true as const, revoked, errors };
  });

export const resetTestAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ email: z.string().email() }).parse(d))
  .handler(async ({ data, context }) => {
    const ownerEmail = (context.claims as { email?: string }).email;
    await requireOwner(context.userId, ownerEmail);

    const email = data.email.trim().toLowerCase();
    const spec = TEST_ACCOUNTS.find((a) => a.email === email);
    if (!spec) throw new Error("Not a provisioned test account");

    const users = await listAllAuthUsers();
    const existing = users.find((u) => u.email?.toLowerCase() === email);
    if (existing) {
      await wipeTestAccountActivity(existing.id, email);
    }

    const restored = await upsertTestUser(spec, {
      grantedBy: context.userId,
      existingUsers: existing ? users : await listAllAuthUsers(),
    });

    return { ok: true as const, email: restored.email, userId: restored.userId };
  });

export const listTestAccountStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string }).email;
    await requireOwner(context.userId, email);

    const allUsers = await listAllAuthUsers();
    const byEmail = new Map(allUsers.map((u) => [u.email?.toLowerCase() ?? "", u]));

    return TEST_ACCOUNTS.map((spec) => {
      const u = byEmail.get(spec.email);
      return {
        email: spec.email,
        fullName: spec.fullName,
        role: spec.role,
        adminLevel: spec.adminLevel ?? null,
        exists: Boolean(u),
        emailConfirmed: Boolean(u?.email_confirmed_at),
        bypass: Boolean(
          (u?.app_metadata as { test_email_bypass?: boolean } | undefined)?.test_email_bypass,
        ),
      };
    });
  });

export { isTestAccountEmail };
