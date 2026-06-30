// Server-only contextual small talk for the spoken interview.
// Generates a brief, optional, LLM-written aside that references what the
// customer has already shared, woven in just before the next scripted question.
// Controlled by a single env toggle so it can be reverted to scripted behaviour.

import { openAIFetch, OPENAI_CHAT_MODEL } from "@/lib/openai.server";
import type { AnswersMap } from "@/lib/interview-script";

/**
 * Feature toggle. ON by default; set VOICE_SMALLTALK_LLM=false to restore the
 * exact scripted behaviour (no extra OpenAI calls).
 */
export function smalltalkEnabled(): boolean {
  return process.env.VOICE_SMALLTALK_LLM !== "false";
}

// Aside topics. Each trigger moment maps to exactly ONE topic so the aside
// always comments on what the customer JUST shared, never an earlier subject.
type AsideTopic = "location" | "family" | "job";

// The order topics are reached in the interview. Used to tell the generator
// which topics have already been used so it never repeats an earlier one.
const TOPIC_ORDER: AsideTopic[] = ["location", "family", "job"];

const TOPIC_LABEL: Record<AsideTopic, string> = {
  location: "where they live",
  family: "their children/dependants",
  job: "their job or employer",
};

// Field keys that, once just answered, are natural and non-sensitive moments for
// an aside, mapped to the single topic each one is about. Deliberately excludes
// income, essentials, credit and adverse credit.
const TRIGGER_TOPIC: Record<string, AsideTopic> = {
  home_confirm: "location",
  dependants: "family",
  job_title: "job",
};

export function isAsideMoment(fieldKey: string | undefined): boolean {
  return Boolean(fieldKey && fieldKey in TRIGGER_TOPIC);
}

const SYSTEM_PROMPT =
  "You are Susan, a warm UK mortgage adviser. You will be given ONE topic and the customer's detail " +
  "for it. Optionally add ONE short, friendly, natural aside (max ~12-15 words) that comments ONLY on " +
  "that one topic. Never mention any other topic. Keep it brief and professional, never intrusive, " +
  "never ask a question, and do not ask or repeat the next question. British tone. It is fine — and " +
  "often best — to add nothing. Reply with ONLY the aside text, or an empty line to add nothing.";

/** The single relevant detail for the current topic, or "" if we don't have it. */
function topicDetail(topic: AsideTopic, answers: AnswersMap): string {
  switch (topic) {
    case "location":
      return answers["personal:home_address"] || answers["personal:home_postcode"] || "";
    case "family":
      return answers["personal:dependants"] || "";
    case "job":
      return [
        answers["employment:job_title"],
        answers["employment:employer"],
        answers["employment:employment_status"],
      ]
        .filter(Boolean)
        .join(", ");
    default:
      return "";
  }
}

function sanitizeAside(text: string): string {
  let t = text.trim().replace(/^["'`]+|["'`]+$/g, "").trim();
  if (!t) return "";
  // An aside must never pose a question — that would derail the fact-find.
  if (t.includes("?")) return "";
  // Hard length cap so a single aside can never drag the interview out.
  if (t.split(/\s+/).length > 18) return "";
  return t;
}

/**
 * Returns a short aside (or "" to add nothing). Never throws: any error, timeout
 * or slow response falls back to no aside so the interview never stalls.
 */
export async function generateAside(opts: {
  answers: AnswersMap;
  justAnsweredKey: string;
  firstName?: string;
  timeoutMs?: number;
}): Promise<string> {
  const topic = TRIGGER_TOPIC[opts.justAnsweredKey];
  if (!topic) return "";

  const detail = topicDetail(topic, opts.answers);
  if (!detail.trim()) return "";

  // Topics covered before this one — the model must not bring them up again.
  const usedTopics = TOPIC_ORDER.slice(0, TOPIC_ORDER.indexOf(topic))
    .map((t) => TOPIC_LABEL[t]);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 2500);
  try {
    const res = await openAIFetch("/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_CHAT_MODEL,
        max_tokens: 40,
        temperature: 0.7,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content:
              `Topic to comment on: ${TOPIC_LABEL[topic]}.\n` +
              `Their detail: ${detail}\n` +
              (usedTopics.length
                ? `Do NOT mention any of these (already covered earlier): ${usedTopics.join("; ")}.\n`
                : "") +
              `Optional one-line aside about this topic only, before the next question` +
              `${opts.firstName ? ` (you may use their first name, ${opts.firstName})` : ""}:`,
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return "";
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return sanitizeAside(json.choices?.[0]?.message?.content ?? "");
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}
