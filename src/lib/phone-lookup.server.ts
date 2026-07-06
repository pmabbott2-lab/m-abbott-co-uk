import { normaliseUkPhone } from "@/lib/sms.server";

/** UK number variants for matching stored profile phones. */
export function ukPhoneVariants(phone: string | null | undefined): string[] {
  const raw = (phone ?? "").trim();
  if (!raw) return [];
  const variants = new Set<string>([raw, raw.replace(/\s+/g, "")]);
  try {
    const normalised = normaliseUkPhone(raw);
    variants.add(normalised);
    if (normalised.startsWith("+44")) variants.add(`0${normalised.slice(3)}`);
  } catch {
    /* ignore */
  }
  return Array.from(variants).filter(Boolean);
}

function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const va = ukPhoneVariants(a);
  const vb = ukPhoneVariants(b);
  return va.some((x) => vb.includes(x));
}

/** Match an inbound caller to their most relevant case/session. */
export async function findSessionForCallerPhone(
  callerPhone: string,
): Promise<{ sessionId: string; customerId: string } | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const callerNorm = normaliseUkPhone(callerPhone);

  const { data: profiles, error } = await supabaseAdmin.from("profiles").select("id, phone");
  if (error) throw new Error(error.message);

  const customer = (profiles ?? []).find((p) => phonesMatch(p.phone, callerNorm));
  if (customer) {
    const session = await pickBestSession(customer.id);
    if (session) return { sessionId: session.id, customerId: customer.id };
  }

  // Appointments often store the mobile used at booking (may differ from profile).
  const { data: appointments } = await supabaseAdmin
    .from("appointments")
    .select("session_id, customer_id, customer_phone, starts_at")
    .not("session_id", "is", null)
    .order("starts_at", { ascending: false })
    .limit(200);

  const appt = (appointments ?? []).find((a) => phonesMatch(a.customer_phone, callerNorm));
  if (appt?.session_id && appt.customer_id) {
    return { sessionId: appt.session_id, customerId: appt.customer_id };
  }

  const { data: callbacks } = await supabaseAdmin
    .from("callback_requests")
    .select("session_id, customer_id, customer_phone, created_at")
    .not("session_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(200);

  const cb = (callbacks ?? []).find((c) => phonesMatch(c.customer_phone, callerNorm));
  if (cb?.session_id && cb.customer_id) {
    return { sessionId: cb.session_id, customerId: cb.customer_id };
  }

  const { data: leads } = await supabaseAdmin
    .from("introducer_leads")
    .select("session_id, customer_phone, created_at")
    .not("session_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(200);

  const lead = (leads ?? []).find((l) => phonesMatch(l.customer_phone, callerNorm));
  if (lead?.session_id) {
    const { data: session } = await supabaseAdmin
      .from("interview_sessions")
      .select("id, customer_id")
      .eq("id", lead.session_id)
      .maybeSingle();
    if (session?.customer_id) {
      return { sessionId: session.id, customerId: session.customer_id };
    }
  }

  return null;
}

async function pickBestSession(
  customerId: string,
): Promise<{ id: string; case_ref?: string | null } | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: sessions, error } = await supabaseAdmin
    .from("interview_sessions")
    .select("id, case_ref, started_at")
    .eq("customer_id", customerId)
    .is("deleted_at", null)
    .order("started_at", { ascending: false });
  if (error) throw new Error(error.message);
  if (!sessions?.length) return null;

  const withCase = sessions.find((s) => (s as { case_ref?: string | null }).case_ref);
  return withCase ?? sessions[0];
}
