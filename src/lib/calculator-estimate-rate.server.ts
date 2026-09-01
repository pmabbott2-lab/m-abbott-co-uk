import { z } from "zod";
import { chatCompletion, OPENAI_CHAT_MODEL } from "@/lib/openai.server";

export const estimateRateInput = z.object({
  ltv: z.number().min(0).max(100),
  loanAmount: z.number().positive().max(50_000_000),
  termYears: z.number().int().min(1).max(40),
});

export type EstimateRateInput = z.infer<typeof estimateRateInput>;

export type EstimateRateResult = {
  ok: true;
  ratePct: number;
  disclaimer: string;
  source: "openai" | "static";
};

const AI_DISCLAIMER =
  "Illustrative average market rates generated using AI — not advice, model only. " +
  "Your actual rate depends on your circumstances, credit profile, and lender criteria.";

const STATIC_DISCLAIMER =
  "Illustrative average market rates by LTV band — not advice. " +
  "Your actual rate depends on your circumstances, credit profile, and lender criteria.";

/** Static UK mortgage rate bands by LTV (fallback when OpenAI is unavailable). */
export function staticRateForLtv(ltv: number): { ratePct: number; disclaimer: string } {
  let ratePct: number;
  if (ltv <= 60) ratePct = 4.15;
  else if (ltv <= 75) ratePct = 4.45;
  else if (ltv <= 85) ratePct = 4.85;
  else if (ltv <= 90) ratePct = 5.35;
  else ratePct = 5.85;

  return { ratePct, disclaimer: STATIC_DISCLAIMER };
}

export async function estimateCalculatorRate(raw: unknown): Promise<EstimateRateResult> {
  const { ltv, loanAmount, termYears } = estimateRateInput.parse(raw);
  const fallback = staticRateForLtv(ltv);

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { ok: true, ...fallback, source: "static" };
  }

  try {
    const content = await chatCompletion({
      model: OPENAI_CHAT_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You estimate illustrative average UK residential mortgage interest rates (repayment, fixed-rate style) " +
            "for consumer calculators. Return JSON only: {\"ratePct\": number, \"disclaimer\": string}. " +
            "ratePct is the annual percentage rate (e.g. 4.75). disclaimer must state figures are illustrative " +
            "AI-generated averages, not advice or a quote. Use current UK market context for the LTV band.",
        },
        {
          role: "user",
          content: JSON.stringify({
            ltvPercent: Math.round(ltv * 10) / 10,
            loanAmountGbp: Math.round(loanAmount),
            termYears,
            note: "Return a single illustrative average market rate for this LTV band.",
          }),
        },
      ],
    });

    const parsed = JSON.parse(content) as { ratePct?: number; disclaimer?: string };
    const ratePct =
      typeof parsed.ratePct === "number" && parsed.ratePct > 0 && parsed.ratePct <= 15
        ? Math.round(parsed.ratePct * 100) / 100
        : fallback.ratePct;
    const disclaimer =
      typeof parsed.disclaimer === "string" && parsed.disclaimer.trim().length > 20
        ? parsed.disclaimer.trim()
        : AI_DISCLAIMER;

    return { ok: true, ratePct, disclaimer, source: "openai" };
  } catch (err) {
    console.warn("[calculator-estimate-rate] OpenAI fallback:", err);
    return { ok: true, ...fallback, source: "static" };
  }
}
