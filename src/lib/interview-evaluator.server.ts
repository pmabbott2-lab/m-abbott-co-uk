// Server-only OpenAI-driven evaluator for interview answers.
// Decides whether the customer's answer satisfies the fact we need to capture,
// and either returns a cleaned value to store, or a natural follow-up question.
import { openAIFetch } from "./openai.server";

export interface EvaluateInput {
  fieldLabel: string;
  expects: string;
  prompt: string;
  transcript: string;
  /** Prior partial answer for this same field, if any (from earlier follow-ups). */
  priorAnswer?: string;
  /** Number of follow-ups already asked for this field. */
  followupCount: number;
  /** Customer's first name, for personalised follow-ups. */
  firstName?: string;
}

export interface EvaluateResult {
  complete: boolean;
  cleanedValue: string;
  followup?: string;
  acknowledgement?: string;
}

const MODEL = "gpt-4o-mini";
const MAX_FOLLOWUPS = 2;

export async function evaluateAnswer(input: EvaluateInput): Promise<EvaluateResult> {
  const fallback: EvaluateResult = {
    complete: true,
    cleanedValue: [input.priorAnswer, input.transcript].filter(Boolean).join(" ").trim(),
  };

  if (!input.expects) return fallback;

  const sys = `You are Susan, a warm UK mortgage interview assistant. For each customer answer, decide whether the required fact has been captured. If yes, return a tidy cleaned value. If not, write ONE short, friendly British-English follow-up question to fill the gap. Never repeat the original question verbatim. Keep follow-ups under 18 words. If the customer is clearly unwilling to answer or already gave a usable value, accept it.

Respond ONLY with strict JSON of shape:
{"complete": boolean, "cleanedValue": string, "followup": string, "acknowledgement": string}

- cleanedValue: concise canonical form of what was captured so far (combine prior + new). Empty string if nothing usable.
- followup: empty string when complete=true; otherwise the single clarifying question to ask next.
- acknowledgement: a brief warm acknowledgement (e.g. "Thank you", "Lovely") — 1-3 words, no punctuation.`;

  const user = `Field: ${input.fieldLabel}
We need: ${input.expects}
Original question asked: "${input.prompt}"
Prior partial answer (may be empty): "${input.priorAnswer ?? ""}"
Customer just said: "${input.transcript}"
Follow-ups already asked for this field: ${input.followupCount} of ${MAX_FOLLOWUPS} max.

If follow-ups already at the maximum, set complete=true and use whatever we have as cleanedValue.`;

  try {
    const res = await openAIFetch("/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) {
      console.error("evaluateAnswer non-ok", res.status, await res.text().catch(() => ""));
      return fallback;
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as Partial<EvaluateResult>;
    const complete = !!parsed.complete || input.followupCount >= MAX_FOLLOWUPS;
    return {
      complete,
      cleanedValue: (parsed.cleanedValue ?? fallback.cleanedValue).trim(),
      followup: complete ? undefined : (parsed.followup ?? "").trim() || undefined,
      acknowledgement: (parsed.acknowledgement ?? "").trim() || undefined,
    };
  } catch (e) {
    console.error("evaluateAnswer failed", e);
    return fallback;
  }
}

export { MAX_FOLLOWUPS };
