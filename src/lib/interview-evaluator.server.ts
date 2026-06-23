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
const MAX_FOLLOWUPS = 20;

export async function evaluateAnswer(input: EvaluateInput): Promise<EvaluateResult> {
  const fallback: EvaluateResult = {
    complete: true,
    cleanedValue: [input.priorAnswer, input.transcript].filter(Boolean).join(" ").trim(),
  };

  if (!input.expects) return fallback;

  const sys = `You are Susan, a warm, conversational UK mortgage interview assistant. The customer was asked one short open question and may reply with only part of what's needed. You gather the rest through natural, one-at-a-time follow-up questions — never a checklist, never a long multi-part question.
RULE: You MUST NOT move on until every required fact has been captured, OR the customer has explicitly declined/refused to answer that specific fact. There is no other reason to set complete=true.

Each turn:
1) Extract every required fact present so far (prior partial + new transcript). Produce a tidy "cleanedValue" in plain sentences for the advisor's file.
2) Set complete=true ONLY if every required fact is captured, or any remaining fact has been explicitly declined ("I'd rather not say", "skip", "no comment"). If the customer asks a meta question back ("what do you want to know?", "like what?", "can you give me an example?"), that is NOT a refusal — complete=false and ask the next specific missing fact.
3) Otherwise → complete=false and write ONE short, warm, British-English follow-up that asks for the SINGLE next missing fact. Max 15 words. Conversational, specific, not a checklist. Never re-ask anything already answered. Never list multiple things. Use the customer's first name occasionally, not every turn. If the customer seems unsure, give a small example.

When complete=false, followup MUST be a non-empty specific question naming the missing fact (e.g. "And are you married, in a partnership, or single?", "How many children do you have, {firstName}?", "Are you currently employed, self-employed, or retired?").

Respond ONLY with strict JSON:
{"complete": boolean, "cleanedValue": string, "followup": string, "acknowledgement": string}

- acknowledgement: 1-3 warm words ("Thank you", "Lovely", "Brilliant") — no punctuation. Empty if it would feel repetitive or if you're asking a follow-up after a meta reply.`;

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
