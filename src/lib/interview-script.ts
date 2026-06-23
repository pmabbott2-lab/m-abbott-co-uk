export type Section = "personal" | "employment" | "outgoings" | "property";

export interface Question {
  key: string;
  label: string;
  prompt: string;
}

export interface SectionDef {
  id: Section;
  title: string;
  intro: string;
  questions: Question[];
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
      { key: "dependants", label: "Dependants", prompt: "Do you have any dependants, and if so, how many and what ages?" },
    ],
  },
  {
    id: "employment",
    title: "Employment & income",
    intro: "Now a few questions about your work and income.",
    questions: [
      { key: "employment_status", label: "Employment status", prompt: "Are you employed, self-employed, a contractor, or something else?" },
      { key: "employer", label: "Employer / business name", prompt: "Who do you work for, or what's the name of your business?" },
      { key: "job_title", label: "Job title", prompt: "What's your job title or role?" },
      { key: "annual_income", label: "Annual gross income", prompt: "Roughly what's your annual gross income, including any regular bonus?" },
      { key: "years_in_role", label: "Time in current role", prompt: "How long have you been in your current role?" },
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

export function totalQuestions(): number {
  return SECTIONS.reduce((acc, s) => acc + s.questions.length, 0);
}

export function questionIndexGlobal(section: Section, index: number): number {
  let n = 0;
  for (const s of SECTIONS) {
    if (s.id === section) return n + index;
    n += s.questions.length;
  }
  return n;
}

export function nextStep(section: Section, index: number): { section: Section; index: number } | null {
  const sIdx = SECTIONS.findIndex((s) => s.id === section);
  if (sIdx < 0) return null;
  const sec = SECTIONS[sIdx];
  if (index + 1 < sec.questions.length) return { section, index: index + 1 };
  const next = SECTIONS[sIdx + 1];
  if (!next) return null;
  return { section: next.id, index: 0 };
}

export function getQuestion(section: Section, index: number): Question | undefined {
  return findSection(section)?.questions[index];
}
