import { z } from "zod";
import { isValidUkMobile, normaliseUkPhone } from "@/lib/phone";

export const calculatorLeadInput = z.object({
  slug: z.string().min(1).max(40),
  customerName: z.string().trim().min(2).max(100),
  customerEmail: z.string().trim().email(),
  customerPhone: z.string().trim().min(7).max(20),
  consentGiven: z.literal(true, {
    errorMap: () => ({ message: "GDPR consent is required before we can contact you." }),
  }),
  calculator: z
    .object({
      propertyPrice: z.number().positive().optional(),
      deposit: z.number().nonnegative().optional(),
      loanAmount: z.number().positive().optional(),
      termYears: z.number().int().min(1).max(40).optional(),
      ratePct: z.number().positive().max(20).optional(),
      ltvPct: z.number().min(0).max(100).optional(),
      monthlyPayment: z.number().positive().optional(),
    })
    .optional(),
});

export type CalculatorLeadInput = z.infer<typeof calculatorLeadInput>;

export type CalculatorLeadResult = {
  ok: true;
  leadId: string;
  message: string;
};

function formatGbp(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `£${Math.round(value).toLocaleString("en-GB")}`;
}

function buildLeadNotes(
  consentAt: string,
  calculator: CalculatorLeadInput["calculator"],
): string {
  const lines = [
    `GDPR consent recorded: ${consentAt}`,
    "Source: MortgageEasy calculator (external provider embed)",
  ];
  if (calculator) {
    const parts = [
      calculator.propertyPrice != null ? `property ${formatGbp(calculator.propertyPrice)}` : null,
      calculator.deposit != null ? `deposit ${formatGbp(calculator.deposit)}` : null,
      calculator.loanAmount != null ? `loan ${formatGbp(calculator.loanAmount)}` : null,
      calculator.termYears != null ? `${calculator.termYears}yr term` : null,
      calculator.ltvPct != null ? `LTV ${calculator.ltvPct.toFixed(1)}%` : null,
      calculator.ratePct != null ? `@ ${calculator.ratePct}%` : null,
      calculator.monthlyPayment != null
        ? `→ ${formatGbp(calculator.monthlyPayment)}/mo (illustrative)`
        : null,
    ].filter(Boolean);
    if (parts.length) lines.push(`Calculator: ${parts.join(", ")}`);
  }
  lines.push("Callback requested — no account created.");
  return lines.join("\n");
}

/** Simple in-process rate limit keyed by slug + phone (resets on server restart). */
const recentSubmissions = new Map<string, number[]>();
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX_PER_WINDOW = 8;

function assertRateLimit(key: string): void {
  const now = Date.now();
  const hits = (recentSubmissions.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX_PER_WINDOW) {
    throw new Error("Too many requests. Please try again later.");
  }
  hits.push(now);
  recentSubmissions.set(key, hits);
}

export async function captureIntroducerCalculatorLead(
  raw: unknown,
): Promise<CalculatorLeadResult> {
  const data = calculatorLeadInput.parse(raw);
  const phone = normaliseUkPhone(data.customerPhone);
  if (!isValidUkMobile(phone)) {
    throw new Error("Please enter a valid UK mobile number.");
  }

  assertRateLimit(`${data.slug}:${phone}`);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: introducer, error: introErr } = await supabaseAdmin
    .from("introducers")
    .select("id, company_name, slug")
    .eq("slug", data.slug)
    .eq("active", true)
    .maybeSingle();
  if (introErr) throw new Error(introErr.message);
  if (!introducer) throw new Error("This referral link is not valid or has expired.");

  const oneHourAgo = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { data: recentLead } = await supabaseAdmin
    .from("introducer_leads")
    .select("id")
    .eq("introducer_id", introducer.id)
    .eq("customer_phone", phone)
    .gte("created_at", oneHourAgo)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recentLead) {
    return {
      ok: true,
      leadId: recentLead.id,
      message: "We already have your details — an advisor will be in touch shortly.",
    };
  }

  const consentAt = new Date().toISOString();
  const notes = buildLeadNotes(consentAt, data.calculator);

  const { data: lead, error: leadErr } = await supabaseAdmin
    .from("introducer_leads")
    .insert({
      introducer_id: introducer.id,
      lead_source: "web",
      channel: "manual",
      customer_name: data.customerName,
      customer_phone: phone,
      customer_email: data.customerEmail,
      notes,
      status: "new",
    })
    .select("id")
    .single();
  if (leadErr) throw new Error(leadErr.message);

  console.info(
    `[calculator-lead] ${lead.id} for introducer ${introducer.slug} (${introducer.company_name})`,
  );

  return {
    ok: true,
    leadId: lead.id,
    message: "Thank you — a MortgageEasy advisor will call you back shortly.",
  };
}
