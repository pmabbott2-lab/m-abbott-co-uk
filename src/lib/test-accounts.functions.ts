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

async function wipeTestAccountActivity(userId: string, email: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: sessions } = await supabaseAdmin
    .from("interview_sessions")
    .select("id")
    .eq("customer_id", userId);
  const sessionIds = (sessions ?? []).map((s) => s.id);

  if (sessionIds.length) {
    await supabaseAdmin.from("appointments").delete().in("session_id", sessionIds);
    await supabaseAdmin.from("callback_requests").delete().in("session_id", sessionIds);
    await supabaseAdmin.from("interview_sessions").delete().in("id", sessionIds);
  }

  await supabaseAdmin.from("callback_requests").delete().eq("customer_id", userId);
  await supabaseAdmin.from("appointments").delete().ilike("customer_email", email);
  await supabaseAdmin.from("appointments").delete().eq("advisor_id", userId);

  const { data: introducer } = await supabaseAdmin
    .from("introducers")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (introducer?.id) {
    await supabaseAdmin.from("introducer_leads").delete().eq("introducer_id", introducer.id);
    await supabaseAdmin.from("appointments").delete().eq("introducer_id", introducer.id);
  }

  await supabaseAdmin.from("customer_introducer_links").delete().eq("customer_id", userId);

  try {
    await supabaseAdmin.auth.admin.signOut(userId, "global");
  } catch {
    /* older API — fall through */
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

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const revoked: string[] = [];
    const allUsers = await listAllAuthUsers();

    for (const spec of TEST_ACCOUNTS) {
      const user = allUsers.find((u) => u.email?.toLowerCase() === spec.email);
      if (!user) continue;

      await supabaseAdmin.auth.admin.updateUserById(user.id, {
        email_confirm: false,
        app_metadata: { test_account: false, test_email_bypass: false },
        user_metadata: { ...user.user_metadata, test_account: false },
      });
      revoked.push(spec.email);
    }

    return { ok: true as const, revoked };
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

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
