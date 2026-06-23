import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { chatCompletion } from "@/lib/ai-gateway.server";

function parseMoney(v: string | undefined | null): number | null {
  if (!v) return null;
  const cleaned = v.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function parseYears(v: string | undefined | null): number | null {
  if (!v) return null;
  const m = v.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function monthlyPayment(principal: number, annualRatePct: number, years: number): number {
  const r = annualRatePct / 100 / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

export const generateLenderExample = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: answers, error } = await context.supabase
      .from("interview_answers")
      .select("section, field_key, value")
      .eq("session_id", data.sessionId);
    if (error) throw new Error(error.message);

    const map = new Map((answers ?? []).map((a) => [`${a.section}:${a.field_key}`, a.value]));
    const price = parseMoney(map.get("property:property_value"));
    const deposit = parseMoney(map.get("property:deposit"));
    const term = parseYears(map.get("property:term_years")) ?? 25;
    const income = parseMoney(map.get("employment:annual_income"));
    const purpose = map.get("property:purpose") ?? "";
    const employment = map.get("employment:employment_status") ?? "";

    if (price == null || deposit == null) {
      throw new Error("Need property price and deposit captured in the fact-find to calculate.");
    }

    const loan = Math.max(price - deposit, 0);
    const ltv = price > 0 ? (loan / price) * 100 : 0;

    // Ask AI to suggest an illustrative rate band based on LTV/term/purpose
    let rate = 4.75;
    let productLabel = "5-year fixed";
    let aiNote = "";
    try {
      const out = await chatCompletion({
        messages: [
          {
            role: "system",
            content:
              "You are a UK mortgage analyst. Return ONLY JSON. Provide an illustrative (not a real quote) rate and product for the given scenario. Be realistic for current UK high-street pricing trends.",
          },
          {
            role: "user",
            content: `Loan: £${loan.toFixed(0)}, Property: £${price.toFixed(0)}, LTV: ${ltv.toFixed(1)}%, Term: ${term} years, Purpose: ${purpose}, Employment: ${employment}, Annual income: ${income ?? "unknown"}.
Return JSON: { "rate": <number, annual %>, "product": "<e.g. '5-year fixed'>", "note": "<one short paragraph (max 60 words) explaining the illustrative lender scenario and any affordability/LTV considerations. End with 'For illustration only — not a quote.'>" }`,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      });
      const parsed = JSON.parse(out) as { rate?: number; product?: string; note?: string };
      if (typeof parsed.rate === "number" && parsed.rate > 0 && parsed.rate < 20) rate = parsed.rate;
      if (parsed.product) productLabel = parsed.product;
      if (parsed.note) aiNote = parsed.note;
    } catch (e) {
      console.error("lender example AI failed", e);
      aiNote = "Illustrative example based on typical UK rates. For illustration only — not a quote.";
    }

    const monthly = monthlyPayment(loan, rate, term);
    const incomeMultiple = income && income > 0 ? loan / income : null;

    return {
      inputs: { price, deposit, loan, ltv, term, income, purpose, employment },
      illustration: {
        rate,
        product: productLabel,
        monthly,
        totalPayable: monthly * term * 12,
        incomeMultiple,
        note: aiNote,
      },
    };
  });


export const listMySessions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("interview_sessions")
      .select("*")
      .order("started_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("interview_sessions")
      .insert({ customer_id: context.userId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  });

export const getSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: session, error } = await context.supabase
      .from("interview_sessions")
      .select("*")
      .eq("id", data.sessionId)
      .single();
    if (error) throw new Error(error.message);
    const { data: messages } = await context.supabase
      .from("interview_messages")
      .select("*")
      .eq("session_id", data.sessionId)
      .order("created_at", { ascending: true });
    const { data: answers } = await context.supabase
      .from("interview_answers")
      .select("*")
      .eq("session_id", data.sessionId);
    return { session, messages: messages ?? [], answers: answers ?? [] };
  });

export const submitSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("interview_sessions")
      .update({ status: "submitted", submitted_at: new Date().toISOString() })
      .eq("id", data.sessionId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // Authorize: must be advisor OR the owning customer
    const { data: roleRows } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const isAdvisor = (roleRows ?? []).some((r) => r.role === "advisor");
    const { data: session, error: sErr } = await context.supabase
      .from("interview_sessions")
      .select("id, customer_id")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (sErr) throw new Error(sErr.message);
    if (!session) throw new Error("Not found");
    if (!isAdvisor && session.customer_id !== context.userId) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("interview_answers").delete().eq("session_id", data.sessionId);
    await supabaseAdmin.from("interview_messages").delete().eq("session_id", data.sessionId);
    await supabaseAdmin.from("advisor_notes").delete().eq("session_id", data.sessionId);
    const { error } = await supabaseAdmin.from("interview_sessions").delete().eq("id", data.sessionId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setSessionPosition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      sessionId: z.string().uuid(),
      section: z.enum(["personal", "employment", "outgoings", "property"]),
      index: z.number().int().min(0),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("interview_sessions")
      .update({
        current_section: data.section,
        current_question_index: data.index,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.sessionId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      sessionId: z.string().uuid(),
      section: z.string(),
      fieldKey: z.string(),
      fieldLabel: z.string(),
      value: z.string(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("interview_answers").upsert(
      {
        session_id: data.sessionId,
        section: data.section,
        field_key: data.fieldKey,
        field_label: data.fieldLabel,
        value: data.value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "session_id,section,field_key" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getMyRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const roles = (data ?? []).map((r) => r.role);
    return { isAdvisor: roles.includes("advisor"), roles };
  });

export const listAllSessionsForAdvisor = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: roleRows } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (!(roleRows ?? []).some((r) => r.role === "advisor")) {
      throw new Error("Forbidden");
    }
    const { data: sessions, error } = await context.supabase
      .from("interview_sessions")
      .select("*")
      .order("started_at", { ascending: false });
    if (error) throw new Error(error.message);
    const customerIds = Array.from(new Set((sessions ?? []).map((s) => s.customer_id)));
    let profiles: Array<{ id: string; full_name: string | null; email: string | null }> = [];
    if (customerIds.length > 0) {
      const { data: p } = await context.supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", customerIds);
      profiles = p ?? [];
    }
    const profileMap = new Map(profiles.map((p) => [p.id, p]));
    return (sessions ?? []).map((s) => ({
      ...s,
      customer: profileMap.get(s.customer_id) ?? null,
    }));
  });

export const addAdvisorNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ sessionId: z.string().uuid(), note: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("advisor_notes")
      .insert({ session_id: data.sessionId, advisor_id: context.userId, note: data.note });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: notes, error } = await context.supabase
      .from("advisor_notes")
      .select("*")
      .eq("session_id", data.sessionId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return notes ?? [];
  });
