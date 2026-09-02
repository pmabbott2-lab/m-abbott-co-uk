import { chatCompletion } from "@/lib/openai.server";

export function normalizeLenderKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function computeActionableFromDate(productExpiryDate: string, leadTimeDays: number): string {
  const expiry = new Date(`${productExpiryDate}T12:00:00`);
  expiry.setDate(expiry.getDate() - leadTimeDays);
  return expiry.toISOString().slice(0, 10);
}

/** Research typical UK remortgage product booking window for a lender (days before ERC/product end). */
export async function researchLenderLeadTimeDays(lenderName: string): Promise<{
  leadTimeDays: number;
  notes: string;
}> {
  const fallback = { leadTimeDays: 90, notes: "Default 90-day lead time — verify with lender." };

  try {
    const text = await chatCompletion({
      messages: [
        {
          role: "system",
          content:
            "You advise UK mortgage brokers on lender remortgage booking windows. " +
            "Reply with JSON only: {\"lead_time_days\": number, \"notes\": string}. " +
            "lead_time_days = typical days before product/ERC end when customers can book a new rate. " +
            "Use conservative UK market norms (often 90–180 days). If unsure, use 90 and say verify with lender.",
        },
        { role: "user", content: `Lender: ${lenderName}` },
      ],
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim()) as {
      lead_time_days?: number;
      notes?: string;
    };
    const days = Number(parsed.lead_time_days);
    if (!Number.isFinite(days) || days < 0 || days > 365) return fallback;
    return {
      leadTimeDays: Math.round(days),
      notes: parsed.notes?.trim() || fallback.notes,
    };
  } catch {
    return fallback;
  }
}
