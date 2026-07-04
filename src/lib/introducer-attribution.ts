/** Customer-level introducer resolution for commission and customer hub. */

type SupabaseAdmin = Awaited<
  ReturnType<typeof import("@/integrations/supabase/client.server")>
>["supabaseAdmin"];

function isMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    error.code === "PGRST204" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

/** First introducer wins — idempotent. */
export async function ensureCustomerIntroducerLink(
  supabaseAdmin: SupabaseAdmin,
  customerId: string,
  introducerId: string,
  source: string,
): Promise<void> {
  const { error } = await supabaseAdmin.from("customer_introducer_links").upsert(
    { customer_id: customerId, introducer_id: introducerId, source },
    { onConflict: "customer_id", ignoreDuplicates: true },
  );
  if (error && !isMissing(error)) {
    console.error("ensureCustomerIntroducerLink failed", error);
  }
}

/** Resolve introducer for a customer (and optional session), back-filling customer link when found. */
export async function resolveIntroducerIdForCustomer(
  supabaseAdmin: SupabaseAdmin,
  customerId: string,
  sessionId?: string | null,
): Promise<string | null> {
  const { data: direct, error: directErr } = await supabaseAdmin
    .from("customer_introducer_links")
    .select("introducer_id")
    .eq("customer_id", customerId)
    .maybeSingle();
  if (directErr && !isMissing(directErr)) throw new Error(directErr.message);
  if (direct?.introducer_id) return direct.introducer_id;

  const found = await findIntroducerIdForCustomer(supabaseAdmin, customerId, sessionId);
  if (found) {
    await ensureCustomerIntroducerLink(supabaseAdmin, customerId, found, "resolved");
  }
  return found;
}

async function findIntroducerIdForCustomer(
  supabaseAdmin: SupabaseAdmin,
  customerId: string,
  sessionId?: string | null,
): Promise<string | null> {
  if (sessionId) {
    const fromSession = await introducerFromSession(supabaseAdmin, sessionId);
    if (fromSession) return fromSession;
  }

  const { data: sessions } = await supabaseAdmin
    .from("interview_sessions")
    .select("id")
    .eq("customer_id", customerId)
    .is("deleted_at", null);
  const sessionIds = (sessions ?? []).map((s) => s.id);

  if (sessionIds.length > 0) {
    const { data: appt } = await supabaseAdmin
      .from("appointments")
      .select("introducer_id")
      .in("session_id", sessionIds)
      .not("introducer_id", "is", null)
      .order("starts_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (appt?.introducer_id) return appt.introducer_id;

    const { data: lead } = await supabaseAdmin
      .from("introducer_leads")
      .select("introducer_id")
      .in("session_id", sessionIds)
      .limit(1)
      .maybeSingle();
    if (lead?.introducer_id) return lead.introducer_id;
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("email, phone")
    .eq("id", customerId)
    .maybeSingle();

  if (profile?.email) {
    const { data: leadByEmail } = await supabaseAdmin
      .from("introducer_leads")
      .select("introducer_id")
      .ilike("customer_email", profile.email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (leadByEmail?.introducer_id) return leadByEmail.introducer_id;
  }

  if (profile?.phone) {
    const { data: leadByPhone } = await supabaseAdmin
      .from("introducer_leads")
      .select("introducer_id")
      .eq("customer_phone", profile.phone)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (leadByPhone?.introducer_id) return leadByPhone.introducer_id;
  }

  return null;
}

async function introducerFromSession(
  supabaseAdmin: SupabaseAdmin,
  sessionId: string,
): Promise<string | null> {
  const { data: appt } = await supabaseAdmin
    .from("appointments")
    .select("introducer_id")
    .eq("session_id", sessionId)
    .not("introducer_id", "is", null)
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (appt?.introducer_id) return appt.introducer_id;

  const { data: lead } = await supabaseAdmin
    .from("introducer_leads")
    .select("introducer_id")
    .eq("session_id", sessionId)
    .limit(1)
    .maybeSingle();
  return lead?.introducer_id ?? null;
}
