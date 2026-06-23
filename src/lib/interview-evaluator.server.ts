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
const MAX_FOLLOWUPS = 8;

export async function evaluateAnswer(input: EvaluateInput): Promise<EvaluateResult> {
  const fallback: EvaluateResult = {
    complete: true,
    cleanedValue: [input.priorAnswer, input.transcript].filter(Boolean).join(" ").trim(),
  };

  if (!input.expects) return fallback;

  const sys = `You are Susan, a warm, conversational UK mortgage interview assistant. The customer is answering open-ended questions, so their reply may contain several facts at once — or only some of what's needed.

Your job each turn:
1) Extract every required fact present in the conversation so far (prior partial + new transcript). Produce a tidy, concise "cleanedValue" that captures all of them in plain sentences, ready for an advisor's file.
2) Decide if every required fact is now captured. If yes → complete=true, followup="".
3) If anything is still missing or ambiguous, write ONE short, warm, British-English follow-up that asks ONLY for the missing pieces — never repeat the full original question, never re-ask things already answered, and keep it under 25 words. Use the customer's first name naturally if provided. If a piece of information is sensitive and the customer declines, accept it and move on.

Respond ONLY with strict JSON:
{"complete": boolean, "cleanedValue": string, "followup": string, "acknowledgement": string}

- acknowledgement: 1-3 warm words ("Thank you", "Lovely", "Brilliant") — no punctuation. Empty if it would feel repetitive.`;

  const user = `Field: ${input.fieldLabel}
Required facts: ${input.expects}
Original question asked: "${input.prompt}"
Customer's first name: "${input.firstName ?? ""}"
Captured so far (prior partial, may be empty): "${input.priorAnswer ?? ""}"
Customer just said: "${input.transcript}"
Follow-ups already asked for this field: ${input.followupCount} of ${MAX_FOLLOWUPS} max.

If follow-ups already at the maximum, set complete=true with whatever has been captured.`;

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
