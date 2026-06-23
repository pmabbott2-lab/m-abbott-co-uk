// Server-only OpenAI-driven evaluator for interview answers.
// It uses OpenAI for tidying/natural wording, but a deterministic fact gate
// decides whether the interview is allowed to move on.
import { openAIFetch } from "./openai.server";

export interface EvaluateInput {
  fieldKey: string;
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

type MissingFact = {
  id: string;
  followup: (firstName?: string) => string;
};

const MODEL = "gpt-4o-mini";
const MAX_FOLLOWUPS = 20;
const NUMBER_WORDS = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty";

function hasExplicitDecline(text: string): boolean {
  return /\b(i'?d\s+rather\s+not\s+say|prefer\s+not\s+to\s+say|skip\s+that|skip\s+it|no\s+comment|don'?t\s+want\s+to\s+answer)\b/i.test(text);
}

function hasFullName(text: string): boolean {
  const words = text
    .replace(/[^\p{L}'\s-]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1);
  return words.length >= 2;
}

function hasDob(text: string): boolean {
  return (
    /\b\d{1,2}[\/.-]\d{1,2}[\/.-](?:\d{2}|\d{4})\b/.test(text) ||
    new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\s+(?:19|20)\\d{2}\\b`, "i").test(text)
  );
}

function hasStreetAddress(text: string): boolean {
  // Flat/apartment number
  if (/\b(?:flat|apartment|apt)\s*[\w-]+\b/i.test(text)) return true;
  // House number + street
  if (/\b\d+[a-z]?\s+[\p{L}'-]+(?:\s+[\p{L}'-]+){0,5}\s+(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|close|cl|crescent|cres|court|ct|way|place|pl|terrace|gardens|grove|view|mews|park|rise|walk|row|square|sq|hill)\b/iu.test(text)) return true;
  // Named property suffix (cottage, house, bungalow, farm, manor, lodge, barn, mill, hall, villa)
  if (/\b[\p{L}'-]+(?:\s+[\p{L}'-]+){0,3}\s+(?:cottage|house|bungalow|farm|manor|lodge|barn|mill|hall|villa|farmhouse)\b/iu.test(text)) return true;
  // Explicit house/property name phrasing
  if (/\b(?:house|property|home)\s+(?:is\s+)?(?:called|named)\s+[\p{L}'-]+/iu.test(text)) return true;
  if (/\b(?:it'?s\s+called|called)\s+[\p{L}'-]+(?:\s+[\p{L}'-]+){0,3}\b/iu.test(text)) return true;
  // "The Willows", "The Old Rectory" - definite article + capitalised name(s)
  if (/\bThe\s+[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){0,3}\b/u.test(text)) return true;
  return false;
}

function hasPostcode(text: string): boolean {
  return /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(text);
}

function hasDuration(text: string): boolean {
  return new RegExp(`\\b(?:\\d+|${NUMBER_WORDS})\\s+(?:day|week|month|year|yr|yrs|mth|months)s?\\b|\\bsince\\s+(?:19|20)\\d{2}\\b|\\b(?:just moved|all my life|whole life)\\b`, "i").test(text);
}

function hasRelationshipStatus(text: string): boolean {
  return /\b(single|married|wife|husband|spouse|partner|civil\s+partner(?:ship)?|cohabiting|living\s+with\s+(?:my\s+)?partner|divorced|separated|widowed)\b/i.test(text);
}

function hasNoDependants(text: string): boolean {
  return /\b(?:no|none|nope|zero|0|without)\s+(?:children|kids|dependants|dependents)\b/i.test(text) || /\bno\s+dependants\b/i.test(text);
}

function hasDependants(text: string): boolean {
  return /\b(child|children|kid|kids|son|daughter|dependant|dependent)\b/i.test(text) && !hasNoDependants(text);
}

function hasDependantCount(text: string): boolean {
  return new RegExp(`\\b(?:\\d+|${NUMBER_WORDS}|a)\\s+(?:child|children|kid|kids|son|sons|daughter|daughters|dependants|dependents)\\b`, "i").test(text) ||
    /\b(?:son|daughter)\b/i.test(text);
}

function hasDependantAges(text: string): boolean {
  return new RegExp(`\\b(?:aged?|ages?)\\s*(?:\\d+|${NUMBER_WORDS})\\b|\\b(?:\\d+|${NUMBER_WORDS})\\s*(?:years?|yrs?)\\s+old\\b|\\bkids?\\s+(?:are\\s+)?(?:\\d+|${NUMBER_WORDS})\\b`, "i").test(text);
}

function isRetiredOrUnemployed(text: string): boolean {
  return /\b(retired|pension|unemployed|not\s+working|out\s+of\s+work)\b/i.test(text);
}

function hasEmploymentStatus(text: string): boolean {
  return /\b(employed|self[-\s]?employed|contractor|retired|unemployed|not\s+working|part[-\s]?time|full[-\s]?time|director)\b/i.test(text) || /\bi\s+work\s+(?:as|for|at)\b/i.test(text);
}

function hasEmployerOrBusiness(text: string): boolean {
  return /\b(?:work\s+(?:for|at)|employed\s+by|business\s+(?:is|name)|company\s+(?:is|name)|trade\s+as)\s+[\p{L}\d&.' -]{2,}/iu.test(text) || /\b(?:ltd|limited|plc|llp|nhs)\b/i.test(text);
}

function hasJobTitle(text: string): boolean {
  return /\b(?:as\s+a|as\s+an|job\s+title\s+is|role\s+is|i'?m\s+a|i\s+am\s+a)\s+[\p{L}' -]{3,}/iu.test(text) || /\b(manager|teacher|nurse|doctor|engineer|driver|developer|builder|consultant|assistant|director|accountant|administrator|analyst|chef|electrician|plumber)\b/i.test(text);
}

function hasMoneyAmount(text: string): boolean {
  return /£\s?\d[\d,]*(?:\.\d+)?|\b\d{2,3}\s?k\b/i.test(text);
}

function hasIncome(text: string): boolean {
  return hasMoneyAmount(text) && /\b(salary|income|earn|earning|wage|gross|annual|year|pa|per\s+annum|month)\b/i.test(text);
}

function hasMonthlyEssentials(text: string): boolean {
  return hasMoneyAmount(text) && /\b(month|monthly|bills|food|travel|essentials|outgoings|spend|costs?)\b/i.test(text);
}

function hasCreditPayments(text: string): boolean {
  return /\b(no|none|nope|zero|0)\s+(?:credit|loans?|debts?|cards?|finance)\b/i.test(text) ||
    (/\b(credit\s*card|loan|debt|finance|car\s+payment|hire\s+purchase)\b/i.test(text) && (/\b(no|none|zero|0)\b/i.test(text) || hasMoneyAmount(text)));
}

function hasAdverseCredit(text: string): boolean {
  return /\b(no|none|never)\s+(?:adverse|missed\s+payments?|defaults?|ccjs?|bankrupt(?:cy|cies)?)\b/i.test(text) ||
    /\b(adverse\s+credit|missed\s+payments?|defaults?|ccjs?|bankrupt(?:cy|cies)?)\b/i.test(text);
}

function hasMortgagePurpose(text: string): boolean {
  return /\b(first[-\s]?time|purchase|buy|buying|next\s+home|home\s+mover|remortgage|buy[-\s]?to[-\s]?let|btl)\b/i.test(text);
}

function hasPropertyPrice(text: string): boolean {
  return hasMoneyAmount(text) && /\b(price|value|worth|property|house|flat|purchase)\b/i.test(text);
}

function hasDeposit(text: string): boolean {
  return /\b(deposit)\b/i.test(text) && (hasMoneyAmount(text) || /\b\d{1,2}\s?%\b/.test(text));
}

function hasMortgageTerm(text: string): boolean {
  return /\b(?:term\s*(?:is|of)?\s*)?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|twenty\s+five|thirty|thirty\s+five|forty)\s+years?\b/i.test(text);
}

function hasPropertyType(text: string): boolean {
  return /\b(flat|apartment|terraced|terrace|semi[-\s]?detached|detached|bungalow|maisonette|house)\b/i.test(text);
}

function missingFacts(input: EvaluateInput, text: string): MissingFact[] {
  switch (input.fieldKey) {
    case "full_name":
      return hasFullName(text) ? [] : [{ id: "surname", followup: () => "Could you tell me your surname too?" }];
    case "date_of_birth":
      return hasDob(text) ? [] : [{ id: "dob", followup: () => "What is your full date of birth, including the year?" }];
    case "home": {
      const missing: MissingFact[] = [];
      if (!hasStreetAddress(text)) missing.push({ id: "address", followup: () => "What’s your full address, including house number and street?" });
      if (!hasPostcode(text)) missing.push({ id: "postcode", followup: () => "What’s the postcode for that address?" });
      if (!hasDuration(text)) missing.push({ id: "duration", followup: () => "How long have you lived there?" });
      return missing;
    }
    case "family": {
      const missing: MissingFact[] = [];
      if (!hasRelationshipStatus(text)) missing.push({ id: "relationship", followup: () => "Are you single, married, cohabiting, divorced, separated or widowed?" });
      if (!hasNoDependants(text) && !hasDependants(text)) missing.push({ id: "dependants", followup: (name) => `Do you have any children or other dependants${name ? `, ${name}` : ""}?` });
      if (hasDependants(text)) {
        if (!hasDependantCount(text)) missing.push({ id: "dependant_count", followup: () => "How many children or dependants do you have?" });
        if (!hasDependantAges(text)) missing.push({ id: "dependant_ages", followup: () => "What ages are your children or dependants?" });
      }
      return missing;
    }
    case "work": {
      const missing: MissingFact[] = [];
      if (!hasEmploymentStatus(text)) missing.push({ id: "status", followup: () => "Are you employed, self-employed, retired, unemployed, or something else?" });
      if (isRetiredOrUnemployed(text)) {
        if (!hasIncome(text) && !/\b(no|none|zero|0)\s+(?:income|earnings?)\b/i.test(text)) missing.push({ id: "income", followup: () => "Do you currently have any regular income, and how much per year?" });
        return missing;
      }
      if (!hasEmployerOrBusiness(text)) missing.push({ id: "employer", followup: () => "Who is your employer, or what is your business called?" });
      if (!hasJobTitle(text)) missing.push({ id: "role", followup: () => "What is your job title or role?" });
      if (!hasDuration(text)) missing.push({ id: "time", followup: () => "How long have you been in that role?" });
      if (!hasIncome(text)) missing.push({ id: "income", followup: () => "What is your annual gross income before tax?" });
      return missing;
    }
    case "retirement_income":
      return hasIncome(text) ? [] : [{ id: "pension_income", followup: () => "What is your total annual pension income before tax?" }];
    case "outgoings_credit": {
      const missing: MissingFact[] = [];
      if (!hasMonthlyEssentials(text)) missing.push({ id: "essentials", followup: () => "Roughly how much are your essential monthly outgoings?" });
      if (!hasCreditPayments(text)) missing.push({ id: "credit", followup: () => "Do you have any credit, loans or card payments each month?" });
      if (!hasAdverseCredit(text)) missing.push({ id: "adverse", followup: () => "Any missed payments, defaults, CCJs or bankruptcy in the last six years?" });
      return missing;
    }
    case "mortgage_need": {
      const missing: MissingFact[] = [];
      if (!hasMortgagePurpose(text)) missing.push({ id: "purpose", followup: () => "Is this a purchase, remortgage, next home, or buy-to-let?" });
      if (!hasPropertyPrice(text)) missing.push({ id: "price", followup: () => "What is the property price or current value?" });
      if (!hasDeposit(text)) missing.push({ id: "deposit", followup: () => "How much deposit do you have?" });
      if (!hasMortgageTerm(text)) missing.push({ id: "term", followup: () => "What mortgage term would you like, in years?" });
      if (!hasPropertyType(text)) missing.push({ id: "type", followup: () => "What type of property is it — flat, terraced, semi or detached?" });
      return missing;
    }
    default:
      return [];
  }
}

export async function evaluateAnswer(input: EvaluateInput): Promise<EvaluateResult> {
  const combinedText = [input.priorAnswer, input.transcript].filter(Boolean).join(" ").trim();
  const explicitlyDeclined = hasExplicitDecline(input.transcript);
  const hardMissing = missingFacts(input, combinedText);
  const fallback: EvaluateResult = {
    complete: hardMissing.length === 0 || explicitlyDeclined,
    cleanedValue: combinedText,
    followup: hardMissing[0]?.followup(input.firstName),
  };

  if (!input.expects) return fallback;

  const sys = `You are Susan, a warm, conversational UK mortgage interview assistant. The customer was asked one short open question and may reply with only part of what's needed. You gather the rest through natural, one-at-a-time follow-up questions — never a checklist, never a long multi-part question.
RULE: You MUST NOT move on until every required fact has been captured, OR the customer has explicitly declined/refused to answer that specific fact. There is no other reason to set complete=true.

Each turn:
1) Extract every required fact present so far (prior partial + new transcript). Produce a tidy "cleanedValue" in plain sentences for the advisor's file.
2) Set complete=true ONLY if every required fact is captured, or any remaining fact has been explicitly declined ("I'd rather not say", "skip", "no comment"). If the customer asks a meta question back ("what do you want to know?", "like what?", "can you give me an example?"), that is NOT a refusal — complete=false and ask the next specific missing fact.
3) Otherwise → complete=false and write ONE short, warm, British-English follow-up that asks for the SINGLE next missing fact. Max 15 words. Conversational, specific, not a checklist. Never re-ask anything already answered. Never list multiple things. Use the customer's first name occasionally, not every turn. If the customer seems unsure, give a small example.

Respond ONLY with strict JSON:
{"complete": boolean, "cleanedValue": string, "followup": string, "acknowledgement": string}

- acknowledgement: 1-3 warm words ("Thank you", "Lovely", "Brilliant") — no punctuation. Empty if it would feel repetitive or if you're asking a follow-up after a meta reply.`;

  const user = `Field: ${input.fieldLabel}
Field key: ${input.fieldKey}
Required facts: ${input.expects}
Original question asked: "${input.prompt}"
Customer's first name: "${input.firstName ?? ""}"
Captured so far (prior partial, may be empty): "${input.priorAnswer ?? ""}"
Customer just said: "${input.transcript}"
Follow-ups already asked for this field: ${input.followupCount}.

Missing facts the deterministic gate still requires: ${hardMissing.map((f) => f.id).join(", ") || "none"}.
Remember: do not set complete=true unless every required fact is captured or explicitly declined. A meta reply like "what do you need to know?" is NOT a refusal — ask the next specific missing fact.`;

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
    const cleanedValue = (parsed.cleanedValue ?? fallback.cleanedValue).trim();
    const missingAfterAi = missingFacts(input, [combinedText, cleanedValue].filter(Boolean).join(" "));
    const complete = explicitlyDeclined || missingAfterAi.length === 0;
    return {
      complete,
      cleanedValue,
      followup: complete ? undefined : missingAfterAi[0]?.followup(input.firstName) || (parsed.followup ?? "").trim() || fallback.followup,
      acknowledgement: (parsed.acknowledgement ?? "").trim() || undefined,
    };
  } catch (e) {
    console.error("evaluateAnswer failed", e);
    return fallback;
  }
}

export { MAX_FOLLOWUPS };