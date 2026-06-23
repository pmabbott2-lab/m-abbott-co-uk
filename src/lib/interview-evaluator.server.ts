// Server-only OpenAI-driven evaluator for interview answers.
// OpenAI tidies the notes, but this deterministic fact gate decides whether
// the interview is allowed to move on.
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
  return new RegExp(`\\b(?:\\d+|${NUMBER_WORDS})\\b`, "i").test(text);
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

function hasDob(text: string): boolean {
  const monthNames = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
  const ordinalDayWords = "first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|twenty\\s+first|twenty\\s+second|twenty\\s+third|twenty\\s+fourth|twenty\\s+fifth|twenty\\s+sixth|twenty\\s+seventh|twenty\\s+eighth|twenty\\s+ninth|thirtieth|thirty\\s+first";
  const fullYear = "(?:19|20)\\d{2}";
  return (
    /\b\d{1,2}[\/.-]\d{1,2}[\/.-](?:\d{2}|\d{4})\b/.test(text) ||
    /\b\d{1,2}\s+\d{1,2}\s+(?:(?:19|20)?\d{2})\b/.test(text) ||
    new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${monthNames})\\s+${fullYear}\\b`, "i").test(text) ||
    new RegExp(`\\b(?:the\\s+)?(?:${ordinalDayWords})\\s+(?:of\\s+)?(?:${monthNames})\\s+${fullYear}\\b`, "i").test(text)
  );
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
  return /\b(deposit)\b/i.test(text) && (hasMoneyLike(text) || /\b\d{1,2}\s?%\b/.test(text));
}

function hasMortgageTerm(text: string): boolean {
  return /\b(?:term\s*(?:is|of)?\s*)?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|twenty\s+five|thirty|thirty\s+five|forty)\s+years?\b/i.test(text);
}

function hasPropertyType(text: string): boolean {
  return /\b(flat|apartment|terraced|terrace|semi[-\s]?detached|detached|bungalow|maisonette|house)\b/i.test(text);
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
      return hasDob(text) ? [] : [{ id: "dob", followup: () => "What is your full date of birth, including the year?" }];
    case "home": {
      const missing: MissingFact[] = [];
      const addressKnown = captured("address") || hasStreetAddress(text) || (target === "address" && hasPlausibleHouseNameAnswer(latest));
      if (!addressKnown && !(targetDeclined && target === "address")) missing.push({ id: "address", followup: () => "What’s the house name or number and street?" });
      if (!captured("postcode") && !hasPostcode(text) && !(targetDeclined && target === "postcode")) missing.push({ id: "postcode", followup: () => "What’s the postcode for that address?" });
      if (!captured("duration") && !hasDuration(text) && !(targetDeclined && target === "duration")) missing.push({ id: "duration", followup: () => "How long have you lived there?" });
      return missing;
    }
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
    case "work": {
      const missing: MissingFact[] = [];
      const statusKnown = captured("status") || hasEmploymentStatus(text) || targetAnsweredShortly("status") || (targetDeclined && target === "status");
      if (!statusKnown) missing.push({ id: "status", followup: () => "Are you employed, self-employed, retired, unemployed, or something else?" });
      if (isRetiredOrUnemployed(text)) {
        if (!captured("income") && !hasIncome(text) && !(target === "income" && (hasMoneyLike(latest) || hasStandaloneNo(latest))) && !/\b(no|none|zero|0)\s+(?:income|earnings?)\b/i.test(text) && !(targetDeclined && target === "income")) missing.push({ id: "income", followup: () => "Do you currently have any regular income, and how much per year?" });
        return missing;
      }
      if (!captured("employer") && !hasEmployerOrBusiness(text) && !targetAnsweredShortly("employer") && !(targetDeclined && target === "employer")) missing.push({ id: "employer", followup: () => "Who is your employer, or what is your business called?" });
      if (!captured("role") && !hasJobTitle(text) && !targetAnsweredShortly("role") && !(targetDeclined && target === "role")) missing.push({ id: "role", followup: () => "What is your job title or role?" });
      if (!captured("time") && !hasDuration(text) && !(targetDeclined && target === "time")) missing.push({ id: "time", followup: () => "How long have you been in that role?" });
      if (!captured("income") && !hasIncome(text) && !(target === "income" && hasMoneyLike(latest)) && !(targetDeclined && target === "income")) missing.push({ id: "income", followup: () => "What is your annual gross income before tax?" });
      return missing;
    }
    case "retirement_income":
      return captured("pension_income") || hasIncome(text) || (target === "pension_income" && hasMoneyLike(latest)) || (targetDeclined && target === "pension_income") ? [] : [{ id: "pension_income", followup: () => "What is your total annual pension income before tax?" }];
    case "outgoings_credit": {
      const missing: MissingFact[] = [];
      if (!captured("essentials") && !hasMonthlyEssentials(text) && !(target === "essentials" && hasMoneyLike(latest)) && !(targetDeclined && target === "essentials")) missing.push({ id: "essentials", followup: () => "Roughly how much are your essential monthly outgoings?" });
      const noCreditKnown = hasCapturedNo(text, "credit") || hasNoCreditPayments(text) || (target === "credit" && hasStandaloneNo(latest)) || (targetDeclined && target === "credit");
      const creditKnown = hasCapturedYes(text, "credit") || hasCreditPayments(text) || hasCreditSubject(text) || (target === "credit" && (hasStandaloneYes(latest) || hasMoneyLike(latest))) || noCreditKnown;
      if (!creditKnown) missing.push({ id: "credit", followup: () => "Do you have any credit, loans or card payments each month?" });
      if (creditKnown && !noCreditKnown && !captured("credit_amount") && !hasCreditPaymentAmount(text) && !(target === "credit_amount" && (hasMoneyLike(latest) || hasExplicitDecline(latest))) && !(target === "credit" && hasMoneyLike(latest))) {
        missing.push({ id: "credit_amount", followup: () => "How much do you pay towards them each month?" });
      }
      const noAdverseKnown = hasCapturedNo(text, "adverse") || hasNoAdverseCredit(text) || (target === "adverse" && hasStandaloneNo(latest)) || (targetDeclined && target === "adverse");
      const adverseKnown = hasCapturedYes(text, "adverse") || hasAdverseCredit(text) || hasAdverseSubject(text) || (target === "adverse" && hasStandaloneYes(latest)) || noAdverseKnown;
      if (!adverseKnown) missing.push({ id: "adverse", followup: () => "Any missed payments, defaults, CCJs or bankruptcy in the last six years?" });
      if (adverseKnown && !noAdverseKnown && !captured("adverse_details") && !(target === "adverse_details" && isShortMeaningfulAnswer(latest)) && !(targetDeclined && target === "adverse_details")) {
        missing.push({ id: "adverse_details", followup: () => "Could you briefly tell me what happened and when?" });
      }
      return missing;
    }
    case "mortgage_need": {
      const missing: MissingFact[] = [];
      if (!captured("purpose") && !hasMortgagePurpose(text) && !targetAnsweredShortly("purpose") && !(targetDeclined && target === "purpose")) missing.push({ id: "purpose", followup: () => "Is this a purchase, remortgage, next home, or buy-to-let?" });
      if (!captured("price") && !hasPropertyPrice(text) && !(target === "price" && hasMoneyLike(latest)) && !(targetDeclined && target === "price")) missing.push({ id: "price", followup: () => "What is the property price or current value?" });
      if (!captured("deposit") && !hasDeposit(text) && !(target === "deposit" && (hasMoneyLike(latest) || /\b\d{1,2}\s?%\b/.test(latest))) && !(targetDeclined && target === "deposit")) missing.push({ id: "deposit", followup: () => "How much deposit do you have?" });
      if (!captured("term") && !hasMortgageTerm(text) && !(target === "term" && hasAnyNumber(latest)) && !(targetDeclined && target === "term")) missing.push({ id: "term", followup: () => "What mortgage term would you like, in years?" });
      if (!captured("type") && !hasPropertyType(text) && !targetAnsweredShortly("type") && !(targetDeclined && target === "type")) missing.push({ id: "type", followup: () => "What type of property is it — flat, terraced, semi or detached?" });
      return missing;
    }
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
  const combinedText = [input.priorAnswer, input.transcript].filter(Boolean).join(" ").trim();
  const hardMissing = missingFacts(input, combinedText);
  const fallbackCleanedValue = withCapturedFactMarker(combinedText, input, hardMissing);
  const fallback: EvaluateResult = {
    complete: hardMissing.length === 0,
    cleanedValue: fallbackCleanedValue,
    followup: hardMissing[0]?.followup(input.firstName),
  };

  if (!input.expects) return fallback;

  const sys = `You are Susan, a warm, conversational UK mortgage interview assistant. The customer was asked one short open question and may reply with only part of what's needed. You gather the rest through natural, one-at-a-time follow-up questions — never a checklist, never a long multi-part question.
RULE: You MUST NOT move on until every required fact has been captured, OR the customer has explicitly declined/refused to answer that specific fact. There is no other reason to set complete=true.

Each turn:
1) Extract every required fact present so far (prior partial + new transcript). Produce a tidy "cleanedValue" in plain sentences for the advisor's file.
2) If the deterministic gate says something is still missing, keep complete=false.
3) Otherwise → complete=true. If incomplete, write ONE short, warm, British-English follow-up that asks for the SINGLE next missing fact. Max 15 words. Conversational, specific, not a checklist. Never re-ask anything already answered. If the customer seems unsure or asks what you need, ask the specific missing fact with a small example.

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
Remember: if a fact is still missing, ask only the first specific missing fact. A meta reply like "what do you need to know?" is not an answer.`;

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
    const aiCleanedValue = (parsed.cleanedValue ?? fallback.cleanedValue).trim();
    const missingAfterAi = missingFacts(input, [fallback.cleanedValue, aiCleanedValue].filter(Boolean).join(" "));
    const complete = missingAfterAi.length === 0;
    const cleanedValue = withCapturedFactMarker([fallback.cleanedValue, aiCleanedValue].filter(Boolean).join("\n"), input, missingAfterAi);
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