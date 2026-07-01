import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { chatCompletion } from "@/lib/ai-gateway.server";
import { extractStructuredFields } from "@/lib/structured-answers";
import { generateUniqueCompanyCode } from "@/lib/introducer.functions";
import {
  normaliseUkPhone,
  sendInterviewCompleteSms,
  sendJourneyMilestoneSms,
} from "@/lib/sms.server";

// Each customer file (session) can be allocated to at most this many advisors.
const MAX_ADVISORS_PER_SESSION = 3;

// Advisor codes: 5-char uppercase, ambiguous characters (I/O/0/1) removed so they
// are easy to read out and type. Still matches the DB CHECK (^[A-Z0-9]{5}$).
const ADVISOR_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ADVISOR_CODE_LENGTH = 5;

function randomAdvisorCode(): string {
  let code = "";
  for (let i = 0; i < ADVISOR_CODE_LENGTH; i += 1) {
    code += ADVISOR_CODE_ALPHABET[Math.floor(Math.random() * ADVISOR_CODE_ALPHABET.length)];
  }
  return code;
}

// Ensure the given advisor has a unique code, generating one on first use.
// Returns null if the advisor_profiles table doesn't exist yet (pre-migration).
async function ensureAdvisorCode(userId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: existing, error: existingErr } = await supabaseAdmin
    .from("advisor_profiles")
    .select("code")
    .eq("user_id", userId)
    .maybeSingle();
  if (existingErr) {
    if (isMissingTableError(existingErr)) return null;
    throw new Error(existingErr.message);
  }
  if (existing) return existing.code;

  for (let i = 0; i < 50; i += 1) {
    const code = randomAdvisorCode();
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("advisor_profiles")
      .insert({ user_id: userId, code })
      .select("code")
      .single();
    if (!insErr) return inserted.code;
    if (isMissingTableError(insErr)) return null;
    // 23505 = unique violation: either this user already has a code (race) or
    // the generated code collided. Re-check the user, otherwise retry.
    if (insErr.code === "23505") {
      const { data: again } = await supabaseAdmin
        .from("advisor_profiles")
        .select("code")
        .eq("user_id", userId)
        .maybeSingle();
      if (again) return again.code;
      continue;
    }
    throw new Error(insErr.message);
  }
  return null;
}

// Resolve an advisor code (case-insensitive) to its advisor user_id.
async function resolveAdvisorIdByCode(code: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("advisor_profiles")
    .select("user_id")
    .eq("code", code.trim().toUpperCase())
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw new Error(error.message);
  }
  return data?.user_id ?? null;
}

// The session_advisors table / 'admin' enum value only exist once the allocation
// migration has been applied. Treat "table missing" errors as "no allocations"
// so the dashboard keeps working before the user runs APPLY_NEW_FEATURES.sql.
function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const msg = (error.message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    code === "PGRST106" ||
    msg.includes("session_advisors") ||
    msg.includes("customer_journey_milestones") ||
    msg.includes("session_attention_cleared") ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

async function getRolesForUser(userId: string): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  return (data ?? []).map((r) => r.role);
}

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
  const labelHits = labels.flatMap((label) => {
    const re = new RegExp(`\\b${label}\\b`, "gi");
    return Array.from(text.matchAll(re)).map((m) => m.index ?? -1).filter((i) => i >= 0);
  });
  const excludeHits = excludeLabels.flatMap((label) => {
    const re = new RegExp(`\\b${label}\\b`, "gi");
    return Array.from(text.matchAll(re)).map((m) => m.index ?? -1).filter((i) => i >= 0);
  });
  const scored = candidates
    .map((candidate) => {
      const center = candidate.index + candidate.raw.length / 2;
      const labelDist = labelHits.length ? Math.min(...labelHits.map((i) => Math.abs(i - center))) : Infinity;
      const excludeDist = excludeHits.length ? Math.min(...excludeHits.map((i) => Math.abs(i - center))) : Infinity;
      const context = lower.slice(Math.max(0, candidate.index - 45), candidate.index + candidate.raw.length + 45);
      const hasExcludedInWindow = excludeLabels.some((label) => new RegExp(`\\b${label}\\b`, "i").test(context));
      return { ...candidate, labelDist, excludeDist, hasExcludedInWindow };
    })
    // The closest label word wins; ties broken by document order.
    .filter((c) => c.labelDist < Infinity && c.labelDist < c.excludeDist)
    .sort((a, b) => a.labelDist - b.labelDist || a.index - b.index);
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
    // Legacy single-question fact-find used "property:mortgage_need"; newer flow
    // splits it into discrete fields. Support both.
    const mortgageNeed = map.get("property:mortgage_need") ?? "";

    const purposeRaw =
      map.get("property:mortgage_purpose") ?? map.get("property:purpose") ?? mortgageNeed;
    const purpose = parsePurpose(purposeRaw) || parsePurpose(mortgageNeed) || "Purchase";
    const isRemortgage = /remortgage/i.test(purpose);

    const price =
      parseMoney(map.get("property:property_price")) ??
      parseMoney(map.get("property:property_value")) ??
      parseMoney(map.get("property:home_price")) ??
      parseContextMoney(mortgageNeed, ["price", "value", "property", "purchase", "buying", "worth"], ["deposit"]) ??
      null;

    const term =
      parseYears(map.get("property:mortgage_term")) ??
      parseYears(map.get("property:term_years")) ??
      parseYears(mortgageNeed) ??
      25;

    const incomeText = map.get("employment:income") ?? "";
    const work = map.get("employment:work") ?? "";
    const income =
      parseMoney(map.get("employment:annual_income")) ??
      parseMoney(incomeText) ??
      parseContextMoney(incomeText, ["income", "salary", "earn", "annual", "year", "gross"], []) ??
      parseContextMoney(work, ["income", "salary", "earn", "annual", "year", "gross"], []);
    const employment = map.get("employment:employment_status") ?? work;

    let deposit: number | null = null;
    let owed: number | null = null;
    let equity: number | null = null;
    let loan: number;

    if (isRemortgage) {
      owed =
        parseMoney(map.get("property:amount_owed")) ??
        parseContextMoney(mortgageNeed, ["owe", "owed", "balance", "outstanding", "remaining"], ["value", "worth", "property"]);
      if (price == null || owed == null) {
        throw new Error("Need the property value and the balance owed captured in the fact-find to calculate this remortgage.");
      }
      loan = owed;
      equity = Math.max(price - owed, 0);
      deposit = equity; // displayed as equity for remortgages
    } else {
      const moneyCandidates = extractMoneyCandidates(mortgageNeed);
      const depositPercent = parsePercentage(mortgageNeed, "deposit");
      deposit =
        parseMoney(map.get("property:deposit")) ??
        parseContextMoney(mortgageNeed, ["deposit", "putting down", "put down", "saved"], ["price", "value", "worth", "purchase", "buying", "property"]) ??
        (price != null && depositPercent != null ? (price * depositPercent) / 100 : null) ??
        moneyCandidates.find((candidate) => price == null || candidate.value !== price)?.value ??
        null;
      if (price != null && deposit != null && deposit >= price) {
        const alt = moneyCandidates.find((c) => c.value < price && c.value !== deposit);
        if (alt) deposit = alt.value;
      }
      if (price == null || deposit == null) {
        throw new Error("Need property price and deposit captured in the fact-find to calculate.");
      }
      loan = Math.max(price - deposit, 0);
    }

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
      inputs: { price, deposit, loan, ltv, term, income, purpose, employment, isRemortgage, owed, equity },
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

    // Allocation gate (app-layer): the owning customer and the main admin can
    // always view. A regular advisor may only view a fact-find allocated to them
    // (session_advisors) or one where they hold the appointment.
    if (session && session.customer_id !== context.userId) {
      const roles = await getRolesForUser(context.userId);
      const isMainAdmin = roles.includes("admin");
      const isAdvisor = roles.includes("advisor");
      if (!isMainAdmin) {
        if (!isAdvisor) throw new Error("Forbidden");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let allowed = false;
        const { data: alloc, error: allocErr } = await supabaseAdmin
          .from("session_advisors")
          .select("id")
          .eq("session_id", data.sessionId)
          .eq("advisor_id", context.userId)
          .maybeSingle();
        if (allocErr && !isMissingTableError(allocErr)) throw new Error(allocErr.message);
        if (alloc) allowed = true;
        if (!allowed) {
          const { data: appt } = await supabaseAdmin
            .from("appointments")
            .select("id")
            .eq("session_id", data.sessionId)
            .eq("advisor_id", context.userId)
            .limit(1)
            .maybeSingle();
          if (appt) allowed = true;
        }
        if (!allowed) throw new Error("This fact-find is not allocated to you.");
      }
    }

    const { data: messages } = await context.supabase
      .from("interview_messages")
      .select("*")
      .eq("session_id", data.sessionId)
      .order("created_at", { ascending: true });
    const { data: answers } = await context.supabase
      .from("interview_answers")
      .select("*")
      .eq("session_id", data.sessionId);
    let customer: { id: string; full_name: string | null; email: string | null; phone: string | null } | null = null;
    if (session?.customer_id) {
      const { data: profile, error: profileError } = await context.supabase
        .from("profiles")
        .select("id, full_name, email, phone")
        .eq("id", session.customer_id)
        .maybeSingle();
      if (profileError) {
        // The `phone` column may not exist yet (migration not applied) — fall back.
        const { data: basic } = await context.supabase
          .from("profiles")
          .select("id, full_name, email")
          .eq("id", session.customer_id)
          .maybeSingle();
        customer = basic ? { ...basic, phone: null } : null;
      } else {
        customer = profile ?? null;
      }
    }
    return { session, messages: messages ?? [], answers: answers ?? [], customer };
  });

export const submitSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // Read the current status first so the completion side-effects only fire on a
    // real transition into "submitted" (submit can be retried from the summary).
    const { data: existing, error: readErr } = await context.supabase
      .from("interview_sessions")
      .select("id, status, customer_id")
      .eq("id", data.sessionId)
      .single();
    if (readErr) throw new Error(readErr.message);
    const alreadySubmitted = existing.status === "submitted";

    const { error } = await context.supabase
      .from("interview_sessions")
      .update({ status: "submitted", submitted_at: new Date().toISOString() })
      .eq("id", data.sessionId);
    if (error) throw new Error(error.message);
    // RAF: completing (submitting) a fact-find qualifies the customer's referral
    // so the referrer's bonus becomes reviewable. Best-effort, never blocks.
    const { markReferralQualified } = await import("@/lib/referrals.functions");
    await markReferralQualified(context.userId);

    if (!alreadySubmitted) {
      await sendInterviewCompleteSms(existing.customer_id, data.sessionId);
    }
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
        structured_value: extractStructuredFields(data.fieldKey, data.value),
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
    let roles = (data ?? []).map((r) => r.role);

    // Zero-SQL bootstrap: any email listed in ADMIN_EMAILS (comma-separated) is
    // auto-granted the advisor + admin roles the first time they sign in. This
    // seeds the main admin, who is also a full working advisor and can manage
    // everyone else (and allocate fact-finds) from inside the app.
    const email = (context.claims as { email?: string }).email?.trim().toLowerCase();
    const adminEmails = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (email && adminEmails.includes(email)) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      if (!roles.includes("advisor")) {
        await supabaseAdmin
          .from("user_roles")
          .upsert({ user_id: context.userId, role: "advisor" }, { onConflict: "user_id,role" });
        roles = [...roles, "advisor"];
      }
      if (!roles.includes("admin")) {
        // The 'admin' enum value only exists once the allocation migration has
        // been applied. Swallow the error so sign-in still works beforehand.
        const { error } = await supabaseAdmin
          .from("user_roles")
          .upsert({ user_id: context.userId, role: "admin" }, { onConflict: "user_id,role" });
        if (!error) roles = [...roles, "admin"];
      }
    }

    // Every advisor gets a unique short code (used by the admin to allocate).
    let advisorCode: string | null = null;
    if (roles.includes("advisor")) {
      try {
        advisorCode = await ensureAdvisorCode(context.userId);
      } catch (e) {
        console.error("ensure advisor code failed", e);
      }
    }

    return {
      isAdvisor: roles.includes("advisor"),
      isMainAdmin: roles.includes("admin"),
      advisorCode,
      roles,
    };
  });

export const listUsersWithRoles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: myRoles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (!(myRoles ?? []).some((r) => r.role === "advisor")) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .order("email", { ascending: true });
    if (error) throw new Error(error.message);
    const { data: roleRows } = await supabaseAdmin.from("user_roles").select("user_id, role");
    const advisorIds = new Set(
      (roleRows ?? []).filter((r) => r.role === "advisor").map((r) => r.user_id),
    );
    const introducerIds = new Set(
      (roleRows ?? []).filter((r) => r.role === "introducer").map((r) => r.user_id),
    );

    // Advisor codes (for display next to each advisor).
    const advisorCodeMap = new Map<string, string>();
    {
      const { data: codes, error: codeErr } = await supabaseAdmin
        .from("advisor_profiles")
        .select("user_id, code");
      if (codeErr && !isMissingTableError(codeErr)) throw new Error(codeErr.message);
      for (const c of codes ?? []) advisorCodeMap.set(c.user_id, c.code);
    }

    // Introducer company codes (degrade gracefully if the column doesn't exist).
    const companyMap = new Map<string, { code: string | null; name: string | null }>();
    {
      const withCode = await supabaseAdmin
        .from("introducers")
        .select("user_id, company_code, company_name");
      if (withCode.error && !isMissingTableError(withCode.error)) {
        throw new Error(withCode.error.message);
      }
      const rows = withCode.error
        ? ((await supabaseAdmin.from("introducers").select("user_id, company_name")).data ?? []).map(
            (r) => ({ ...r, company_code: null as string | null }),
          )
        : withCode.data ?? [];
      for (const r of rows) {
        companyMap.set(r.user_id, {
          code: (r as { company_code?: string | null }).company_code ?? null,
          name: r.company_name ?? null,
        });
      }
    }

    return (profiles ?? []).map((p) => ({
      id: p.id,
      full_name: p.full_name,
      email: p.email,
      isAdvisor: advisorIds.has(p.id),
      isIntroducer: introducerIds.has(p.id),
      isSelf: p.id === context.userId,
      advisorCode: advisorCodeMap.get(p.id) ?? null,
      companyCode: companyMap.get(p.id)?.code ?? null,
      companyName: companyMap.get(p.id)?.name ?? null,
    }));
  });

function slugifyName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// Grant the introducer role to a user and ensure their introducer profile
// exists, resolving the chosen company linkage (create a fresh 4-digit code or
// join an existing company by code). Shared by setIntroducerRole, the invite
// consume flow and restore. Returns the resolved company code.
async function grantIntroducerRole(
  userId: string,
  companyMode: "new" | "join" | undefined,
  companyCode: string | undefined,
): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Resolve the target company (code + name). Join copies an existing
  // company's identity; new mints a fresh unique code.
  let resolvedCode: string;
  let joinedCompanyName: string | null = null;
  if (companyMode === "join") {
    if (!companyCode) throw new Error("Enter the 4-digit company code to join.");
    const { data: company, error: companyErr } = await supabaseAdmin
      .from("introducers")
      .select("company_name, company_code")
      .eq("company_code", companyCode)
      .limit(1)
      .maybeSingle();
    if (companyErr && !isMissingTableError(companyErr)) throw new Error(companyErr.message);
    if (!company) throw new Error(`No company found with code ${companyCode}.`);
    resolvedCode = companyCode;
    joinedCompanyName = (company as { company_name?: string | null }).company_name ?? null;
  } else {
    resolvedCode = await generateUniqueCompanyCode();
  }

  const { error } = await supabaseAdmin
    .from("user_roles")
    .upsert({ user_id: userId, role: "introducer" }, { onConflict: "user_id,role" });
  if (error) throw new Error(error.message);

  // Ensure an introducer profile exists so the portal + referral links work.
  const { data: existing } = await supabaseAdmin
    .from("introducers")
    .select("id, active")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) {
    const patch: {
      active?: boolean;
      company_code?: string;
      company_name?: string;
      deleted_at?: null;
    } = {};
    if (existing.active === false) patch.active = true;
    // Clear any bin state so a restored/re-granted introducer is live again.
    patch.deleted_at = null;
    // Apply the chosen company linkage to the existing profile.
    patch.company_code = resolvedCode;
    if (joinedCompanyName) patch.company_name = joinedCompanyName;
    const { error: updErr } = await supabaseAdmin
      .from("introducers")
      .update(patch)
      .eq("id", existing.id);
    if (updErr && !isMissingTableError(updErr)) throw new Error(updErr.message);
  } else {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, email")
      .eq("id", userId)
      .maybeSingle();
    const ownName = profile?.full_name?.trim() || profile?.email?.split("@")[0] || "introducer";
    const base = joinedCompanyName || ownName;
    const root = slugifyName(base) || "introducer";
    let slug = root;
    for (let i = 0; i < 100; i += 1) {
      const candidate = i === 0 ? root : `${root}-${i}`;
      const { data: clash } = await supabaseAdmin
        .from("introducers")
        .select("id")
        .eq("slug", candidate)
        .maybeSingle();
      if (!clash) {
        slug = candidate;
        break;
      }
    }
    const baseRecord = {
      user_id: userId,
      company_name: base,
      slug,
      contact_email: profile?.email ?? null,
    };
    const { error: insErr } = await supabaseAdmin
      .from("introducers")
      .insert({ ...baseRecord, company_code: resolvedCode });
    if (insErr) {
      // company_code column not present yet → create without it.
      if (isMissingTableError(insErr)) {
        await supabaseAdmin.from("introducers").insert(baseRecord);
      } else {
        throw new Error(insErr.message);
      }
    }
  }
  return resolvedCode;
}

export const setIntroducerRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        makeIntroducer: z.boolean(),
        // "new" (default) → auto-generate a fresh 4-digit company code.
        // "join" → link this introducer to an existing company by its code.
        companyMode: z.enum(["new", "join"]).optional(),
        companyCode: z.string().regex(/^\d{4}$/).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: myRoles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (!(myRoles ?? []).some((r) => r.role === "advisor")) throw new Error("Forbidden");

    if (data.makeIntroducer) {
      const companyCode = await grantIntroducerRole(data.userId, data.companyMode, data.companyCode);
      return { ok: true, companyCode };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId)
      .eq("role", "introducer");
    if (error) throw new Error(error.message);
    // Keep their data but deactivate referral links.
    await supabaseAdmin.from("introducers").update({ active: false }).eq("user_id", data.userId);
    return { ok: true };
  });

export const setAdvisorRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ userId: z.string().uuid(), makeAdvisor: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: myRoles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (!(myRoles ?? []).some((r) => r.role === "advisor")) throw new Error("Forbidden");
    // Guard against an advisor locking themselves out of the dashboard.
    if (!data.makeAdvisor && data.userId === context.userId) {
      throw new Error("You can't remove your own advisor access.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.makeAdvisor) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: data.userId, role: "advisor" }, { onConflict: "user_id,role" });
      if (error) throw new Error(error.message);
      // Mint a unique advisor code on grant (no-op if the table isn't there yet).
      try {
        await ensureAdvisorCode(data.userId);
      } catch (e) {
        console.error("ensure advisor code failed", e);
      }
      // Clear any bin state so re-granting via "Make advisor" can't leave them
      // showing in both the active list and the Recently-deleted bin.
      await setAdvisorDeletedAt(data.userId, null);
    } else {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("role", "advisor");
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

type AssignedAdvisor = { id: string; full_name: string | null; email: string | null };
// `customerCount` = how many fact-finds are currently allocated to the advisor
// (via session_advisors). Folded into listAdvisors so the admin Advisors tab can
// show it without a second round-trip; other consumers can ignore it.
type AdvisorWithCode = AssignedAdvisor & { code: string | null; customerCount: number };

// ── Future CRM / case-status layer (placeholder — VIEW only for now) ────────
// The Advisors tab is the foundation for a per-customer case-status / CRM view.
// This enum is the intended status vocabulary; the advisor-customer row below
// already carries a `caseStatus` field (null today) so a future status column
// can be surfaced WITHOUT reshaping the payload or the UI row.
// TODO(crm): persist case status — e.g. add a `case_status` column to
// interview_sessions or a dedicated `session_cases` table — then populate
// `caseStatus` here and render/edit it in the row. No DB changes are made now.
export type CaseStatus =
  | "new"
  | "in_progress"
  | "awaiting_docs"
  | "submitted_to_lender"
  | "completed";

// One row in the per-advisor customer view. Shaped to be CRM-extensible: add
// fields here (e.g. lender, product, next action) without touching callers.
export type AdvisorCustomerRow = {
  sessionId: string;
  customer: { id: string; full_name: string | null; email: string | null; phone: string | null } | null;
  status: string;
  startedAt: string;
  channel: "voice" | "text";
  // Why this customer surfaces for the advisor: an explicit allocation
  // (session_advisors) or a booked appointment that is tied to this session.
  source: "allocated" | "appointment";
  caseStatus: CaseStatus | null; // reserved for the future CRM layer
};

export const listAllSessionsForAdvisor = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const roles = await getRolesForUser(context.userId);
    if (!roles.includes("advisor")) {
      throw new Error("Forbidden");
    }
    const isMainAdmin = roles.includes("admin");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Pull every allocation row up front (used to augment + to scope regular
    // advisors). Degrade gracefully if the table doesn't exist yet.
    let allocations: Array<{ session_id: string; advisor_id: string }> = [];
    {
      const { data, error } = await supabaseAdmin
        .from("session_advisors")
        .select("session_id, advisor_id");
      if (error && !isMissingTableError(error)) throw new Error(error.message);
      allocations = data ?? [];
    }

    // Appointments tie a session to its booked advisor — regular advisors should
    // also see fact-finds where they hold the appointment.
    let appointments: Array<{ session_id: string | null; advisor_id: string }> = [];
    {
      const { data, error } = await supabaseAdmin
        .from("appointments")
        .select("session_id, advisor_id")
        .not("session_id", "is", null);
      if (error && !isMissingTableError(error)) throw new Error(error.message);
      appointments = (data ?? []).filter((a) => a.session_id) as typeof appointments;
    }

    // Decide which session IDs this user may see.
    let sessionsQuery = supabaseAdmin
      .from("interview_sessions")
      .select("*")
      .order("started_at", { ascending: false });

    if (!isMainAdmin) {
      const myAllocated = new Set(
        allocations.filter((a) => a.advisor_id === context.userId).map((a) => a.session_id),
      );
      for (const a of appointments) {
        if (a.advisor_id === context.userId && a.session_id) myAllocated.add(a.session_id);
      }
      const visibleIds = Array.from(myAllocated);
      if (visibleIds.length === 0) return [];
      sessionsQuery = sessionsQuery.in("id", visibleIds);
    }

    const { data: sessions, error } = await sessionsQuery;
    if (error) throw new Error(error.message);

    // Resolve customer + assigned-advisor profile names. Phone is included so
    // the admin can search customers by it (falls back if the column is absent).
    const customerIds = new Set((sessions ?? []).map((s) => s.customer_id));
    const advisorIds = new Set(allocations.map((a) => a.advisor_id));
    const profileIds = Array.from(new Set([...customerIds, ...advisorIds]));
    let profiles: Array<AssignedAdvisor & { phone?: string | null }> = [];
    if (profileIds.length > 0) {
      const withPhone = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email, phone")
        .in("id", profileIds);
      if (withPhone.error) {
        const { data: basic } = await supabaseAdmin
          .from("profiles")
          .select("id, full_name, email")
          .in("id", profileIds);
        profiles = (basic ?? []).map((p) => ({ ...p, phone: null }));
      } else {
        profiles = withPhone.data ?? [];
      }
    }
    const profileMap = new Map(profiles.map((p) => [p.id, p]));

    const allocBySession = new Map<string, AssignedAdvisor[]>();
    for (const a of allocations) {
      const list = allocBySession.get(a.session_id) ?? [];
      const prof = profileMap.get(a.advisor_id);
      list.push(prof ?? { id: a.advisor_id, full_name: null, email: null });
      allocBySession.set(a.session_id, list);
    }

    // Contact tracking (last/next contact) so the overview can rank/sort/filter
    // by the planned next contact. Degrades to empty pre-migration.
    const trackingMap = new Map<
      string,
      { last: string | null; next: string | null; attentionClearedAt: string | null }
    >();
    {
      const sessionIds = (sessions ?? []).map((s) => s.id);
      if (sessionIds.length > 0) {
        const { data: tracking, error: trackErr } = await supabaseAdmin
          .from("session_contact_tracking")
          .select("session_id, last_contacted_at, next_contact_at, session_attention_cleared_at")
          .in("session_id", sessionIds);
        if (trackErr && !isMissingTableError(trackErr)) throw new Error(trackErr.message);
        for (const t of tracking ?? []) {
          trackingMap.set(t.session_id, {
            last: t.last_contacted_at,
            next: t.next_contact_at,
            attentionClearedAt:
              (t as { session_attention_cleared_at?: string | null }).session_attention_cleared_at ??
              null,
          });
        }
      }
    }

    // Open call-back requests, keyed by session, so the customer row highlights
    // as "ready to review" until the advisor resolves it. A call-back counts as
    // ready-to-review while its status is 'new'; an advisor "Spoke to customer"
    // (status → 'closed') or "Mark contacted" clears it, while "Log attempt"
    // keeps it open. Any open call-back surfaces (not just ones assigned to this
    // advisor) and matches either by its session_id OR by the session's owning
    // customer — so direct "/booking" call-backs (which may have no session
    // link) still flag the customer. Degrades to empty pre-migration.
    const callbackBySession = new Map<string, { id: string; window: string | null }>();
    {
      const sessionList = sessions ?? [];
      const sessionIds = sessionList.map((s) => s.id);
      const customerIds = Array.from(
        new Set(sessionList.map((s) => s.customer_id).filter(Boolean) as string[]),
      );
      if (sessionIds.length > 0) {
        // Fetch call-backs tied to a visible session, and (separately) any tied
        // to a visible session's owning customer; merge + dedupe by id.
        const callbackById = new Map<
          string,
          { id: string; session_id: string | null; customer_id: string | null; preferred_window: string | null; status: string | null; created_at: string }
        >();
        {
          const { data, error: cbErr } = await supabaseAdmin
            .from("callback_requests")
            .select("id, session_id, customer_id, preferred_window, status, created_at")
            .in("session_id", sessionIds);
          if (cbErr && !isMissingTableError(cbErr)) throw new Error(cbErr.message);
          for (const c of data ?? []) callbackById.set(c.id, c);
        }
        if (customerIds.length > 0) {
          const { data, error: cbErr2 } = await supabaseAdmin
            .from("callback_requests")
            .select("id, session_id, customer_id, preferred_window, status, created_at")
            .in("customer_id", customerIds);
          if (cbErr2 && !isMissingTableError(cbErr2)) throw new Error(cbErr2.message);
          for (const c of data ?? []) callbackById.set(c.id, c);
        }

        // Map each visible customer to their session ids (newest-first, since
        // `sessions` is ordered by started_at desc).
        const sessionsByCustomer = new Map<string, string[]>();
        for (const s of sessionList) {
          const arr = sessionsByCustomer.get(s.customer_id) ?? [];
          arr.push(s.id);
          sessionsByCustomer.set(s.customer_id, arr);
        }
        const sessionIdSet = new Set(sessionIds);

        // Newest call-back wins for a given session.
        const callbacks = Array.from(callbackById.values()).sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
        for (const c of callbacks) {
          if ((c.status ?? "new") !== "new") continue;
          let targetSessionId: string | null = null;
          if (c.session_id && sessionIdSet.has(c.session_id)) {
            targetSessionId = c.session_id;
          } else if (c.customer_id && sessionsByCustomer.has(c.customer_id)) {
            targetSessionId = sessionsByCustomer.get(c.customer_id)![0];
          }
          if (!targetSessionId || callbackBySession.has(targetSessionId)) continue;

          const tracking = trackingMap.get(targetSessionId);
          const callbackAt = new Date(c.created_at).getTime();
          const clearedAt = tracking?.attentionClearedAt
            ? new Date(tracking.attentionClearedAt).getTime()
            : null;
          const lastContact = tracking?.last ? new Date(tracking.last).getTime() : null;
          if (clearedAt != null && clearedAt >= callbackAt) continue;
          if (lastContact != null && lastContact >= callbackAt) continue;

          callbackBySession.set(targetSessionId, { id: c.id, window: c.preferred_window });
        }
      }
    }

    return (sessions ?? []).map((s) => ({
      ...s,
      customer: profileMap.get(s.customer_id) ?? null,
      assignedAdvisors: allocBySession.get(s.id) ?? [],
      lastContactedAt: trackingMap.get(s.id)?.last ?? null,
      nextContactAt: trackingMap.get(s.id)?.next ?? null,
      callback: callbackBySession.get(s.id) ?? null,
    }));
  });

export const listAdvisors = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const roles = await getRolesForUser(context.userId);
    if (!roles.includes("admin")) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roleRows } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "advisor");
    const advisorIds = Array.from(new Set((roleRows ?? []).map((r) => r.user_id)));
    if (advisorIds.length === 0) return [] as AdvisorWithCode[];

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", advisorIds)
      .order("full_name", { ascending: true });

    // Read existing codes and backfill any advisor that doesn't have one yet.
    const codeMap = new Map<string, string>();
    {
      const { data: codes, error: codeErr } = await supabaseAdmin
        .from("advisor_profiles")
        .select("user_id, code");
      if (codeErr && !isMissingTableError(codeErr)) throw new Error(codeErr.message);
      for (const c of codes ?? []) codeMap.set(c.user_id, c.code);
    }
    for (const id of advisorIds) {
      if (!codeMap.has(id)) {
        try {
          const code = await ensureAdvisorCode(id);
          if (code) codeMap.set(id, code);
        } catch (e) {
          console.error("backfill advisor code failed", e);
        }
      }
    }

    // Count how many fact-finds are allocated to each advisor (one query,
    // grouped client-side). Degrades to zero counts if the join table is
    // missing (pre-migration).
    const countMap = new Map<string, number>();
    {
      const { data: allocs, error: allocErr } = await supabaseAdmin
        .from("session_advisors")
        .select("advisor_id");
      if (allocErr && !isMissingTableError(allocErr)) throw new Error(allocErr.message);
      for (const a of allocs ?? []) {
        countMap.set(a.advisor_id, (countMap.get(a.advisor_id) ?? 0) + 1);
      }
    }

    return (profiles ?? []).map((p) => ({
      ...p,
      code: codeMap.get(p.id) ?? null,
      customerCount: countMap.get(p.id) ?? 0,
    })) as AdvisorWithCode[];
  });

// Admin-only: the customers belonging to ONE advisor — the fact-finds allocated
// to them (session_advisors) plus any session that is tied to an appointment
// they hold. Returns customer profile + status/started/channel per session,
// shaped for the (future) CRM/case-status layer. Degrades gracefully if the
// session_advisors / appointments tables aren't present yet (pre-migration).
export const listAdvisorCustomers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ advisorId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<AdvisorCustomerRow[]> => {
    const roles = await getRolesForUser(context.userId);
    if (!roles.includes("admin")) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1) Sessions explicitly allocated to this advisor.
    const allocatedIds = new Set<string>();
    {
      const { data: alloc, error } = await supabaseAdmin
        .from("session_advisors")
        .select("session_id")
        .eq("advisor_id", data.advisorId);
      if (error && !isMissingTableError(error)) throw new Error(error.message);
      for (const a of alloc ?? []) allocatedIds.add(a.session_id);
    }

    // 2) Sessions where this advisor holds the appointment (session-linked only;
    //    appointment-only leads without a fact-find are intentionally excluded
    //    here since there's no session detail page to link to yet).
    const appointmentIds = new Set<string>();
    {
      const { data: appts, error } = await supabaseAdmin
        .from("appointments")
        .select("session_id")
        .eq("advisor_id", data.advisorId)
        .not("session_id", "is", null);
      if (error && !isMissingTableError(error)) throw new Error(error.message);
      for (const a of appts ?? []) if (a.session_id) appointmentIds.add(a.session_id);
    }

    const allIds = Array.from(new Set([...allocatedIds, ...appointmentIds]));
    if (allIds.length === 0) return [];

    // Fetch the sessions. The `channel` column only exists post-migration —
    // fall back to a channel-less select and default to "voice".
    type SessionRow = {
      id: string;
      customer_id: string;
      status: string;
      started_at: string;
      channel?: string | null;
    };
    let sessions: SessionRow[] = [];
    {
      const withChannel = await supabaseAdmin
        .from("interview_sessions")
        .select("id, customer_id, status, started_at, channel")
        .in("id", allIds)
        .order("started_at", { ascending: false });
      if (withChannel.error) {
        const { data: basic, error } = await supabaseAdmin
          .from("interview_sessions")
          .select("id, customer_id, status, started_at")
          .in("id", allIds)
          .order("started_at", { ascending: false });
        if (error) throw new Error(error.message);
        sessions = (basic ?? []).map((s) => ({ ...s, channel: null }));
      } else {
        // `channel` isn't in the generated types (added by a later migration),
        // so the typed result is a query-error shape — cast through unknown.
        sessions = (withChannel.data ?? []) as unknown as SessionRow[];
      }
    }

    // Resolve customer profiles (phone may be absent pre-migration).
    const customerIds = Array.from(new Set(sessions.map((s) => s.customer_id)));
    let profiles: Array<{ id: string; full_name: string | null; email: string | null; phone: string | null }> = [];
    if (customerIds.length > 0) {
      const withPhone = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email, phone")
        .in("id", customerIds);
      if (withPhone.error) {
        const { data: basic } = await supabaseAdmin
          .from("profiles")
          .select("id, full_name, email")
          .in("id", customerIds);
        profiles = (basic ?? []).map((p) => ({ ...p, phone: null }));
      } else {
        profiles = withPhone.data ?? [];
      }
    }
    const profileMap = new Map(profiles.map((p) => [p.id, p]));

    return sessions.map((s) => ({
      sessionId: s.id,
      customer: profileMap.get(s.customer_id) ?? null,
      status: s.status,
      startedAt: s.started_at,
      channel: s.channel === "text" ? "text" : "voice",
      source: allocatedIds.has(s.id) ? "allocated" : "appointment",
      caseStatus: null,
    }));
  });

export const allocateSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ sessionId: z.string().uuid(), advisorId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const roles = await getRolesForUser(context.userId);
    if (!roles.includes("admin")) throw new Error("Forbidden");

    // Only users that actually hold the advisor role can be allocated.
    const targetRoles = await getRolesForUser(data.advisorId);
    if (!targetRoles.includes("advisor")) {
      throw new Error("That user is not an advisor.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Hard cap: at most MAX_ADVISORS_PER_SESSION advisors per customer file.
    const { data: current, error: currentErr } = await supabaseAdmin
      .from("session_advisors")
      .select("advisor_id")
      .eq("session_id", data.sessionId);
    if (currentErr && !isMissingTableError(currentErr)) throw new Error(currentErr.message);
    const advisorIds = (current ?? []).map((r) => r.advisor_id);
    if (
      advisorIds.length >= MAX_ADVISORS_PER_SESSION &&
      !advisorIds.includes(data.advisorId)
    ) {
      throw new Error(
        `This customer already has the maximum of ${MAX_ADVISORS_PER_SESSION} advisors.`,
      );
    }

    const { error } = await supabaseAdmin
      .from("session_advisors")
      .upsert(
        { session_id: data.sessionId, advisor_id: data.advisorId, assigned_by: context.userId },
        { onConflict: "session_id,advisor_id" },
      );
    if (error && !isMissingTableError(error)) throw new Error(error.message);
    return { ok: true };
  });

export const bulkAllocateSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionIds: z.array(z.string().uuid()).min(1),
        advisorId: z.string().uuid().optional(),
        advisorCode: z.string().min(1).optional(),
      })
      .refine((v) => v.advisorId || v.advisorCode, {
        message: "Provide an advisor or an advisor code.",
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const roles = await getRolesForUser(context.userId);
    if (!roles.includes("admin")) throw new Error("Forbidden");

    // Resolve the advisor (by id, otherwise by code).
    let advisorId = data.advisorId ?? null;
    if (!advisorId && data.advisorCode) {
      advisorId = await resolveAdvisorIdByCode(data.advisorCode);
      if (!advisorId) throw new Error(`No advisor found with code ${data.advisorCode.toUpperCase()}.`);
    }
    if (!advisorId) throw new Error("Provide an advisor or an advisor code.");

    const targetRoles = await getRolesForUser(advisorId);
    if (!targetRoles.includes("advisor")) throw new Error("That user is not an advisor.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Current allocations across the selected sessions (one query).
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("session_advisors")
      .select("session_id, advisor_id")
      .in("session_id", data.sessionIds);
    if (existingErr && !isMissingTableError(existingErr)) throw new Error(existingErr.message);
    const bySession = new Map<string, string[]>();
    for (const row of existing ?? []) {
      bySession.set(row.session_id, [...(bySession.get(row.session_id) ?? []), row.advisor_id]);
    }

    const allocated: string[] = [];
    const skipped: Array<{ sessionId: string; reason: string }> = [];
    const toInsert: Array<{ session_id: string; advisor_id: string; assigned_by: string }> = [];

    for (const sessionId of data.sessionIds) {
      const advisors = bySession.get(sessionId) ?? [];
      if (advisors.includes(advisorId)) {
        allocated.push(sessionId); // already assigned — treat as success
        continue;
      }
      if (advisors.length >= MAX_ADVISORS_PER_SESSION) {
        skipped.push({ sessionId, reason: "max-advisors" });
        continue;
      }
      toInsert.push({ session_id: sessionId, advisor_id: advisorId, assigned_by: context.userId });
      allocated.push(sessionId);
    }

    if (toInsert.length > 0) {
      const { error } = await supabaseAdmin
        .from("session_advisors")
        .upsert(toInsert, { onConflict: "session_id,advisor_id" });
      if (error && !isMissingTableError(error)) throw new Error(error.message);
    }

    return { advisorId, allocatedCount: allocated.length, skipped };
  });

export const unallocateSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ sessionId: z.string().uuid(), advisorId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const roles = await getRolesForUser(context.userId);
    if (!roles.includes("admin")) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("session_advisors")
      .delete()
      .eq("session_id", data.sessionId)
      .eq("advisor_id", data.advisorId);
    if (error && !isMissingTableError(error)) throw new Error(error.message);
    return { ok: true };
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
    // Mirror the note into the contact timeline so the History tab shows
    // notes alongside contact events. Best-effort (pre-migration safe).
    await appendContactLog(data.sessionId, context.userId, "note", data.note);
    await clearSessionAttention(data.sessionId, context.userId, "note_added");
    return { ok: true };
  });

// ── Advisor contact tracking: last/next contact, append-only timeline ───────

export const JOURNEY_MILESTONE_KEYS = [
  "appointment_seen",
  "id_confirmed",
  "aip_completed",
] as const;

export type JourneyMilestoneKey = (typeof JOURNEY_MILESTONE_KEYS)[number];

export const JOURNEY_MILESTONE_LABELS: Record<JourneyMilestoneKey, string> = {
  appointment_seen: "Appointment seen",
  id_confirmed: "ID confirmed",
  aip_completed: "AIP completed",
};

/** Highest completed journey stage label, or "Not started". */
export function journeyStageFromMilestones(
  completed: JourneyMilestoneKey[],
): string {
  const order = JOURNEY_MILESTONE_KEYS;
  for (let i = order.length - 1; i >= 0; i -= 1) {
    if (completed.includes(order[i])) return JOURNEY_MILESTONE_LABELS[order[i]];
  }
  return "Not started";
}

// Clear the "needs attention" / call-back highlight after any advisor profile action.
export async function clearSessionAttention(
  sessionId: string,
  advisorId: string,
  _reason: string,
): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();

    const { error: trackErr } = await supabaseAdmin.from("session_contact_tracking").upsert(
      {
        session_id: sessionId,
        session_attention_cleared_at: now,
        updated_by: advisorId,
        updated_at: now,
      },
      { onConflict: "session_id" },
    );
    if (trackErr && !isMissingTableError(trackErr)) {
      console.error("clearSessionAttention tracking failed", trackErr);
    }

    const { data: callbacks, error: cbErr } = await supabaseAdmin
      .from("callback_requests")
      .select("id")
      .eq("session_id", sessionId)
      .eq("status", "new");
    if (cbErr && !isMissingTableError(cbErr)) {
      console.error("clearSessionAttention callbacks failed", cbErr);
    }
    for (const cb of callbacks ?? []) {
      try {
        await supabaseAdmin.from("advisor_contact_views").upsert(
          {
            advisor_id: advisorId,
            contact_type: "callback",
            contact_id: cb.id,
          },
          { onConflict: "advisor_id,contact_type,contact_id" },
        );
      } catch (e) {
        console.error("clearSessionAttention mark callback opened failed", e);
      }
    }

    const { data: appts, error: apptErr } = await supabaseAdmin
      .from("appointments")
      .select("id")
      .eq("session_id", sessionId);
    if (apptErr && !isMissingTableError(apptErr)) {
      console.error("clearSessionAttention appointments failed", apptErr);
    }
    for (const a of appts ?? []) {
      try {
        await supabaseAdmin.from("advisor_contact_views").upsert(
          {
            advisor_id: advisorId,
            contact_type: "appointment",
            contact_id: a.id,
          },
          { onConflict: "advisor_id,contact_type,contact_id" },
        );
      } catch (e) {
        console.error("clearSessionAttention mark appointment opened failed", e);
      }
    }
  } catch (e) {
    console.error("clearSessionAttention threw", e);
  }
}

// Append a typed entry to the customer contact timeline. Never throws into the
// caller's path — silently degrades if the table isn't present yet.
async function appendContactLog(
  sessionId: string,
  authorId: string | null,
  entryType:
    | "contact"
    | "note"
    | "next_contact_set"
    | "appointment"
    | "callback"
    | "journey_milestone",
  body: string | null,
): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("customer_contact_log")
      .insert({ session_id: sessionId, author_id: authorId, entry_type: entryType, body });
    if (error && !isMissingTableError(error)) throw new Error(error.message);
  } catch (e) {
    console.error("append contact log failed", e);
  }
}

export const getContactTracking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const roles = await getRolesForUser(context.userId);
    if (!roles.includes("advisor")) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("session_contact_tracking")
      .select("last_contacted_at, next_contact_at")
      .eq("session_id", data.sessionId)
      .maybeSingle();
    if (error && !isMissingTableError(error)) throw new Error(error.message);
    return {
      lastContactedAt: row?.last_contacted_at ?? null,
      nextContactAt: row?.next_contact_at ?? null,
    };
  });

// Persist last/next contact. The tracking row write is the primary effect of an
// explicit advisor action, so a genuine failure must surface (NOT be swallowed
// as "missing table") — otherwise the UI shows a false success and nothing
// records. Reads the row back so callers can reflect the persisted value.
async function upsertContactTracking(
  sessionId: string,
  userId: string,
  patch: { last_contacted_at?: string; next_contact_at?: string | null },
): Promise<{ lastContactedAt: string | null; nextContactAt: string | null }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("session_contact_tracking")
    .upsert(
      { session_id: sessionId, updated_by: userId, updated_at: new Date().toISOString(), ...patch },
      { onConflict: "session_id" },
    )
    .select("last_contacted_at, next_contact_at")
    .single();
  if (error) throw new Error(error.message);
  return {
    lastContactedAt: data?.last_contacted_at ?? null,
    nextContactAt: data?.next_contact_at ?? null,
  };
}

// "Last contacted" button: stamps now and logs a contact event.
export const markContacted = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const roles = await getRolesForUser(context.userId);
    if (!roles.includes("advisor")) throw new Error("Forbidden");
    const now = new Date().toISOString();
    const saved = await upsertContactTracking(data.sessionId, context.userId, {
      last_contacted_at: now,
    });
    await appendContactLog(data.sessionId, context.userId, "contact", "Marked as contacted");
    await clearSessionAttention(data.sessionId, context.userId, "marked_contacted");
    return { ok: true, lastContactedAt: saved.lastContactedAt ?? now };
  });

// "Next contact" editable field: records the planned next contact date/time.
export const setNextContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ sessionId: z.string().uuid(), nextContactAt: z.string().datetime().nullable() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const roles = await getRolesForUser(context.userId);
    if (!roles.includes("advisor")) throw new Error("Forbidden");
    await upsertContactTracking(data.sessionId, context.userId, {
      next_contact_at: data.nextContactAt,
    });
    if (data.nextContactAt) {
      const when = new Date(data.nextContactAt).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/London",
      });
      await appendContactLog(data.sessionId, context.userId, "next_contact_set", `Next contact set for ${when}`);
    } else {
      await appendContactLog(data.sessionId, context.userId, "next_contact_set", "Next contact cleared");
    }
    await clearSessionAttention(data.sessionId, context.userId, "next_contact_set");
    return { ok: true };
  });

export type ContactHistoryEntry = {
  id: string;
  type:
    | "contact"
    | "note"
    | "next_contact_set"
    | "appointment"
    | "callback"
    | "sms"
    | "fact_find"
    | "journey_milestone";
  body: string | null;
  occurredAt: string;
};

// Candidate string forms a UK number might have been stored as (sms_messages
// has no session/customer FK, so we match by phone). Covers the raw value, the
// normalised +44 form and the 0-leading national form, with/without spaces.
function ukPhoneVariants(phone: string | null | undefined): string[] {
  const raw = (phone ?? "").trim();
  if (!raw) return [];
  const variants = new Set<string>([raw, raw.replace(/\s+/g, "")]);
  try {
    const normalised = normaliseUkPhone(raw); // +44...
    variants.add(normalised);
    if (normalised.startsWith("+44")) variants.add(`0${normalised.slice(3)}`);
  } catch {
    // ignore unparseable numbers
  }
  return Array.from(variants).filter(Boolean);
}

// A short, human label for an SMS row based on its direction + body content.
function smsHistoryLabel(direction: string, body: string | null): string {
  const text = (body ?? "").toLowerCase();
  if (direction === "inbound") return "SMS received from customer";
  let kind = "message";
  if (text.includes("appointment is confirmed")) kind = "appointment confirmation";
  else if (text.includes("give you a call") || text.includes("call between")) kind = "call-back confirmation";
  else if (text.includes("view your summary") || text.includes("completing your mortgage fact-find")) {
    kind = "fact-find summary";
  }
  return `SMS sent: ${kind}`;
}

// Chronological customer history (newest-first): contact-log entries merged with
// that session's appointments, call-backs, sent/received SMS and fact-find
// milestones. Read-side merge of existing sources — no extra storage. Every
// source is defensive: a missing table / empty result never breaks the list.
export const listContactHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<ContactHistoryEntry[]> => {
    const roles = await getRolesForUser(context.userId);
    if (!roles.includes("advisor")) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const entries: ContactHistoryEntry[] = [];

    // Fact-find milestones + the customer's phone (used to link SMS below).
    let customerPhone: string | null = null;
    {
      const { data: session, error } = await supabaseAdmin
        .from("interview_sessions")
        .select("started_at, submitted_at, customer_id")
        .eq("id", data.sessionId)
        .maybeSingle();
      if (error && !isMissingTableError(error)) throw new Error(error.message);
      if (session) {
        if (session.started_at) {
          entries.push({
            id: `ff-start-${data.sessionId}`,
            type: "fact_find",
            body: "Fact-find started",
            occurredAt: session.started_at,
          });
        }
        const submittedAt = (session as { submitted_at?: string | null }).submitted_at;
        if (submittedAt) {
          entries.push({
            id: `ff-submit-${data.sessionId}`,
            type: "fact_find",
            body: "Fact-find submitted to advisor",
            occurredAt: submittedAt,
          });
        }
        if (session.customer_id) {
          const { data: profile } = await supabaseAdmin
            .from("profiles")
            .select("phone")
            .eq("id", session.customer_id)
            .maybeSingle();
          customerPhone = (profile as { phone?: string | null } | null)?.phone ?? null;
        }
      }
    }

    {
      const { data: logs, error } = await supabaseAdmin
        .from("customer_contact_log")
        .select("id, entry_type, body, occurred_at")
        .eq("session_id", data.sessionId);
      if (error && !isMissingTableError(error)) throw new Error(error.message);
      for (const l of logs ?? []) {
        // Call-backs are merged from callback_requests below; skip any legacy
        // 'callback' contact-log rows so they aren't shown twice in History.
        if (l.entry_type === "callback") continue;
        entries.push({
          id: l.id,
          type: l.entry_type as ContactHistoryEntry["type"],
          body: l.body,
          occurredAt: l.occurred_at,
        });
      }
    }

    const appointmentIds: string[] = [];
    {
      const { data: appts, error } = await supabaseAdmin
        .from("appointments")
        .select("id, starts_at, created_at")
        .eq("session_id", data.sessionId);
      if (error && !isMissingTableError(error)) throw new Error(error.message);
      for (const a of appts ?? []) {
        appointmentIds.push(a.id);
        const when = new Date(a.starts_at).toLocaleString("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/London",
        });
        entries.push({
          id: `appt-${a.id}`,
          type: "appointment",
          body: `Appointment booked for ${when}`,
          occurredAt: a.created_at,
        });
      }
    }

    {
      const { data: callbacks, error } = await supabaseAdmin
        .from("callback_requests")
        .select("id, preferred_window, created_at")
        .eq("session_id", data.sessionId);
      if (error && !isMissingTableError(error)) throw new Error(error.message);
      for (const c of callbacks ?? []) {
        entries.push({
          id: `cb-${c.id}`,
          type: "callback",
          body: `Call-back requested (${c.preferred_window})`,
          occurredAt: c.created_at,
        });
      }
    }

    // SMS: linked either by appointment (booking confirmations) or by the
    // customer's phone number (interview-complete + call-back confirmations).
    {
      try {
        const smsById = new Map<
          string,
          { id: string; direction: string; body: string | null; created_at: string }
        >();
        const collect = (
          rows:
            | Array<{ id: string; direction: string; body: string | null; created_at: string }>
            | null,
        ) => {
          for (const r of rows ?? []) smsById.set(r.id, r);
        };

        if (appointmentIds.length > 0) {
          const { data: byAppt, error } = await supabaseAdmin
            .from("sms_messages")
            .select("id, direction, body, created_at")
            .in("appointment_id", appointmentIds);
          if (error && !isMissingTableError(error)) throw new Error(error.message);
          collect(byAppt);
        }

        const variants = ukPhoneVariants(customerPhone);
        if (variants.length > 0) {
          const byTo = await supabaseAdmin
            .from("sms_messages")
            .select("id, direction, body, created_at")
            .in("to_number", variants);
          if (byTo.error && !isMissingTableError(byTo.error)) throw new Error(byTo.error.message);
          collect(byTo.data);
          const byFrom = await supabaseAdmin
            .from("sms_messages")
            .select("id, direction, body, created_at")
            .in("from_number", variants);
          if (byFrom.error && !isMissingTableError(byFrom.error)) {
            throw new Error(byFrom.error.message);
          }
          collect(byFrom.data);
        }

        for (const s of smsById.values()) {
          entries.push({
            id: `sms-${s.id}`,
            type: "sms",
            body: smsHistoryLabel(s.direction, s.body),
            occurredAt: s.created_at,
          });
        }
      } catch (e) {
        console.error("merge sms history failed", e);
      }
    }

    entries.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
    return entries;
  });

export const getCustomerJourney = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const roles = await getRolesForUser(context.userId);
    const isStaff = roles.includes("advisor") || roles.includes("admin");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: session, error: sessErr } = await supabaseAdmin
      .from("interview_sessions")
      .select("customer_id")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (sessErr) throw new Error(sessErr.message);
    if (!session) throw new Error("Session not found");
    if (!isStaff && session.customer_id !== context.userId) throw new Error("Forbidden");

    const milestones: Array<{
      key: JourneyMilestoneKey;
      label: string;
      completedAt: string | null;
    }> = JOURNEY_MILESTONE_KEYS.map((key) => ({
      key,
      label: JOURNEY_MILESTONE_LABELS[key],
      completedAt: null,
    }));

    const { data: rows, error } = await supabaseAdmin
      .from("customer_journey_milestones")
      .select("milestone_key, completed_at")
      .eq("session_id", data.sessionId);
    if (error && !isMissingTableError(error)) throw new Error(error.message);

    for (const row of rows ?? []) {
      const key = row.milestone_key as JourneyMilestoneKey;
      const idx = milestones.findIndex((m) => m.key === key);
      if (idx >= 0) milestones[idx].completedAt = row.completed_at;
    }

    return { milestones };
  });

export const confirmJourneyMilestone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        milestoneKey: z.enum(JOURNEY_MILESTONE_KEYS),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const roles = await getRolesForUser(context.userId);
    if (!roles.includes("advisor") && !roles.includes("admin")) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: session, error: sessErr } = await supabaseAdmin
      .from("interview_sessions")
      .select("customer_id")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (sessErr) throw new Error(sessErr.message);
    if (!session) throw new Error("Session not found");

    const label = JOURNEY_MILESTONE_LABELS[data.milestoneKey];
    const now = new Date().toISOString();

    const { error: insErr } = await supabaseAdmin.from("customer_journey_milestones").upsert(
      {
        session_id: data.sessionId,
        milestone_key: data.milestoneKey,
        completed_at: now,
        completed_by: context.userId,
      },
      { onConflict: "session_id,milestone_key" },
    );
    if (insErr) {
      if (isMissingTableError(insErr)) {
        throw new Error("Run the customer journey migration first.");
      }
      throw new Error(insErr.message);
    }

    await appendContactLog(
      data.sessionId,
      context.userId,
      "journey_milestone",
      `Journey milestone confirmed: ${label}`,
    );
    await clearSessionAttention(data.sessionId, context.userId, `journey_${data.milestoneKey}`);
    void sendJourneyMilestoneSms(session.customer_id, data.sessionId, data.milestoneKey);

    return { ok: true, completedAt: now };
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

// ============================================================================
// Staff soft-delete (recoverable bin) + invite-link registration
// ============================================================================

// Throws unless the caller holds the main-admin role. Mirrors the admin gate
// used by listAdvisors / allocateSession.
async function requireAdmin(userId: string): Promise<void> {
  const roles = await getRolesForUser(userId);
  if (!roles.includes("admin")) throw new Error("Forbidden");
}

// Stamp deleted_at on an advisor profile, swallowing the error if the column
// isn't present yet (pre-migration graceful degradation).
async function setAdvisorDeletedAt(userId: string, value: string | null): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("advisor_profiles")
    .update({ deleted_at: value })
    .eq("user_id", userId);
  if (error && !isMissingTableError(error)) throw new Error(error.message);
}

// Soft-delete (bin) an advisor: remove their `advisor` role but KEEP the
// advisor_profiles row + code, stamping deleted_at so a restore re-grants the
// same code. Never touches the underlying auth.users account.
export const softDeleteAdvisor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    if (data.userId === context.userId) {
      throw new Error("You can't bin your own advisor access.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Preserve the advisor_profiles row + code before binning.
    try {
      await ensureAdvisorCode(data.userId);
    } catch (e) {
      console.error("ensure advisor code before bin failed", e);
    }
    const { error } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId)
      .eq("role", "advisor");
    if (error) throw new Error(error.message);
    await setAdvisorDeletedAt(data.userId, new Date().toISOString());
    return { ok: true };
  });

// Restore a binned advisor: re-grant the `advisor` role and clear deleted_at.
// The original advisor code is preserved (the advisor_profiles row was kept).
export const restoreAdvisor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: data.userId, role: "advisor" }, { onConflict: "user_id,role" });
    if (error) throw new Error(error.message);
    try {
      await ensureAdvisorCode(data.userId);
    } catch (e) {
      console.error("ensure advisor code on restore failed", e);
    }
    await setAdvisorDeletedAt(data.userId, null);
    return { ok: true };
  });

// Soft-delete (bin) an introducer: remove their `introducer` role, deactivate
// their referral links (active=false) and stamp deleted_at so a binned
// introducer is distinguishable from a merely-inactive one. Data is preserved.
export const softDeleteIntroducer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId)
      .eq("role", "introducer");
    if (error) throw new Error(error.message);
    // Deactivate + stamp deleted_at. Fall back to active-only if the column
    // isn't present yet (pre-migration graceful degradation).
    const withDeleted = await supabaseAdmin
      .from("introducers")
      .update({ active: false, deleted_at: new Date().toISOString() })
      .eq("user_id", data.userId);
    if (withDeleted.error && isMissingTableError(withDeleted.error)) {
      await supabaseAdmin.from("introducers").update({ active: false }).eq("user_id", data.userId);
    } else if (withDeleted.error) {
      throw new Error(withDeleted.error.message);
    }
    return { ok: true };
  });

// Restore a binned introducer: re-grant the `introducer` role, reactivate their
// profile and clear deleted_at. The existing company linkage (company_code) is
// preserved unchanged.
export const restoreIntroducer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: data.userId, role: "introducer" }, { onConflict: "user_id,role" });
    if (error) throw new Error(error.message);
    const withDeleted = await supabaseAdmin
      .from("introducers")
      .update({ active: true, deleted_at: null })
      .eq("user_id", data.userId);
    if (withDeleted.error && isMissingTableError(withDeleted.error)) {
      await supabaseAdmin.from("introducers").update({ active: true }).eq("user_id", data.userId);
    } else if (withDeleted.error) {
      throw new Error(withDeleted.error.message);
    }
    return { ok: true };
  });

type BinnedAdvisor = {
  id: string;
  full_name: string | null;
  email: string | null;
  code: string | null;
  deletedAt: string | null;
};
type BinnedIntroducer = {
  id: string;
  full_name: string | null;
  email: string | null;
  companyCode: string | null;
  companyName: string | null;
  deletedAt: string | null;
};

// List binned (soft-deleted) advisors and introducers for the "Recently
// deleted" panel. Degrades to empty lists if the deleted_at columns don't exist
// yet (pre-migration).
export const listBinnedStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const binnedAdvisors: BinnedAdvisor[] = [];
    const binnedIntroducers: BinnedIntroducer[] = [];

    // Binned advisors: advisor_profiles with deleted_at set.
    const advRes = await supabaseAdmin
      .from("advisor_profiles")
      .select("user_id, code, deleted_at")
      .not("deleted_at", "is", null);
    if (advRes.error && !isMissingTableError(advRes.error)) throw new Error(advRes.error.message);

    // Binned introducers: introducers with deleted_at set.
    const introRes = await supabaseAdmin
      .from("introducers")
      .select("user_id, company_code, company_name, deleted_at")
      .not("deleted_at", "is", null);
    if (introRes.error && !isMissingTableError(introRes.error)) {
      throw new Error(introRes.error.message);
    }

    const advRows = (advRes.data ?? []) as Array<{
      user_id: string;
      code: string | null;
      deleted_at: string | null;
    }>;
    const introRows = (introRes.data ?? []) as Array<{
      user_id: string;
      company_code: string | null;
      company_name: string | null;
      deleted_at: string | null;
    }>;

    const ids = Array.from(
      new Set([...advRows.map((r) => r.user_id), ...introRows.map((r) => r.user_id)]),
    );
    const profileMap = new Map<string, { full_name: string | null; email: string | null }>();
    if (ids.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", ids);
      for (const p of profiles ?? []) {
        profileMap.set(p.id, { full_name: p.full_name, email: p.email });
      }
    }

    for (const r of advRows) {
      const prof = profileMap.get(r.user_id);
      binnedAdvisors.push({
        id: r.user_id,
        full_name: prof?.full_name ?? null,
        email: prof?.email ?? null,
        code: r.code,
        deletedAt: r.deleted_at,
      });
    }
    for (const r of introRows) {
      const prof = profileMap.get(r.user_id);
      binnedIntroducers.push({
        id: r.user_id,
        full_name: prof?.full_name ?? null,
        email: prof?.email ?? null,
        companyCode: r.company_code,
        companyName: r.company_name,
        deletedAt: r.deleted_at,
      });
    }

    return { advisors: binnedAdvisors, introducers: binnedIntroducers };
  });

// Admin creates a shareable staff invite. Returns the invite token; the UI
// builds the registration link (/register?invite=<token>).
export const createStaffInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        role: z.enum(["advisor", "introducer"]),
        email: z.string().email().optional().or(z.literal("")),
        // Introducer-only: create a new company vs join an existing one.
        companyMode: z.enum(["new", "join"]).optional(),
        companyCode: z.string().regex(/^\d{4}$/).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const isJoin = data.role === "introducer" && data.companyMode === "join";
    let companyName: string | null = null;
    if (isJoin) {
      if (!data.companyCode) throw new Error("Enter the 4-digit company code to join.");
      const { data: company, error: companyErr } = await supabaseAdmin
        .from("introducers")
        .select("company_name")
        .eq("company_code", data.companyCode)
        .limit(1)
        .maybeSingle();
      if (companyErr && !isMissingTableError(companyErr)) throw new Error(companyErr.message);
      if (!company) throw new Error(`No company found with code ${data.companyCode}.`);
      companyName = (company as { company_name?: string | null }).company_name ?? null;
    }

    const { data: invite, error } = await supabaseAdmin
      .from("staff_invitations")
      .insert({
        role: data.role,
        email: data.email ? data.email.trim() : null,
        create_company: data.role === "introducer" ? data.companyMode !== "join" : false,
        company_code: isJoin ? data.companyCode : null,
        company_name: companyName,
        created_by: context.userId,
      })
      .select("token, role, email, expires_at")
      .single();
    if (error) {
      if (isMissingTableError(error)) {
        throw new Error("Run the staff_invitations migration (APPLY_NEW_FEATURES.sql) first.");
      }
      throw new Error(error.message);
    }
    return invite;
  });

// List open + recent staff invites for the Manage tab.
export const listStaffInvites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("staff_invitations")
      .select("id, token, role, email, company_code, company_name, create_company, created_at, expires_at, used_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      if (isMissingTableError(error)) return [];
      throw new Error(error.message);
    }
    return data ?? [];
  });

// Revoke (delete) an unused invite.
export const revokeStaffInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("staff_invitations")
      .delete()
      .eq("id", data.id)
      .is("used_at", null);
    if (error && !isMissingTableError(error)) throw new Error(error.message);
    return { ok: true };
  });

type ResolvedInvite = {
  role: "advisor" | "introducer";
  email: string | null;
  companyName: string | null;
  companyCode: string | null;
  createCompany: boolean;
};

// Resolve a staff invite by its secret token. PUBLIC (no auth) — uses the
// service-role client so the unauthenticated /register page can validate the
// token without client RLS. Rejects missing / used / expired invites.
async function resolveInviteByToken(token: string): Promise<{
  id: string;
  resolved: ResolvedInvite;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: invite, error } = await supabaseAdmin
    .from("staff_invitations")
    .select("id, role, email, company_code, company_name, create_company, expires_at, used_at")
    .eq("token", token)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) throw new Error("This invite link is not valid.");
    throw new Error(error.message);
  }
  if (!invite) throw new Error("This invite link is not valid.");
  if (invite.used_at) throw new Error("This invite link has already been used.");
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    throw new Error("This invite link has expired. Ask an admin for a new one.");
  }
  const role = invite.role === "introducer" ? "introducer" : "advisor";
  return {
    id: invite.id,
    resolved: {
      role,
      email: invite.email ?? null,
      companyName: invite.company_name ?? null,
      companyCode: invite.company_code ?? null,
      createCompany: invite.create_company ?? true,
    },
  };
}

export const getStaffInvite = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ token: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<ResolvedInvite> => {
    const { resolved } = await resolveInviteByToken(data.token);
    return resolved;
  });

// Consume an invite after the new user has signed up: grant the proper staff
// role (advisor → code, introducer → create/join company) and mark the invite
// used. PUBLIC (no auth) — the secret token is the authorization, and the user
// id comes from the just-created Supabase account. Idempotency: the used_at
// stamp is written conditionally so a token can only be consumed once.
export const markStaffInviteUsed = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ token: z.string().uuid(), userId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { id, resolved } = await resolveInviteByToken(data.token);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Claim the invite first (atomic): only one caller may flip used_at.
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from("staff_invitations")
      .update({ used_at: new Date().toISOString(), used_by: data.userId })
      .eq("id", id)
      .is("used_at", null)
      .select("id")
      .maybeSingle();
    if (claimErr) throw new Error(claimErr.message);
    if (!claimed) throw new Error("This invite link has already been used.");

    try {
      if (resolved.role === "advisor") {
        const { error } = await supabaseAdmin
          .from("user_roles")
          .upsert({ user_id: data.userId, role: "advisor" }, { onConflict: "user_id,role" });
        if (error) throw new Error(error.message);
        await ensureAdvisorCode(data.userId);
        await setAdvisorDeletedAt(data.userId, null);
      } else {
        await grantIntroducerRole(
          data.userId,
          resolved.createCompany ? "new" : "join",
          resolved.companyCode ?? undefined,
        );
      }
    } catch (e) {
      // Roll back the claim so the invite can be retried.
      await supabaseAdmin
        .from("staff_invitations")
        .update({ used_at: null, used_by: null })
        .eq("id", id);
      throw e;
    }

    return { ok: true, role: resolved.role };
  });
