import { chatCompletion } from "@/lib/openai.server";

export type QuestionClass =
  | "scripted"
  | "general"
  | "current"
  | "regulated"
  | "clarify"
  | "hold"
  | "continue";

const CURRENT_HINT =
  /\b(rate|rates|apr|product|criteria|opening hours|phone number|contact|currently|today|now|latest|halifax|nationwide|barclays|santander|hsbc|natwest|lloyds|bank of england|fca|hmrc|gov\.uk|base rate)\b/i;

const QUESTION_HINT =
  /\?|\b(do you know|what time|what(?:'s| is| are|s the)|how much|how (?:are|is|do|does|long|come)|can you (?:tell|check|look|say)|could you|is there|are there|tell me|who is|where is|when is|why )\b/i;

const ADVICE_HINT =
  /\b(should i|shall i|best (?:for me|mortgage)|suitable|afford(?:able)?|recommend|advise|can i borrow|how much can i (?:borrow|get)|eligibility for me)\b/i;

const CLARIFY_HINT = /^(um+|uh+|erm+|sorry|what|pardon|repeat|say that again)\.?$/i;

const HOLD_HINT =
  /\b((is it |is that )?(ok|okay|alright|all right) (to|if i) ask|can i ask|could i ask|may i ask|have (you )?got a (minute|second|question)|i (just )?have a question|i(?:'d| would) like to ask|ask (you )?something|ask a question|before we (start|begin))\b/i;

const CONTINUE_HINT =
  /^(no|nope|nah|no thanks|no thank you|that's (all|it|fine|ok|okay)|thats (all|it|fine)|nothing|none|carry on|continue|let'?s (start|go|begin|continue)|i'?m (good|fine|ready)|go ahead|no let's start|no, let's start)\.?$/i;

const YES_HOLD_HINT = /^(yes|yeah|yep|yup|i have|i do|go on|yes, i have a question)\.?$/i;

export function classifyUtterance(
  text: string,
  opts?: { holding?: boolean; openFloor?: boolean; awaitingContinue?: boolean },
): QuestionClass {
  const t = text.trim();
  if (!t) return "scripted";
  if (CLARIFY_HINT.test(t)) return "clarify";
  const floor = Boolean(opts?.holding || opts?.openFloor || opts?.awaitingContinue);
  if (CONTINUE_HINT.test(t) && floor) return "continue";
  if (HOLD_HINT.test(t) || ((opts?.openFloor || opts?.holding) && YES_HOLD_HINT.test(t))) return "hold";
  if (ADVICE_HINT.test(t)) return "regulated";
  const asks = QUESTION_HINT.test(t);
  if (asks && CURRENT_HINT.test(t)) return "current";
  if (asks) return "general";
  // Mid-journey after an aside: a non-question is usually the fact-find answer.
  if (opts?.awaitingContinue && !opts?.holding && !opts?.openFloor) return "scripted";
  if (opts?.holding || opts?.openFloor) return asks || t.split(/\s+/).length >= 4 ? "general" : "hold";
  return "scripted";
}

export async function classifyTurn(
  text: string,
  currentQuestion: string,
  opts?: { holding?: boolean; openFloor?: boolean; awaitingContinue?: boolean },
): Promise<QuestionClass> {
  const fallback = classifyUtterance(text, opts);
  if (!process.env.OPENAI_API_KEY || !text.trim()) return fallback;

  try {
    const raw = await chatCompletion({
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You classify one spoken turn in a UK mortgage fact-find. " +
            "Reply with exactly one word: answering, question, current, regulated, clarify, hold, or continue. " +
            "answering = they are giving the fact asked for (a postcode, a date, yes/no to the fact-find). " +
            "question = they asked a real aside (time, how this works). " +
            "current = they want a live rate, product, or official figure. " +
            "regulated = they want personal advice or a recommendation. " +
            "clarify = they did not hear or want the question repeated. " +
            "hold = they are asking permission to ask, or saying they have a question, but have not asked it yet. " +
            "continue = they have no more questions and want to carry on with the fact-find.",
        },
        {
          role: "user",
          content:
            `Current fact-find question: ${currentQuestion}\n` +
            `Waiting for an aside (not the fact-find yet): ${opts?.holding || opts?.openFloor ? "yes" : "no"}\n` +
            `Just answered an aside, may carry on or answer the fact: ${opts?.awaitingContinue ? "yes" : "no"}\n` +
            `Customer said: ${text}`,
        },
      ],
    });
    const word = raw.trim().toLowerCase().split(/\s+/)[0] ?? "";
    if (word === "answering") return opts?.holding || opts?.openFloor ? fallback : "scripted";
    if (word === "question") return "general";
    if (word === "current") return "current";
    if (word === "regulated") return "regulated";
    if (word === "clarify") return "clarify";
    if (word === "hold") return "hold";
    if (word === "continue") return "continue";
  } catch {
    /* regex fallback */
  }
  return fallback;
}
