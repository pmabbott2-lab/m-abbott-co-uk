// Server-only OpenAI-driven evaluator for interview answers.
// OpenAI tidies the notes, but this deterministic fact gate decides whether
// the interview is allowed to move on.

import { hasCompleteDob, hasPartialDob, stripCapturedMarkers, parseDob, formatDobText } from "@/lib/dob-parse";

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

const MAX_FOLLOWUPS = 3;
const NUMBER_WORDS = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty";
const TENS_WORDS = "twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety";
const MONEY_WORDS = `(?:${NUMBER_WORDS}|${TENS_WORDS}|hundred|thousand|million|and|a)`;
const NUMBER_WORD_TO_DIGIT: Record<string, string> = {
  zero: "0",
  oh: "0",
  o: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

function hasExplicitDecline(text: string): boolean {
  return /\b(i'?d\s+rather\s+not\s+say|prefer\s+not\s+to\s+say|skip\s+that|skip\s+it|no\s+comment|don'?t\s+want\s+to\s+answer)\b/i.test(text);
}

function isMetaReply(text: string): boolean {
  return /\b(what\s+do\s+you\s+(?:want|need)\s+to\s+know|what\s+do\s+you\s+need|like\s+what|what\s+do\s+you\s+mean|can\s+you\s+(?:explain|clarify)|which\s+details|what\s+sort\s+of)\b/i.test(text);
}

function isUnsureOnly(text: string): boolean {
  return /^(?:\s*)(?:i\s+)?(?:don'?t\s+know|do\s+not\s+know|not\s+sure|unsure|can'?t\s+remember|no\s+idea)(?:\s*)$/i.test(text.trim());
}

function normaliseShortReply(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\d\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasStandaloneNo(text: string): boolean {
  const value = normaliseShortReply(text);
  return /^(?:no|none|nope|zero|0|not\s+any|nothing|i\s+don'?t|we\s+don'?t|i\s+do\s+not|we\s+do\s+not|no\s+i\s+don'?t|no\s+we\s+don'?t|no\s+i\s+do\s+not|no\s+we\s+do\s+not)$/.test(value);
}

function hasStandaloneYes(text: string): boolean {
  const value = normaliseShortReply(text);
  return /^(?:yes|yeah|yep|yup|correct|that'?s\s+right|i\s+do|we\s+do|i\s+have|we\s+have|yes\s+i\s+do|yes\s+we\s+do|yes\s+i\s+have|yes\s+we\s+have|yeah\s+i\s+do|yeah\s+we\s+do|yeah\s+i\s+have|yeah\s+we\s+have)$/.test(value);
}

function hasAnyNumber(text: string): boolean {
  return new RegExp(`\\b(?:\\d+|${NUMBER_WORDS}|${TENS_WORDS})\\b`, "i").test(text);
}

function isShortMeaningfulAnswer(text: string): boolean {
  if (!text.trim() || isMetaReply(text) || hasExplicitDecline(text) || isUnsureOnly(text)) return false;
  const words = text
    .replace(/[^\p{L}\d&.'\s-]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.length >= 1 && words.length <= 8;
}

function hasUsableDetailAnswer(text: string): boolean {
  if (!text.trim() || isMetaReply(text) || hasExplicitDecline(text) || isUnsureOnly(text)) return false;
  return /[\p{L}\d]/u.test(text);
}

function hasCapturedFact(text: string, id: string): boolean {
  return new RegExp(`\\bCaptured\\s+${id.replace(/_/g, "[_\\s-]")}\\s*:`, "i").test(text);
}

function hasCapturedNo(text: string, id: string): boolean {
  return new RegExp(`\\bCaptured\\s+${id.replace(/_/g, "[_\\s-]")}\\s*:\\s*(?:no|none|zero|0)\\b`, "i").test(text);
}

function hasCapturedYes(text: string, id: string): boolean {
  return new RegExp(`\\bCaptured\\s+${id.replace(/_/g, "[_\\s-]")}\\s*:\\s*(?:yes|true|has|one|two|three|four|five|\\d)\\b`, "i").test(text);
}

function hasFullName(text: string): boolean {
  const words = text
    .replace(/[^\p{L}'\s-]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1);
  return words.length >= 2;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const DAY_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
  thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16,
  seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20,
  "twenty first": 21, "twenty second": 22, "twenty third": 23,
  "twenty fourth": 24, "twenty fifth": 25, "twenty sixth": 26,
  "twenty seventh": 27, "twenty eighth": 28, "twenty ninth": 29,
  thirtieth: 30, "thirty first": 31,
};

const YEAR_WORDS: Record<string, number> = {
  zero: 0, oh: 0, o: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

function normaliseTwoDigitDobYear(year: number): number {
  if (year >= 100) return year;
  const currentYear = new Date().getUTCFullYear();
  const candidate = 2000 + year;
  return candidate > currentYear ? candidate - 100 : candidate;
}

function isValidDob(day: number, month: number, year: number): boolean {
  const currentYear = new Date().getUTCFullYear();
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return false;
  if (year < 1900 || year > currentYear || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function wordsUnderHundred(tokens: string[]): number | null {
  if (tokens.length === 0) return 0;
  let total = 0;
  for (const token of tokens) {
    const n = YEAR_WORDS[token];
    if (n == null || token === "hundred" || token === "thousand") return null;
    total += n;
  }
  return total >= 0 && total < 100 ? total : null;
}

function parseYearWords(phrase: string): number | null {
  const value = phrase
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/\band\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return null;
  if (/^\d{2,4}$/.test(value)) return normaliseTwoDigitDobYear(Number(value));

  const tokens = value.split(" ").filter(Boolean);
  if (tokens.some((token) => !(token in YEAR_WORDS) && token !== "hundred" && token !== "thousand")) return null;
  if (tokens[0] === "nineteen" && tokens.length >= 2) {
    const tail = wordsUnderHundred(tokens.slice(1));
    if (tail != null) return 1900 + tail;
  }
  if (tokens[0] === "twenty" && tokens.length >= 2 && tokens[1] !== "hundred") {
    const tail = wordsUnderHundred(tokens.slice(1));
    if (tail != null) return 2000 + tail;
  }
  if (tokens[0] === "two" && tokens[1] === "thousand") {
    const tail = wordsUnderHundred(tokens.slice(2));
    return 2000 + (tail ?? 0);
  }
  if (tokens.length <= 2 && YEAR_WORDS[tokens[0]] >= 30) {
    const tail = wordsUnderHundred(tokens);
    if (tail != null) return 1900 + tail;
  }
  return null;
}

function parseDayWords(phrase: string): number | null {
  const value = phrase.toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ").trim();
  return DAY_WORDS[value] ?? null;
}

function hasStreetAddress(text: string): boolean {
  // Flat/apartment number
  if (/\b(?:flat|apartment|apt|unit)\s*[\w-]+\b/i.test(text)) return true;
  // House number + street
  if (/\b\d+[a-z]?\s+[\p{L}'-]+(?:\s+[\p{L}'-]+){0,5}\s+(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|close|cl|crescent|cres|court|ct|way|place|pl|terrace|gardens|grove|view|mews|park|rise|walk|row|square|sq|hill)\b/iu.test(text)) return true;
  // Named property suffix (Rose Cottage, The Old Rectory, Oak Lodge, etc.)
  if (/\b[\p{L}'-]+(?:\s+[\p{L}'-]+){0,3}\s+(?:cottage|house|bungalow|farm|manor|lodge|barn|mill|hall|villa|farmhouse|rectory|grange|orchard|willows|beeches|oaks)\b/iu.test(text)) return true;
  // Explicit house/property name phrasing
  if (/\b(?:house|property|home|house\s+name|property\s+name)\s+(?:is\s+)?(?:called|named|is)\s+[\p{L}'-]+/iu.test(text)) return true;
  if (/\b(?:it'?s\s+called|called)\s+[\p{L}'-]+(?:\s+[\p{L}'-]+){0,3}\b/iu.test(text)) return true;
  // "The Willows", "The Old Rectory" - definite article + capitalised name(s)
  if (/\bThe\s+[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){0,3}\b/u.test(text)) return true;
  return false;
}

function hasPlausibleHouseNameAnswer(text: string): boolean {
  if (!isShortMeaningfulAnswer(text)) return false;
  if (hasPostcode(text) && !hasStreetAddress(text)) return false;
  if (hasStreetAddress(text)) return true;
  if (/\b(?:house\s+name|property\s+name|house|property|home|called|named)\b/i.test(text)) return true;
  const words = text
    .replace(/[^\p{L}'\s-]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  // Do not treat a broad location as the house/property name.
  return !/\b(nottingham|london|birmingham|manchester|leeds|sheffield|derby|leicester|bristol|liverpool|york|cardiff|edinburgh|glasgow)\b/i.test(words.join(" "));
}

function hasPostcode(text: string): boolean {
  if (/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(text)) return true;
  const spokenNormalised = text
    .toLowerCase()
    .replace(new RegExp(`\\b(${Object.keys(NUMBER_WORD_TO_DIGIT).join("|")})\\b`, "gi"), (m) => NUMBER_WORD_TO_DIGIT[m.toLowerCase()] ?? m)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return /[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}/.test(spokenNormalised);
}

function hasDuration(text: string): boolean {
  return new RegExp(`\\b(?:\\d+|${NUMBER_WORDS})\\s+(?:day|week|month|year|yr|yrs|mth|months)s?\\b|\\bsince\\s+(?:19|20)\\d{2}\\b|\\b(?:just moved|all my life|whole life)\\b`, "i").test(text);
}

function hasRelationshipStatus(text: string): boolean {
  return /\b(single|married|wife|husband|spouse|partner|civil\s+partner(?:ship)?|cohabiting|living\s+with\s+(?:my\s+)?(?:partner|girlfriend|boyfriend|fianc[eé]e?)|girlfriend|boyfriend|fianc[eé]e?|engaged|divorced|separated|widowed)\b/i.test(text);
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

function hasStandaloneAgeAnswer(text: string): boolean {
  if (!isShortMeaningfulAnswer(text)) return false;
  return hasAnyNumber(text) || /\b(baby|newborn|toddler|teen(?:ager)?)\b/i.test(text);
}

function isRetiredOrUnemployed(text: string): boolean {
  return /\b(retired|pension|unemployed|not\s+working|out\s+of\s+work)\b/i.test(text);
}

function hasEmploymentStatus(text: string): boolean {
  return /\b(employed|self[-\s]?employed|contractor|retired|unemployed|not\s+working|out\s+of\s+work|part[-\s]?time|full[-\s]?time|director|permanent|temporary|zero[-\s]?hours)\b/i.test(text) || /\bi\s+work\s+(?:as|for|at)\b/i.test(text);
}

function hasEmployerOrBusiness(text: string): boolean {
  return /\b(?:work\s+(?:for|at)|employed\s+by|employer\s+(?:is|name|called)|business\s+(?:is|name|called)|company\s+(?:is|name|called)|trade\s+as)\s+[\p{L}\d&.' -]{2,}/iu.test(text) || /\b(?:ltd|limited|plc|llp|nhs)\b/i.test(text);
}

function hasJobTitle(text: string): boolean {
  return /\b(?:as\s+a|as\s+an|job\s+title\s+is|role\s+is|i'?m\s+a|i\s+am\s+a)\s+[\p{L}' -]{3,}/iu.test(text) || /\b(manager|teacher|nurse|doctor|engineer|driver|developer|builder|consultant|assistant|director|accountant|administrator|analyst|chef|electrician|plumber)\b/i.test(text);
}

function hasMoneyAmount(text: string): boolean {
  return /£\s?\d[\d,]*(?:\.\d+)?|\b\d{2,3}\s?k\b/i.test(text);
}

function hasMoneyLike(text: string): boolean {
  return hasMoneyAmount(text) ||
    /\b\d[\d,]{2,}(?:\.\d+)?\b/.test(text) ||
    /\b\d+(?:\.\d+)?\s*(?:pounds?|quid|grand|thousand|k)\b/i.test(text) ||
    new RegExp(`\\b${MONEY_WORDS}(?:[\\s-]+${MONEY_WORDS}){0,7}\\s+(?:pounds?|quid|grand|thousand|million|k)\\b`, "i").test(text) ||
    new RegExp(`\\b(?:${NUMBER_WORDS}|${TENS_WORDS})[\\s-]+hundred(?:\\s+and)?(?:[\\s-]+(?:${NUMBER_WORDS}|${TENS_WORDS}))?\\b`, "i").test(text);
}

function hasPercentLike(text: string): boolean {
  return /\b\d{1,2}\s?(?:%|percent|per\s+cent)\b/i.test(text) ||
    new RegExp(`\\b(?:${NUMBER_WORDS}|${TENS_WORDS})(?:[\\s-]+(?:${NUMBER_WORDS}))?\\s+(?:percent|per\\s+cent)\\b`, "i").test(text);
}

function hasIncome(text: string): boolean {
  return hasMoneyLike(text) && /\b(salary|income|earn|earning|wage|gross|annual|year|pa|per\s+annum|month)\b/i.test(text);
}

function hasMonthlyEssentials(text: string): boolean {
  return hasMoneyLike(text) && /\b(month|monthly|bills|food|travel|essentials|outgoings|spend|costs?)\b/i.test(text);
}

function hasCreditPayments(text: string): boolean {
  return /\b(no|none|nope|zero|0)\s+(?:credit|loans?|debts?|cards?|finance)\b/i.test(text) ||
    (/\b(credit\s*card|loan|debt|finance|car\s+payment|hire\s+purchase)\b/i.test(text) && (/\b(no|none|zero|0)\b/i.test(text) || hasMoneyLike(text)));
}

function hasNoCreditPayments(text: string): boolean {
  return /\b(?:no|none|nope|zero|0|not\s+any|nothing)\s+(?:credit|loans?|debts?|cards?|card\s+payments?|finance|car\s+payments?|hire\s+purchase)\b/i.test(text) ||
    /\b(?:credit|loans?|debts?|cards?|card\s+payments?|finance|car\s+payments?|hire\s+purchase)\s*[:=-]?\s*(?:no|none|nope|zero|0|nothing)\b/i.test(text);
}

function hasCreditSubject(text: string): boolean {
  return /\b(credit\s*cards?|cards?|loans?|debts?|finance|car\s+payments?|hire\s+purchase|hp|overdraft)\b/i.test(text);
}

function hasCreditPaymentAmount(text: string): boolean {
  return hasMoneyLike(text) && /\b(credit\s*cards?|cards?|loans?|debts?|finance|car\s+payments?|hire\s+purchase|hp|overdraft|month|monthly|payment|repayments?|pay)\b/i.test(text);
}

function hasAdverseCredit(text: string): boolean {
  return /\b(no|none|never)\s+(?:adverse|missed\s+payments?|defaults?|ccjs?|bankrupt(?:cy|cies)?)\b/i.test(text) ||
    /\b(adverse\s+credit|missed\s+payments?|defaults?|ccjs?|bankrupt(?:cy|cies)?)\b/i.test(text);
}

function hasNoAdverseCredit(text: string): boolean {
  return /\b(?:no|none|never)\s+(?:adverse\s+credit|missed\s+payments?|defaults?|ccjs?|bankrupt(?:cy|cies)?|bankruptcy|arrears)\b/i.test(text) ||
    /\b(?:adverse\s+credit|missed\s+payments?|defaults?|ccjs?|bankrupt(?:cy|cies)?|bankruptcy|arrears)\s*[:=-]?\s*(?:no|none|never)\b/i.test(text);
}

function hasAdverseSubject(text: string): boolean {
  return /\b(adverse\s+credit|missed\s+payments?|defaults?|ccjs?|county\s+court\s+judg(?:e)?ments?|bankrupt(?:cy|cies)?|bankruptcy|arrears|iva)\b/i.test(text);
}

function hasMortgagePurpose(text: string): boolean {
  return /\b(first[-\s]?time|purchase|buy|buying|next\s+home|home\s+mover|remortgage|buy[-\s]?to[-\s]?let|btl)\b/i.test(text);
}

function hasPropertyPrice(text: string): boolean {
  return hasMoneyLike(text) && /\b(price|value|worth|property|house|flat|purchase)\b/i.test(text);
}

function hasDeposit(text: string): boolean {
  return /\b(deposit)\b/i.test(text) && (hasMoneyLike(text) || hasPercentLike(text));
}

function hasMortgageTerm(text: string): boolean {
  return /\b(?:term\s*(?:is|of)?\s*)?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|twenty\s+five|thirty|thirty\s+five|forty)\s+years?\b/i.test(text);
}

function hasPropertyType(text: string): boolean {
  return /\b(flat|apartment|terraced|terrace|semi|semi[-\s]?detached|detached|bungalow|maisonette|house)\b/i.test(text);
}

function missingFactsFor(input: EvaluateInput, text: string, latest = "", target?: string): MissingFact[] {
  const targetDeclined = Boolean(target) && hasExplicitDecline(latest);
  const targetAnsweredShortly = (id: string) => target === id && isShortMeaningfulAnswer(latest);
  const targetNo = (id: string) => target === id && hasStandaloneNo(latest);
  const targetYes = (id: string) => target === id && hasStandaloneYes(latest);
  const targetNumber = (id: string) => target === id && hasAnyNumber(latest);
  const captured = (id: string) => hasCapturedFact(text, id);

  switch (input.fieldKey) {
    case "full_name":
      return hasFullName(text) ? [] : [{ id: "surname", followup: () => "Could you tell me your surname too?" }];
    case "date_of_birth":
      return hasCompleteDob(text)
        ? []
        : [{
            id: "dob",
            followup: () =>
              "Could you say the day, month and year — for example, 15 March 1980? Or tap your date below.",
          }];
    case "home_postcode":
      return hasPostcode(text) || targetDeclined
        ? []
        : [{ id: "postcode", followup: () => "Could you say the full postcode, including the letters and numbers?" }];
    case "home_house":
    case "home_confirm":
    case "home_duration":
      // Single-shot fields — accept whatever the customer says and move on.
      return [];
    case "family": {
      const missing: MissingFact[] = [];
      const relationshipKnown = captured("relationship") || hasRelationshipStatus(text) || targetAnsweredShortly("relationship") || (targetDeclined && target === "relationship");
      const noDependantsKnown = hasCapturedNo(text, "dependants") || hasNoDependants(text) || targetNo("dependants") || (targetDeclined && target === "dependants");
      const hasDependantsKnown = hasCapturedYes(text, "dependants") || hasDependants(text) || targetYes("dependants") || targetNumber("dependants");
      if (!relationshipKnown) missing.push({ id: "relationship", followup: () => "Are you single, married, cohabiting, divorced, separated or widowed?" });
      if (!noDependantsKnown && !hasDependantsKnown) missing.push({ id: "dependants", followup: (name) => `Do you have any children or other dependants${name ? `, ${name}` : ""}?` });
      if (hasDependantsKnown && !noDependantsKnown) {
        if (!captured("dependant_count") && !hasDependantCount(text) && !targetNumber("dependants") && !targetNumber("dependant_count") && !(targetDeclined && target === "dependant_count")) missing.push({ id: "dependant_count", followup: () => "How many children or dependants do you have?" });
        if (!captured("dependant_ages") && !hasDependantAges(text) && !(target === "dependant_ages" && hasStandaloneAgeAnswer(latest)) && !(targetDeclined && target === "dependant_ages")) missing.push({ id: "dependant_ages", followup: () => "What ages are your children or dependants?" });
      }
      return missing;
    }
    case "marital_status":
      // Tappable choice (with spoken "Other") — accept whatever is given.
      return [];
    case "dependants":
      // Built by the client-side dependants wizard and submitted as a summary.
      return [];
    case "employment_status":
      return hasEmploymentStatus(text) || isShortMeaningfulAnswer(latest) || targetDeclined
        ? []
        : [{ id: "status", followup: () => "Are you employed, self-employed, a contractor, or retired?" }];
    case "work": {
      const missing: MissingFact[] = [];
      if (isRetiredOrUnemployed(text)) return missing;
      if (!captured("employer") && !hasEmployerOrBusiness(text) && !targetAnsweredShortly("employer") && !(targetDeclined && target === "employer")) missing.push({ id: "employer", followup: () => "Who is your employer, or what is your business called?" });
      if (!captured("role") && !hasJobTitle(text) && !targetAnsweredShortly("role") && !(targetDeclined && target === "role")) missing.push({ id: "role", followup: () => "What is your job title or role?" });
      return missing;
    }
    case "employer":
    case "business_name":
    case "job_title":
      // Asked as separate single-shot questions — accept the answer and move on.
      return [];
    case "income":
      return hasMoneyLike(text) || (target === "income" && hasMoneyLike(latest)) || targetDeclined
        ? []
        : [{ id: "income", followup: () => "Roughly what's your annual income before tax, in pounds?" }];
    case "retirement_income":
      return hasMoneyLike(text) || (target === "pension_income" && hasMoneyLike(latest)) || (targetDeclined && target === "pension_income")
        ? []
        : [{ id: "pension_income", followup: () => "Roughly what's your total annual pension income, in pounds?" }];
    case "monthly_essentials":
      // Retired — no longer asked in the scripted flow.
      return [];
    case "ongoing_loans":
    case "ongoing_credit":
      // Accept 'none' or any detail in one go to avoid repetitive probing.
      return [];
    case "credit_commitments":
      // Built by the client-side wizard and submitted as a complete summary.
      return [];
    case "adverse_credit":
      // A yes/no is enough; the adviser can follow up on details.
      return [];
    case "mortgage_purpose":
      return [];
    case "property_price":
      return hasMoneyLike(text) || (target === "price" && hasMoneyLike(latest)) || targetDeclined
        ? []
        : [{ id: "price", followup: () => "About how much is the property, in pounds?" }];
    case "deposit":
      return hasMoneyLike(text) || hasPercentLike(text) || (target === "deposit" && (hasMoneyLike(latest) || hasPercentLike(latest))) || targetDeclined
        ? []
        : [{ id: "deposit", followup: () => "How much deposit will you put in, in pounds?" }];
    case "amount_owed":
      return hasMoneyLike(text) || (target === "owed" && hasMoneyLike(latest)) || targetDeclined
        ? []
        : [{ id: "owed", followup: () => "Roughly how much is left on the mortgage, in pounds?" }];
    case "equity_confirm":
      // Single-shot — a yes/no or a corrected balance is enough.
      return [];
    case "mortgage_term":
    case "mortgage_term_remaining":
      return hasMortgageTerm(text) || hasAnyNumber(text) || (target === "term" && hasAnyNumber(latest)) || targetDeclined
        ? []
        : [{ id: "term", followup: () => "Roughly how many years?" }];
    case "property_type":
      return [];
    default:
      return [];
  }
}

function missingFacts(input: EvaluateInput, text: string): MissingFact[] {
  const latest = input.transcript.trim();
  const priorText = (input.priorAnswer ?? "").trim();
  const firstMissingBeforeThisAnswer = priorText ? missingFactsFor(input, priorText)[0]?.id : undefined;
  return missingFactsFor(input, text, latest, firstMissingBeforeThisAnswer);
}

function firstMissingBeforeCurrentReply(input: EvaluateInput): string | undefined {
  const priorText = (input.priorAnswer ?? "").trim();
  return priorText ? missingFactsFor(input, priorText)[0]?.id : undefined;
}

function withCapturedFactMarker(value: string, input: EvaluateInput, missing: MissingFact[]): string {
  const target = firstMissingBeforeCurrentReply(input);
  const latest = input.transcript.trim();
  if (!target || !latest || missing.some((fact) => fact.id === target) || hasCapturedFact(value, target)) {
    return value;
  }
  return [value.trim(), `Captured ${target}: ${latest}`].filter(Boolean).join("\n");
}

export async function evaluateAnswer(input: EvaluateInput): Promise<EvaluateResult> {
  const combinedText = stripCapturedMarkers(
    [input.priorAnswer, input.transcript].filter(Boolean).join(" ").trim(),
  );
  const hardMissing = missingFacts(input, combinedText);

  // After a few tries, accept a plausible DOB rather than looping forever.
  if (input.fieldKey === "date_of_birth" && input.followupCount >= MAX_FOLLOWUPS - 1 && hasPartialDob(combinedText)) {
    return { complete: true, cleanedValue: combinedText };
  }
  if (input.followupCount >= MAX_FOLLOWUPS && combinedText.trim()) {
    return { complete: true, cleanedValue: combinedText };
  }

  const cleanedValue = withCapturedFactMarker(combinedText, input, hardMissing);

  if (hardMissing.length === 0) {
    if (input.fieldKey === "date_of_birth") {
      const parsed = parseDob(combinedText);
      return { complete: true, cleanedValue: parsed ? formatDobText(parsed) : cleanedValue };
    }
    return { complete: true, cleanedValue };
  }
  return {
    complete: false,
    cleanedValue,
    followup: hardMissing[0]?.followup(input.firstName),
  };
}

export { MAX_FOLLOWUPS };