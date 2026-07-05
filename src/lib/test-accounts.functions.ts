import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  TEST_ACCOUNTS,
  TEST_ACCOUNT_PASSWORD,
  TEST_ACCOUNT_PHONE,
  isTestAccountEmail,
} from "@/lib/test-accounts";

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

async function upsertTestUser(
  spec: (typeof TEST_ACCOUNTS)[number],
): Promise<{ email: string; userId: string; created: boolean }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const email = spec.email.toLowerCase();

  const existingUsers = await listAllAuthUsers();
  const existing = existingUsers.find((u) => u.email?.toLowerCase() === email);

  let userId: string;
  let created = false;

  if (existing) {
    userId = existing.id;
    await supabaseAdmin.auth.admin.updateUserById(userId, {
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

  return { email, userId, created };
}

export const provisionTestAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string }).email;
    await requireOwner(context.userId, email);

    const results = [];
    for (const spec of TEST_ACCOUNTS) {
      results.push(await upsertTestUser(spec));
    }

    return {
      ok: true as const,
      password: TEST_ACCOUNT_PASSWORD,
      phone: TEST_ACCOUNT_PHONE,
      results,
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
        exists: Boolean(u),
        emailConfirmed: Boolean(u?.email_confirmed_at),
        bypass: Boolean(
          (u?.app_metadata as { test_email_bypass?: boolean } | undefined)?.test_email_bypass,
        ),
      };
    });
  });

export { isTestAccountEmail };
