import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { chatCompletion } from "@/lib/ai-gateway.server";

const WORD_NUMS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

function wordsToNumber(s: string): number | null {
  // Handles e.g. "two hundred and fifty thousand", "one million", "three hundred thousand"
  const tokens = s.toLowerCase().replace(/-/g, " ").replace(/,/g, " ").split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  let total = 0;
  let current = 0;
  let matched = false;
  for (const t of tokens) {
    if (t === "and") continue;
    if (t in WORD_NUMS) { current += WORD_NUMS[t]; matched = true; }
    else if (t === "hundred") { current = (current || 1) * 100; matched = true; }
    else if (t === "thousand" || t === "k") { total += (current || 1) * 1000; current = 0; matched = true; }
    else if (t === "million" || t === "m" || t === "mil") { total += (current || 1) * 1_000_000; current = 0; matched = true; }
    else return null;
  }
  if (!matched) return null;
  return total + current;
}

function parseMoney(v: string | undefined | null): number | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (!s) return null;
  // Shorthand: "250k", "1.5m", "£300k"
  const short = s.replace(/[£$,\s]/g, "").match(/^([0-9]*\.?[0-9]+)\s*(k|m|mil|million|thousand)?$/);
  if (short) {
    const n = parseFloat(short[1]);
    if (!isNaN(n)) {
      const suf = short[2];
      if (suf === "k" || suf === "thousand") return n * 1000;
      if (suf === "m" || suf === "mil" || suf === "million") return n * 1_000_000;
      return n;
    }
  }
  // Plain digits anywhere
  const cleaned = s.replace(/[^0-9.]/g, "");
  if (cleaned) {
    const n = parseFloat(cleaned);
    if (!isNaN(n) && n > 0) return n;
  }
  // Spelled out
  return wordsToNumber(s);
}

const MONEY_WORD_PATTERN = "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|and";

function extractMoneyCandidates(text: string): Array<{ value: number; index: number; raw: string }> {
  const candidates: Array<{ value: number; index: number; raw: string }> = [];
  const addMatches = (regex: RegExp) => {
    for (const match of text.matchAll(regex)) {
      const raw = match[0].trim();
      const value = parseMoney(raw.replace(/\b(pounds?|quid)\b/gi, "").trim());
      if (value != null && value >= 1_000) candidates.push({ value, index: match.index ?? 0, raw });
    }
  };

  addMatches(/£\s*\d[\d,]*(?:\.\d+)?\s*(?:k|m|mil|million|thousand)?\b/gi);
  addMatches(/\b\d+(?:,\d{3})+(?:\.\d+)?\s*(?:k|m|mil|million|thousand)?\b/gi);
  addMatches(/\b\d+(?:\.\d+)?\s*(?:k|m|mil|million|thousand)\b/gi);
  addMatches(/\b\d{5,8}\b/g);
  addMatches(new RegExp(`\\b(?:(?:${MONEY_WORD_PATTERN})[\\s-]+)*(?:${MONEY_WORD_PATTERN})\\s+(?:thousand|million)(?:\\s+pounds?)?\\b`, "gi"));

  return candidates
    .filter((candidate, idx, arr) => arr.findIndex((other) => Math.abs(other.index - candidate.index) < 3 && other.value === candidate.value) === idx)
    .sort((a, b) => a.index - b.index);
}

function parseContextMoney(text: string, labels: string[], excludeLabels: string[] = []): number | null {
  const candidates = extractMoneyCandidates(text);
  const lower = text.toLowerCase();
  const scored = candidates
    .map((candidate) => {
      const context = lower.slice(Math.max(0, candidate.index - 45), candidate.index + candidate.raw.length + 45);
      const hasLabel = labels.some((label) => new RegExp(`\\b${label}\\b`, "i").test(context));
      const hasExcluded = excludeLabels.some((label) => new RegExp(`\\b${label}\\b`, "i").test(context));
      return { ...candidate, score: (hasLabel ? 2 : 0) - (hasExcluded ? 3 : 0) };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return scored[0]?.value ?? null;
}

function parsePercentage(text: string, label?: string): number | null {
  const lower = text.toLowerCase();
  const searchArea = label && lower.includes(label)
    ? lower.slice(Math.max(0, lower.indexOf(label) - 35), lower.indexOf(label) + 80)
    : lower;
  const digit = searchArea.match(/\b(\d+(?:\.\d+)?)\s*(?:%|percent|per cent)\b/);
  if (digit) return Number(digit[1]);
  const word = searchArea.match(new RegExp(`\\b((?:(?:${MONEY_WORD_PATTERN})[\\s-]+){0,4}(?:${MONEY_WORD_PATTERN}))\\s+(?:percent|per cent)\\b`, "i"));
  if (word) return wordsToNumber(word[1]);
  return null;
}

function parseYears(v: string | undefined | null): number | null {
  if (!v) return null;
  const m = v.match(/\b(\d{1,2})\s*(?:years?|yrs?|year\s+term)\b/i) ?? v.match(/\b(?:over|for|term(?:\s+of)?)\D{0,20}(\d{1,2})\b/i);
  if (m) return parseInt(m[1], 10);
  const word = v.match(new RegExp(`\\b((?:(?:${MONEY_WORD_PATTERN})[\\s-]+){0,3}(?:${MONEY_WORD_PATTERN}))\\s+(?:years?|yrs?|year\\s+term)\\b`, "i"));
  if (word) return wordsToNumber(word[1]);
  return null;
}

function parsePurpose(text: string): string {
  if (/\b(first[-\s]?time|first\s+purchase|purchase|buying|buy)\b/i.test(text)) return "Purchase";
  if (/\b(remortgage|re[-\s]?mortgage)\b/i.test(text)) return "Remortgage";
  if (/\b(next\s+home|home\s+mover|moving\s+home)\b/i.test(text)) return "Next home";
  if (/\b(buy[-\s]?to[-\s]?let|btl|investment)\b/i.test(text)) return "Buy-to-let";
  return "";
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
    const mortgageNeed = map.get("property:mortgage_need") ?? "";
    const moneyCandidates = extractMoneyCandidates(mortgageNeed);
    const price =
      parseMoney(map.get("property:property_value")) ??
      parseMoney(map.get("property:home_price")) ??
      parseContextMoney(mortgageNeed, ["price", "value", "property", "purchase", "buying", "worth"], ["deposit"] ) ??
      moneyCandidates[0]?.value ??
      null;
    const depositPercent = parsePercentage(mortgageNeed, "deposit");
    const deposit =
      parseMoney(map.get("property:deposit")) ??
      parseContextMoney(mortgageNeed, ["deposit"], []) ??
      moneyCandidates.find((candidate) => candidate.value !== price)?.value ??
      (price != null && depositPercent != null ? (price * depositPercent) / 100 : null);
    const term = parseYears(map.get("property:term_years")) ?? parseYears(map.get("property:mortgage_term")) ?? parseYears(mortgageNeed) ?? 25;
    const work = map.get("employment:work") ?? "";
    const income = parseMoney(map.get("employment:annual_income")) ?? parseContextMoney(work, ["income", "salary", "earn", "annual", "year", "gross"], []);
    const purpose = map.get("property:purpose") ?? parsePurpose(mortgageNeed);
    const employment = map.get("employment:employment_status") ?? work;

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
