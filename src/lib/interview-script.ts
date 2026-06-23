export type Section = "personal" | "employment" | "outgoings" | "property";

export type AnswersMap = Record<string, string>;

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
}

export interface SectionDef {
  id: Section;
  title: string;
  intro: string;
  questions: Question[];
}

function isRetired(answers: AnswersMap): boolean {
  const v = (
    (answers["employment:work"] ?? "") + " " + (answers["employment:employment_status"] ?? "")
  ).toLowerCase();
  if (!v.trim()) return false;
  return /\bretir/.test(v) || /\bpension/.test(v) || /no longer work/.test(v) || /not working/.test(v) || /stopped work/.test(v);
}

function isNotRetired(answers: AnswersMap): boolean {
  const v = (
    (answers["employment:work"] ?? "") + " " + (answers["employment:employment_status"] ?? "")
  ).toLowerCase();
  if (!v.trim()) return true;
  return !isRetired(answers);
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
      {
        key: "full_name",
        label: "Full name",
        prompt: "Hi! I'm Susan, and I'll guide you through a quick chat to help with your mortgage. To get started, what's your full name?",
        expects: "The customer's full legal name — both first name and surname. If only a first name is given, ask for their surname too.",
      },
      {
        key: "date_of_birth",
        label: "Date of birth",
        prompt: "Lovely to meet you, {firstName}. Could you tell me your date of birth?",
        expects: "A complete date of birth: day, month, and year.",
      },
      {
        key: "home",
        label: "Current home",
        prompt: "Thanks, {firstName}. Where do you currently live?",
        expects: "House number/name and street, town/city, full UK postcode, and how long they've lived there.",
        silenceMs: 2200,
      },
      {
        key: "family",
        label: "Family & dependants",
        prompt: "Tell me a little about your family, {firstName}.",
        expects: "Relationship status (single, married, civil partnership, cohabiting, divorced, separated, widowed) AND whether they have any dependants. If yes, how many and their ages.",
        silenceMs: 2200,
      },
    ],
  },
  {
    id: "employment",
    title: "Employment & income",
    intro: "Now a few questions about your work and income.",
    questions: [
      {
        key: "work",
        label: "Work & income",
        prompt: "{firstName}, tell me about what you do for work.",
        expects: "Employment status (employed / self-employed / contractor / retired / other), employer or business name, job title, time in role, and annual gross income in GBP including any regular bonus.",
        silenceMs: 2200,
      },
      {
        key: "retirement_income",
        label: "Retirement income",
        prompt: "Thanks, {firstName}. Can you tell me about your retirement income?",
        expects: "Total annual pension income in GBP, ideally noting state vs private/workplace pensions.",
        skipWhen: isNotRetired,
      },
    ],
  },
  {
    id: "outgoings",
    title: "Outgoings & credit",
    intro: "Let's cover your regular outgoings and any existing credit.",
    questions: [
      {
        key: "outgoings_credit",
        label: "Outgoings & credit",
        prompt: "Tell me about your regular monthly outgoings, {firstName}.",
        expects: "Three things: (1) monthly essentials spend in GBP (bills, food, travel etc.), (2) any existing credit/loan/credit-card payments — total per month, or 'none', (3) any adverse credit in the last six years — missed payments, defaults, CCJs or bankruptcies (yes with details, or no).",
        silenceMs: 2500,
      },
    ],
  },
  {
    id: "property",
    title: "The mortgage you need",
    intro: "Finally, let's talk about the property and mortgage you're after.",
    questions: [
      {
        key: "mortgage_need",
        label: "Mortgage need",
        prompt: "Finally, {firstName}, tell me about the mortgage you're looking for.",
        expects: "Five things: purpose (first purchase / next home / remortgage / buy-to-let), property price or value in GBP, deposit in GBP, mortgage term in years, and property type (flat, terraced, semi or detached).",
        silenceMs: 2500,
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
