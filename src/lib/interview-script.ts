import { formatGBP, parseMoneyFromText } from "@/lib/structured-answers";

export type Section = "personal" | "employment" | "outgoings" | "property";

/**
 * Short, warm acknowledgements Susan says before the next question. Kept to a
 * small fixed set (no names) so their audio can be pre-cached for instant
 * playback, which hides the latency of generating the next question's speech.
 */
export const ACKNOWLEDGEMENTS = [
  "Thank you",
  "Thanks for that",
  "Lovely",
  "Brilliant",
  "Perfect",
  "Got it",
  "Wonderful",
  "That's great",
  "Great, thank you",
  "Okay, noted",
  "Right, thanks",
  "Understood",
  "Lovely, thank you",
  "Fantastic",
];

/** The phrase as Susan actually speaks it (with a full stop), used for caching. */
export function ackClip(phrase: string): string {
  return `${phrase}.`;
}

/** Extract a clean first name from a full name (e.g. from the login profile). */
export function firstNameFromFullName(fullName?: string | null): string {
  return ((fullName ?? "").trim().split(/\s+/)[0] ?? "").replace(/[^\p{L}'-]/gu, "");
}

/**
 * Susan's opening line: a warm, personalised greeting (using the login first
 * name) followed immediately by the first question. Built from a shared template
 * so the server's first `sayText` and the client's prefetch match exactly — a
 * cache hit that makes the first question play instantly.
 */
export function firstGreeting(firstName: string | undefined, firstPrompt: string): string {
  const intro = firstName
    ? `Hi ${firstName}, I'm Susan, your virtual assistant.`
    : "Hi, I'm Susan, your virtual assistant.";
  return `${intro} I'm here to help get your mortgage advisor up to speed before you meet. ${firstPrompt}`;
}

export type AnswersMap = Record<string, string>;

export interface QuestionOption {
  /** The answer text submitted when this option is tapped. */
  value: string;
  /** The button label shown to the customer. */
  label: string;
}

export interface Question {
  key: string;
  label: string;
  prompt: string;
  /** Plain-English description of the fact we need to establish. Used by the AI evaluator. */
  expects?: string;
  /** Optional predicate; when it returns true, this question is skipped. */
  skipWhen?: (answers: AnswersMap) => boolean;
  /** Optional per-question sustained-silence threshold (ms) used by the client VAD. */
  silenceMs?: number;
  /** Tappable choices. When present, the customer taps instead of speaking. */
  options?: QuestionOption[];
  /** Show an "Other" button that switches to a spoken free-text answer. */
  allowOther?: boolean;
  /** Label for the "Other" button (defaults to "Other"). */
  otherLabel?: string;
  /** What Susan says (and listens for) after "Other" is tapped. */
  otherPrompt?: string;
  /** Marks a question handled by a bespoke client-side wizard (e.g. credit commitments). */
  wizard?: "credit" | "dependants" | "dob";
}

export interface SectionDef {
  id: Section;
  title: string;
  intro: string;
  questions: Question[];
}

function employmentStatusText(answers: AnswersMap): string {
  return (answers["employment:employment_status"] ?? "").toLowerCase();
}

function isRetired(answers: AnswersMap): boolean {
  const status = employmentStatusText(answers);
  if (/\bretired\b/.test(status)) return true;
  if (!status.trim()) return false;
  return /\bretir/.test(status) || /\bpensioner\b/.test(status) || /no longer work/.test(status) || /not working/.test(status) || /stopped work/.test(status);
}

function isNotRetired(answers: AnswersMap): boolean {
  return !isRetired(answers);
}

function isSelfEmployed(answers: AnswersMap): boolean {
  return /\bself[-\s]?employ/.test(employmentStatusText(answers));
}

function isContractor(answers: AnswersMap): boolean {
  return /\bcontractor\b/.test(employmentStatusText(answers));
}

function isEmployed(answers: AnswersMap): boolean {
  const status = employmentStatusText(answers);
  return /\bemployed\b/.test(status) && !isSelfEmployed(answers);
}

function needsEmployer(answers: AnswersMap): boolean {
  return (isEmployed(answers) || isContractor(answers)) && !isRetired(answers);
}

function needsBusinessName(answers: AnswersMap): boolean {
  return isSelfEmployed(answers) && !isRetired(answers);
}

function needsJobTitle(answers: AnswersMap): boolean {
  return (isEmployed(answers) || isContractor(answers)) && !isRetired(answers);
}

function isRemortgage(answers: AnswersMap): boolean {
  const v = (answers["property:mortgage_purpose"] ?? "").toLowerCase();
  return /\bre[-\s]?mortgage\b/.test(v);
}

function isNotRemortgage(answers: AnswersMap): boolean {
  return !isRemortgage(answers);
}

function isMovingHome(answers: AnswersMap): boolean {
  const v = (answers["property:mortgage_purpose"] ?? "").toLowerCase();
  return /\bmoving\b/.test(v) || /\bnext home\b/.test(v);
}

function isMovingOrRemortgage(answers: AnswersMap): boolean {
  return isRemortgage(answers) || isMovingHome(answers);
}

function isNotMovingOrRemortgage(answers: AnswersMap): boolean {
  return !isMovingOrRemortgage(answers);
}

/** Prompt Susan should speak for a question, based on answers already captured. */
export function resolveQuestionPrompt(q: Question, answers: AnswersMap): string {
  switch (q.key) {
    case "employer":
      return "Who is your employer?";
    case "business_name":
      return "What's your business called?";
    case "job_title":
      return isContractor(answers)
        ? "And what's your job title or contract role?"
        : "And what's your job title?";
    case "mortgage_term_remaining":
      return "How many years are left on your current mortgage?";
    default:
      return q.prompt;
  }
}

export const SECTIONS: SectionDef[] = [
  {
    id: "personal",
    title: "About you",
    intro: "Let's start with where you live.",
    questions: [
      {
        key: "home_postcode",
        label: "Current postcode",
        prompt: "What's the postcode of the home you live in now, {firstName}?",
        expects: "A full UK postcode.",
        silenceMs: 1400,
      },
      {
        key: "home_house",
        label: "House number or name",
        prompt: "And the house number or name?",
        expects: "A house number or house name.",
        silenceMs: 1300,
      },
      {
        key: "home_confirm",
        label: "Address confirmation",
        prompt: "Let me check that address.",
        expects: "A simple yes or no confirming the address is correct.",
        options: [
          { value: "Yes", label: "Yes" },
          { value: "No", label: "No" },
        ],
        silenceMs: 1100,
      },
      {
        key: "home_duration",
        label: "Time at address",
        prompt: "How long have you lived there?",
        expects: "Roughly how long they have lived at the address.",
        silenceMs: 1300,
      },
      {
        key: "date_of_birth",
        label: "Date of birth",
        prompt: "What's your date of birth? Tap the day, month and year below — or say it aloud, for example 15 March 1980.",
        expects: "A complete date of birth: day, month, and year.",
        wizard: "dob",
        silenceMs: 2000,
      },
      {
        key: "marital_status",
        label: "Relationship status",
        prompt: "Which of these best describes your relationship status, {firstName}? Tap the option that fits — or tap Other.",
        expects: "Relationship status: single, married, civil partnership, living with a partner, divorced, separated or widowed.",
        options: [
          { value: "Single", label: "Single" },
          { value: "Married", label: "Married" },
          { value: "Civil partnership", label: "Civil partnership" },
          { value: "Living with partner", label: "Living with partner" },
          { value: "Divorced", label: "Divorced" },
          { value: "Separated", label: "Separated" },
          { value: "Widowed", label: "Widowed" },
        ],
        allowOther: true,
        otherPrompt: "No problem — please describe your relationship status in your own words.",
        silenceMs: 1100,
      },
      {
        key: "dependants",
        label: "Dependants",
        prompt: "Do you have any children or other dependants? Tap how many below.",
        expects: "How many dependants, and for each one their name and age.",
        wizard: "dependants",
        silenceMs: 1300,
      },
    ],
  },
  {
    id: "employment",
    title: "Employment & income",
    intro: "Now a few questions about your work and income.",
    questions: [
      {
        key: "employment_status",
        label: "Employment status",
        prompt: "Which of these best describes your work? Tap the option that fits best below — or tap Other.",
        expects: "Employment status: employed, self-employed, contractor, retired, or other.",
        options: [
          { value: "Employed", label: "Employed" },
          { value: "Self-employed", label: "Self-employed" },
          { value: "Contractor", label: "Contractor" },
          { value: "Retired", label: "Retired" },
        ],
        allowOther: true,
        otherPrompt: "No problem — please describe your employment situation in your own words.",
        silenceMs: 1100,
      },
      {
        key: "employer",
        label: "Employer",
        prompt: "Who is your employer?",
        expects: "The employer name.",
        skipWhen: (answers) => !needsEmployer(answers),
        silenceMs: 1300,
      },
      {
        key: "business_name",
        label: "Business name",
        prompt: "What's your business called?",
        expects: "The business or trading name.",
        skipWhen: (answers) => !needsBusinessName(answers),
        silenceMs: 1300,
      },
      {
        key: "job_title",
        label: "Job title",
        prompt: "And what's your job title?",
        expects: "The customer's job title or role.",
        skipWhen: (answers) => !needsJobTitle(answers),
        silenceMs: 1300,
      },
      {
        key: "income",
        label: "Annual income",
        prompt: "And what's your annual income before tax, including any regular bonus or overtime?",
        expects: "Annual gross income in GBP, including any regular bonus or overtime.",
        skipWhen: isRetired,
        silenceMs: 1300,
      },
      {
        key: "retirement_income",
        label: "Retirement income",
        prompt: "Can you tell me about your retirement income each year, {firstName}?",
        expects: "Total annual pension income in GBP, ideally noting state vs private/workplace pensions.",
        skipWhen: isNotRetired,
        silenceMs: 1300,
      },
    ],
  },
  {
    id: "outgoings",
    title: "Outgoings & credit",
    intro: "Let's cover any existing credit commitments.",
    questions: [
      {
        key: "credit_commitments",
        label: "Credit commitments",
        prompt: "Now, which of these credit commitments will you still be paying after the mortgage completes? Tap each one that applies below — or tap None of these.",
        expects: "Each ongoing credit commitment (credit cards, loans, hire purchase, car finance, store cards, overdrafts or other), with how many of each and the monthly payment and balance for each — or a clear 'none'.",
        wizard: "credit",
        silenceMs: 1400,
      },
      {
        key: "adverse_credit",
        label: "Adverse credit",
        prompt: "Have you ever had any adverse credit — a CCJ, a default, or been declared bankrupt? Tap Yes or No below.",
        expects: "Whether there is any adverse credit — yes with brief details, or no.",
        options: [{ value: "No adverse credit", label: "No" }],
        allowOther: true,
        otherLabel: "Yes",
        otherPrompt:
          "Okay, no problem. Please tell me what it was — for example a CCJ, default, or bankruptcy — roughly when it happened, and the amount involved.",
        silenceMs: 1400,
      },
    ],
  },
  {
    id: "property",
    title: "The mortgage you need",
    intro: "Finally, let's talk about the property and mortgage you're after.",
    questions: [
      {
        key: "mortgage_purpose",
        label: "Mortgage purpose",
        prompt: "Tell me which option below best describes the mortgage you need by tapping the best one. If none fit, tap Other.",
        expects: "The purpose: first purchase, next home, remortgage, or buy-to-let.",
        options: [
          { value: "First purchase", label: "First purchase" },
          { value: "Next home (moving)", label: "Next home (moving)" },
          { value: "Remortgage", label: "Remortgage" },
          { value: "Buy-to-let", label: "Buy-to-let" },
        ],
        allowOther: true,
        otherPrompt: "Please describe the mortgage you need in your own words.",
        silenceMs: 1300,
      },
      {
        key: "property_type",
        label: "Property type",
        prompt: "And what type of property is it? Tap the closest option below, or tap Other.",
        expects: "The property type: flat, terraced, semi-detached or detached.",
        options: [
          { value: "Flat", label: "Flat" },
          { value: "Terraced house", label: "Terraced" },
          { value: "Semi-detached house", label: "Semi-detached" },
          { value: "Detached house", label: "Detached" },
          { value: "Bungalow", label: "Bungalow" },
        ],
        allowOther: true,
        otherPrompt: "Please describe the type of property.",
        silenceMs: 1300,
      },
      {
        key: "property_price",
        label: "Property price / value",
        prompt: "What's the price or current value of the property?",
        expects: "The property purchase price or current value in GBP.",
        silenceMs: 1300,
      },
      {
        key: "deposit",
        label: "Deposit",
        prompt: "And how much deposit will you be putting in?",
        expects: "The deposit amount in GBP.",
        skipWhen: isRemortgage,
        silenceMs: 1300,
      },
      {
        key: "amount_owed",
        label: "Mortgage balance owed",
        prompt: "And how much do you currently owe on the mortgage?",
        expects: "The outstanding mortgage balance still owed, in GBP.",
        skipWhen: isNotRemortgage,
        silenceMs: 1300,
      },
      {
        key: "equity_confirm",
        label: "Equity confirmation",
        prompt: "Let me work out your equity.",
        expects: "A simple yes or no confirming the equity figure, or a corrected balance.",
        skipWhen: isNotRemortgage,
        silenceMs: 1100,
      },
      {
        key: "mortgage_term_remaining",
        label: "Remaining mortgage term",
        prompt: "How many years are left on your current mortgage?",
        expects: "How many years remain on the current mortgage.",
        skipWhen: isNotMovingOrRemortgage,
        silenceMs: 1300,
      },
      {
        key: "mortgage_term",
        label: "Mortgage term",
        prompt: "Over how many years would you like the mortgage?",
        expects: "The mortgage term in years.",
        skipWhen: isMovingOrRemortgage,
        silenceMs: 1300,
      },
    ],
  },
];

export function findSection(id: string): SectionDef | undefined {
  return SECTIONS.find((s) => s.id === id);
}

function isSkipped(q: Question, answers?: AnswersMap): boolean {
  if (!answers || !q.skipWhen) return false;
  try { return q.skipWhen(answers); } catch { return false; }
}

export function totalQuestions(answers?: AnswersMap): number {
  return SECTIONS.reduce(
    (acc, s) => acc + s.questions.filter((q) => !isSkipped(q, answers)).length,
    0,
  );
}

export function questionIndexGlobal(section: Section, index: number, answers?: AnswersMap): number {
  let n = 0;
  for (const s of SECTIONS) {
    if (s.id === section) {
      for (let i = 0; i < index; i++) {
        if (!isSkipped(s.questions[i], answers)) n += 1;
      }
      return n;
    }
    n += s.questions.filter((q) => !isSkipped(q, answers)).length;
  }
  return n;
}

export function nextStep(
  section: Section,
  index: number,
  answers?: AnswersMap,
): { section: Section; index: number } | null {
  let cur: { section: Section; index: number } | null = { section, index };
  while (cur) {
    const sIdx = SECTIONS.findIndex((s) => s.id === cur!.section);
    if (sIdx < 0) return null;
    const sec = SECTIONS[sIdx];
    if (cur.index + 1 < sec.questions.length) {
      cur = { section: cur.section, index: cur.index + 1 };
    } else {
      const next = SECTIONS[sIdx + 1];
      if (!next) return null;
      cur = { section: next.id, index: 0 };
    }
    const q = getQuestion(cur.section, cur.index);
    if (q && !isSkipped(q, answers)) return cur;
  }
  return null;
}

export function prevStep(
  section: Section,
  index: number,
  answers?: AnswersMap,
): { section: Section; index: number } | null {
  let cur: { section: Section; index: number } | null = { section, index };
  while (cur) {
    const sIdx = SECTIONS.findIndex((s) => s.id === cur!.section);
    if (sIdx < 0) return null;
    if (cur.index > 0) {
      cur = { section: cur.section, index: cur.index - 1 };
    } else {
      const prev = SECTIONS[sIdx - 1];
      if (!prev) return null;
      cur = { section: prev.id, index: prev.questions.length - 1 };
    }
    const q = getQuestion(cur.section, cur.index);
    if (q && !isSkipped(q, answers)) return cur;
  }
  return null;
}

export function getQuestion(section: Section, index: number): Question | undefined {
  return findSection(section)?.questions[index];
}

/** Build the spoken line for a question (resume/back), matching server phrasing. */
export function buildQuestionSayText(
  section: Section,
  index: number,
  answers: AnswersMap,
  firstName?: string,
  opts?: { isFirstQuestion?: boolean },
): string {
  const sectionDef = findSection(section);
  const question = getQuestion(section, index);
  if (!sectionDef || !question) return "";

  const personalise = (text: string) =>
    firstName ? text.replace(/\{firstName\}/g, firstName) : text.replace(/,?\s*\{firstName\}/g, "");

  if (opts?.isFirstQuestion && section === "personal" && index === 0) {
    return personalise(firstGreeting(firstName, resolveQuestionPrompt(question, answers)));
  }

  if (question.key === "home_confirm") {
    const addr = answers["personal:home_address"] ?? "";
    const confirm = addr
      ? `I have your address as ${addr}. Tap Yes to confirm, or No to try again.`
      : "Your address — please say the full address, including the street, town and postcode.";
    return personalise(confirm);
  }

  if (question.key === "equity_confirm") {
    const price = parseMoneyFromText(answers["property:property_price"] ?? "");
    const owed = parseMoneyFromText(answers["property:amount_owed"] ?? "");
    if (price != null && owed != null) {
      const equity = Math.max(0, price - owed);
      return personalise(`That leaves about ${formatGBP(equity)} of equity in the property. Does that sound right? If not, just tell me the correct balance.`);
    }
    return personalise("Roughly how much equity do you think you have in the property?");
  }

  const intro = index === 0 ? `${sectionDef.intro} ` : "";
  return personalise(intro + resolveQuestionPrompt(question, answers));
}
