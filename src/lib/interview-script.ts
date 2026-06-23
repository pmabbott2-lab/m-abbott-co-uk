export type Section = "personal" | "employment" | "outgoings" | "property";

export type AnswersMap = Record<string, string>;

export interface Question {
  key: string;
  label: string;
  prompt: string;
  /** Optional predicate; when it returns true, this question is skipped. */
  skipWhen?: (answers: AnswersMap) => boolean;
}

export interface SectionDef {
  id: Section;
  title: string;
  intro: string;
  questions: Question[];
}

function isRetired(answers: AnswersMap): boolean {
  const v = (answers["employment:employment_status"] ?? "").toLowerCase();
  return /\bretir/.test(v) || /pension/.test(v);
}

function isNotRetired(answers: AnswersMap): boolean {
  const v = (answers["employment:employment_status"] ?? "").toLowerCase();
  if (!v) return true; // before we know, default to hiding the retiree-only field
  return !(/\bretir/.test(v) || /pension/.test(v));
}

function hasDependants(answers: AnswersMap): boolean {
  const v = (answers["personal:dependants"] ?? "").toLowerCase().trim();
  if (!v) return false;
  if (/\b(no|none|nope|zero|0|n\/a|na)\b/.test(v)) return false;
  return /\b(yes|child|children|kid|son|daughter|dependant|dependent|[1-9])/.test(v);
}

export const SECTIONS: SectionDef[] = [
  {
    id: "personal",
    title: "About you",
    intro: "Let's start with a few details about you.",
    questions: [
      { key: "full_name", label: "Full name", prompt: "Could you tell me your full legal name?" },
      { key: "date_of_birth", label: "Date of birth", prompt: "What's your date of birth?" },
      { key: "address", label: "Current address", prompt: "What's your current home address, including postcode?" },
      { key: "marital_status", label: "Marital status", prompt: "Are you single, married, in a civil partnership, or living with a partner?" },
      { key: "dependants", label: "Dependants", prompt: "Do you have any dependants?" },
      { key: "dependants_details", label: "Children's names & ages", prompt: "Thank you — could you tell me their names and ages?", skipWhen: (a) => !hasDependants(a) },
    ],
  },
  {
    id: "employment",
    title: "Employment & income",
    intro: "Now a few questions about your work and income.",
    questions: [
      { key: "employment_status", label: "Employment status", prompt: "Are you employed, self-employed, a contractor, retired, or something else?" },
      { key: "employer", label: "Employer / business name", prompt: "Who do you work for, or what's the name of your business?", skipWhen: isRetired },
      { key: "job_title", label: "Job title", prompt: "What's your job title or role?", skipWhen: isRetired },
      { key: "annual_income", label: "Annual gross income", prompt: "Roughly what's your annual gross income, including any regular bonus?", skipWhen: isRetired },
      { key: "years_in_role", label: "Time in current role", prompt: "How long have you been in your current role?", skipWhen: isRetired },
      { key: "pension_income", label: "Annual pension income", prompt: "Roughly what's your total annual pension income, including state and private pensions?", skipWhen: isNotRetired },
    ],
  },
  {
    id: "outgoings",
    title: "Outgoings & credit",
    intro: "Let's cover your regular outgoings and any existing credit.",
    questions: [
      { key: "monthly_essentials", label: "Monthly essentials", prompt: "Roughly how much do you spend each month on essentials like bills, food, and travel?" },
      { key: "existing_debts", label: "Existing debts", prompt: "Do you have any existing loans, credit cards, or finance agreements? If so, what's the total monthly payment?" },
      { key: "credit_history", label: "Credit history", prompt: "Have you had any missed payments, defaults, CCJs, or bankruptcies in the last six years?" },
    ],
  },
  {
    id: "property",
    title: "The mortgage you need",
    intro: "Finally, let's talk about the property and mortgage you're after.",
    questions: [
      { key: "purpose", label: "Purpose", prompt: "Is this for a first purchase, a next home, a remortgage, or a buy-to-let?" },
      { key: "property_value", label: "Property price / value", prompt: "What's the price of the property, or its current value?" },
      { key: "deposit", label: "Deposit available", prompt: "How much deposit do you have available?" },
      { key: "term_years", label: "Mortgage term", prompt: "Over how many years would you like to repay the mortgage?" },
      { key: "property_type", label: "Property type", prompt: "What type of property is it — for example, a flat, terraced, semi-detached, or detached house?" },
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
