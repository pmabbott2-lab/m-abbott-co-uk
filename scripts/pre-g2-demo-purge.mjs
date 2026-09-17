/**
 * One-off pre-G2 controlled demo purge.
 * Uses the same wipe patterns as test-accounts.functions.ts purgeTestAccount,
 * but ONLY for the 16 authorised DELETE accounts, then transactional-only
 * cleanup for the 6 KEEP accounts (structural roles retained).
 *
 * Run: node --env-file=.env scripts/pre-g2-demo-purge.mjs
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const KEEP = new Set([
  "pmabbott2@aol.com",
  "1@test.co.uk",
  "4@test.co.uk",
  "5@test.co.uk",
  "6@test.co.uk",
  "13@test.co.uk",
]);

function isMissing(error) {
  if (!error) return false;
  const code = error.code ?? "";
  const msg = (error.message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache") ||
    msg.includes("could not find")
  );
}

async function safeDelete(label, run) {
  const { error } = await run();
  if (error && !isMissing(error)) {
    console.warn(`[purge] ${label}:`, error.message);
  }
}

async function listAllUsers() {
  const all = [];
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    all.push(...(data.users ?? []));
    if ((data.users ?? []).length < 200) break;
    page += 1;
  }
  return all;
}

/** Mirrors wipeTestAccountActivity in test-accounts.functions.ts */
async function wipeUserActivity(userId, email, { removeStructure }) {
  const emailLower = email.toLowerCase();

  const { data: sessions } = await admin
    .from("interview_sessions")
    .select("id")
    .eq("customer_id", userId);
  const sessionIds = (sessions ?? []).map((s) => s.id);

  if (sessionIds.length) {
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
    ]) {
      await safeDelete(`${table}/session`, () =>
        admin.from(table).delete().in("session_id", sessionIds),
      );
    }
    await safeDelete("interview_sessions", () =>
      admin.from("interview_sessions").delete().in("id", sessionIds),
    );
  }

  await safeDelete("session_advisors/advisor", () =>
    admin.from("session_advisors").delete().eq("advisor_id", userId),
  );
  await safeDelete("advisor_notes/advisor", () =>
    admin.from("advisor_notes").delete().eq("advisor_id", userId),
  );
  await safeDelete("appointments/email", () =>
    admin.from("appointments").delete().ilike("customer_email", emailLower),
  );
  await safeDelete("appointments/advisor", () =>
    admin.from("appointments").delete().eq("advisor_id", userId),
  );
  await safeDelete("staff_tasks/assigned", () =>
    admin.from("staff_contact_tasks").delete().eq("assigned_to", userId),
  );
  await safeDelete("staff_tasks/created", () =>
    admin.from("staff_contact_tasks").delete().eq("created_by", userId),
  );
  await safeDelete("advisor_contact_views", () =>
    admin.from("advisor_contact_views").delete().eq("advisor_id", userId),
  );
  await safeDelete("callbacks/assigned", () =>
    admin.from("callback_requests").delete().eq("assigned_to", userId),
  );

  const { data: introducer } = await admin
    .from("introducers")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (introducer?.id) {
    await safeDelete("introducer_leads", () =>
      admin.from("introducer_leads").delete().eq("introducer_id", introducer.id),
    );
    await safeDelete("introducer_amendment_history/prev", () =>
      admin.from("introducer_amendment_history").delete().eq("previous_introducer_id", introducer.id),
    );
    await safeDelete("introducer_amendment_history/new", () =>
      admin.from("introducer_amendment_history").delete().eq("new_introducer_id", introducer.id),
    );
    await safeDelete("appointments/introducer", () =>
      admin.from("appointments").delete().eq("introducer_id", introducer.id),
    );
    await safeDelete("customer_introducer_links", () =>
      admin.from("customer_introducer_links").delete().eq("introducer_id", introducer.id),
    );
    if (removeStructure) {
      await safeDelete("introducers", () =>
        admin.from("introducers").delete().eq("id", introducer.id),
      );
    }
  }

  await safeDelete("customer_introducer_links/customer", () =>
    admin.from("customer_introducer_links").delete().eq("customer_id", userId),
  );
  await safeDelete("finance_ledger/beneficiary", () =>
    admin.from("finance_ledger").delete().eq("beneficiary_user_id", userId),
  );
  await safeDelete("commission_rate_history", () =>
    admin.from("commission_rate_history").delete().eq("user_id", userId),
  );
  if (removeStructure) {
    await safeDelete("commission_rates", () =>
      admin.from("commission_rates").delete().eq("user_id", userId),
    );
  }
  await safeDelete("finance_audit_log/actor", () =>
    admin.from("finance_audit_log").delete().eq("actor_user_id", userId),
  );
  await safeDelete("network_commission_lines", () =>
    admin.from("network_commission_lines").delete().eq("matched_customer_id", userId),
  );
  await safeDelete("referrals/referrer", () =>
    admin.from("referrals").delete().eq("referrer_id", userId),
  );
  await safeDelete("referrals/referee", () =>
    admin.from("referrals").delete().eq("referee_id", userId),
  );
  await safeDelete("referral_codes", () =>
    admin.from("referral_codes").delete().eq("user_id", userId),
  );
  await safeDelete("view_as/actor", () =>
    admin.from("view_as_audit_log").delete().eq("actor_id", userId),
  );
  await safeDelete("view_as/target", () =>
    admin.from("view_as_audit_log").delete().eq("target_user_id", userId),
  );
  await safeDelete("phone_calls/advisor", () =>
    admin.from("phone_calls").delete().eq("advisor_id", userId),
  );
  await safeDelete("phone_calls/customer", () =>
    admin.from("phone_calls").delete().eq("customer_id", userId),
  );

  if (removeStructure) {
    await safeDelete("advisor_availability", () =>
      admin.from("advisor_availability").delete().eq("advisor_id", userId),
    );
    await safeDelete("advisor_diary_settings", () =>
      admin.from("advisor_diary_settings").delete().eq("advisor_id", userId),
    );
    await safeDelete("advisor_diary_exceptions", () =>
      admin.from("advisor_diary_exceptions").delete().eq("advisor_id", userId),
    );
    await safeDelete("admin_permissions", () =>
      admin.from("admin_permissions").delete().eq("user_id", userId),
    );
    await safeDelete("admin_profiles", () =>
      admin.from("admin_profiles").delete().eq("user_id", userId),
    );
    await safeDelete("advisor_profiles", () =>
      admin.from("advisor_profiles").delete().eq("user_id", userId),
    );
    await safeDelete("advisor_telephony", () =>
      admin.from("advisor_telephony").delete().eq("user_id", userId),
    );
    await safeDelete("staff_invitations/created", () =>
      admin.from("staff_invitations").delete().eq("created_by", userId),
    );
    await safeDelete("staff_invitations/email", () =>
      admin.from("staff_invitations").delete().ilike("email", emailLower),
    );
    await safeDelete("user_roles", () =>
      admin.from("user_roles").delete().eq("user_id", userId),
    );
    await safeDelete("profiles", () => admin.from("profiles").delete().eq("id", userId));
    try {
      await admin.auth.admin.signOut(userId, "global");
    } catch {
      /* ignore */
    }
  }
}

async function orphanSweep() {
  // Any remaining demo transactional rows with no KEEP structural need
  await safeDelete("all interview_messages", () => admin.from("interview_messages").delete().neq("id", "00000000-0000-0000-0000-000000000000"));
  await safeDelete("all interview_answers", () => admin.from("interview_answers").delete().neq("id", "00000000-0000-0000-0000-000000000000"));
  await safeDelete("all interview_sessions", () => admin.from("interview_sessions").delete().neq("id", "00000000-0000-0000-0000-000000000000"));
  await safeDelete("all appointments", () => admin.from("appointments").delete().neq("id", "00000000-0000-0000-0000-000000000000"));
  await safeDelete("all callbacks", () => admin.from("callback_requests").delete().neq("id", "00000000-0000-0000-0000-000000000000"));
  await safeDelete("all sms", () => admin.from("sms_messages").delete().neq("id", "00000000-0000-0000-0000-000000000000"));
  await safeDelete("all phone_calls", () => admin.from("phone_calls").delete().neq("id", "00000000-0000-0000-0000-000000000000"));
  await safeDelete("all leads", () => admin.from("introducer_leads").delete().neq("id", "00000000-0000-0000-0000-000000000000"));
  await safeDelete("all contact_log", () => admin.from("customer_contact_log").delete().neq("id", "00000000-0000-0000-0000-000000000000"));
  await safeDelete("all advisor_notes", () => admin.from("advisor_notes").delete().neq("id", "00000000-0000-0000-0000-000000000000"));
  await safeDelete("all session_advisors", () => admin.from("session_advisors").delete().neq("id", "00000000-0000-0000-0000-000000000000"));
  await safeDelete("all session_contact_tracking", () => admin.from("session_contact_tracking").delete().neq("id", "00000000-0000-0000-0000-000000000000"));
  await safeDelete("all milestones", () => admin.from("customer_journey_milestones").delete().neq("id", "00000000-0000-0000-0000-000000000000"));
  await safeDelete("all staff_tasks", () => admin.from("staff_contact_tasks").delete().neq("id", "00000000-0000-0000-0000-000000000000"));
  await safeDelete("all fee_lines", () => admin.from("finance_fee_lines").delete().neq("id", "00000000-0000-0000-0000-000000000000"));
  await safeDelete("all finance_ledger", () => admin.from("finance_ledger").delete().neq("id", "00000000-0000-0000-0000-000000000000"));
  await safeDelete("all finance_audit", () => admin.from("finance_audit_log").delete().neq("id", "00000000-0000-0000-0000-000000000000"));
  await safeDelete("all referrals", () => admin.from("referrals").delete().neq("id", "00000000-0000-0000-0000-000000000000"));
  await safeDelete("all referral_codes", () => admin.from("referral_codes").delete().neq("id", "00000000-0000-0000-0000-000000000000"));
  await safeDelete("all view_as", () => admin.from("view_as_audit_log").delete().neq("id", "00000000-0000-0000-0000-000000000000"));
  await safeDelete("all contact_views", () => admin.from("advisor_contact_views").delete().neq("id", "00000000-0000-0000-0000-000000000000"));
  await safeDelete("all cust_intro_links", () => admin.from("customer_introducer_links").delete().neq("id", "00000000-0000-0000-0000-000000000000"));
  await safeDelete("all intro amendments", () => admin.from("introducer_amendment_history").delete().neq("id", "00000000-0000-0000-0000-000000000000"));
  await safeDelete("all network lines", () => admin.from("network_commission_lines").delete().neq("id", "00000000-0000-0000-0000-000000000000"));
  await safeDelete("all network statements", () => admin.from("network_commission_statements").delete().neq("id", "00000000-0000-0000-0000-000000000000"));
}

async function main() {
  const users = await listAllUsers();
  console.log(`Loaded ${users.length} auth users`);

  const keepUsers = [];
  const deleteUsers = [];
  for (const u of users) {
    const email = (u.email || "").toLowerCase();
    if (!email) continue;
    if (KEEP.has(email)) keepUsers.push(u);
    else deleteUsers.push(u);
  }

  if (keepUsers.length !== 6) {
    console.error(
      "STOP: expected 6 KEEP accounts, found",
      keepUsers.length,
      keepUsers.map((u) => u.email),
    );
    process.exit(2);
  }
  if (deleteUsers.length !== 16) {
    console.error(
      "STOP: expected 16 DELETE accounts, found",
      deleteUsers.length,
      deleteUsers.map((u) => u.email),
    );
    process.exit(2);
  }

  // Customers first (same ordering idea as revokeTestAccounts)
  deleteUsers.sort((a, b) => {
    const rank = (email) => {
      const e = email.toLowerCase();
      if (/^[6-9]@test\.co\.uk$|^1[0-2]@test\.co\.uk$/.test(e)) return 0;
      if (/^[123]@test\.co\.uk$/.test(e)) return 1;
      if (/^[45]@test\.co\.uk$/.test(e)) return 2;
      return 3;
    };
    return rank(a.email) - rank(b.email);
  });

  const deleted = [];
  for (const u of deleteUsers) {
    const email = u.email.toLowerCase();
    console.log(`Deleting ${email} …`);
    await wipeUserActivity(u.id, email, { removeStructure: true });
    const { error } = await admin.auth.admin.deleteUser(u.id);
    if (error && !/not found/i.test(error.message)) {
      console.error(`STOP: failed to delete auth user ${email}:`, error.message);
      process.exit(3);
    }
    deleted.push(email);
  }

  for (const u of keepUsers) {
    const email = u.email.toLowerCase();
    console.log(`Purging history for KEEP ${email} …`);
    await wipeUserActivity(u.id, email, { removeStructure: false });
  }

  console.log("Orphan transactional sweep …");
  await orphanSweep();

  // Remove introducers that no longer have a KEEP user (should not happen for 1@ and owner)
  const { data: intros } = await admin.from("introducers").select("id,user_id");
  for (const row of intros ?? []) {
    if (!keepUsers.some((u) => u.id === row.user_id)) {
      await safeDelete("orphan introducer", () =>
        admin.from("introducers").delete().eq("id", row.id),
      );
    }
  }

  const after = await listAllUsers();
  console.log(
    JSON.stringify(
      {
        deleted,
        retained: after.map((u) => u.email?.toLowerCase()).sort(),
        retainedCount: after.length,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
