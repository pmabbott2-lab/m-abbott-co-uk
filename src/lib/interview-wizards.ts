/**
 * Shared, framework-agnostic logic for the two bespoke fact-find wizards
 * (credit commitments and dependants). Both the spoken interview
 * (`interview.$sessionId.tsx`) and the typed chat (`ChatInterview.tsx`) import
 * these so the summary strings sent to `/api/interview-step` — and therefore the
 * saved answers and advisor report — stay byte-for-byte identical regardless of
 * which mode the customer chose.
 */

import { formatDobText } from "@/lib/dob-parse";

// --- Credit-commitments wizard ---
export interface CreditType {
  key: string;
  label: string;
  noun: string;
  plural: string;
}

export const CREDIT_TYPES: CreditType[] = [
  { key: "credit_card", label: "Credit card", noun: "credit card", plural: "credit cards" },
  { key: "loan", label: "Loan", noun: "loan", plural: "loans" },
  { key: "hire_purchase", label: "Hire purchase", noun: "hire purchase agreement", plural: "hire purchase agreements" },
  { key: "car_finance", label: "Car finance", noun: "car finance agreement", plural: "car finance agreements" },
  { key: "store_card", label: "Store card", noun: "store card", plural: "store cards" },
  { key: "overdraft", label: "Overdraft", noun: "overdraft", plural: "overdrafts" },
];

export interface CreditEntry {
  typeKey: string;
  label: string;
  index: number;
  detail: string;
}

export interface CreditFlow {
  phase: "select" | "count" | "amount" | "other";
  selected: string[];
  typeIdx: number;
  count: number;
  itemIdx: number;
  entries: CreditEntry[];
}

const COUNT_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

export function parseCount(text: string): number | null {
  const digit = text.match(/\b(\d{1,2})\b/);
  if (digit) return Math.min(20, Math.max(1, parseInt(digit[1], 10)));
  for (const [w, n] of Object.entries(COUNT_WORDS)) {
    if (new RegExp(`\\b${w}\\b`, "i").test(text)) return n;
  }
  return null;
}

/** Pull up to two money amounts (payment, balance) from an answer. */
export function parseAmountsFromText(text: string): number[] {
  const out: number[] = [];
  const re = /£?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(k|m|thousand|million|grand)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let n = parseFloat(m[1].replace(/,/g, ""));
    const suf = (m[2] || "").toLowerCase();
    if (suf === "k" || suf === "thousand" || suf === "grand") n *= 1000;
    if (suf === "m" || suf === "million") n *= 1_000_000;
    if (!isNaN(n) && n >= 10) out.push(Math.round(n));
  }
  return out;
}

export function buildCreditSummary(entries: CreditEntry[]): string {
  if (!entries.length) return "No ongoing credit commitments.";
  const byLabel = new Map<string, CreditEntry[]>();
  for (const e of entries) {
    const arr = byLabel.get(e.label) ?? [];
    arr.push(e);
    byLabel.set(e.label, arr);
  }
  const parts: string[] = [];
  for (const [label, items] of byLabel) {
    const itemStrs = items.map((it) => {
      const amounts = parseAmountsFromText(it.detail);
      const bits: string[] = [];
      if (amounts[0] != null) bits.push(`£${amounts[0]}/month`);
      if (amounts[1] != null) bits.push(`£${amounts[1]} balance`);
      const money = bits.length ? ` (${bits.join(", ")})` : ` (${it.detail.trim()})`;
      return items.length > 1 ? `${label} ${it.index}${money}` : `${label}${money}`;
    });
    parts.push(`${items.length} × ${label}: ${itemStrs.join("; ")}`);
  }
  return `Ongoing credit commitments — ${parts.join(". ")}.`;
}

// --- Dependants wizard ---
export interface DependantEntry {
  index: number;
  detail: string;
}

export interface DependantFlow {
  phase: "count" | "detail";
  count: number;
  itemIdx: number;
  entries: DependantEntry[];
}

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];

export function ordinal(n: number): string {
  return ORDINALS[n - 1] ?? `${n}th`;
}

export function buildDependantsSummary(entries: DependantEntry[]): string {
  if (!entries.length) return "No dependants.";
  const parts = entries.map((e) => `${e.index}) ${e.detail.trim()}`);
  return `${entries.length} dependant${entries.length > 1 ? "s" : ""} — ${parts.join("; ")}.`;
}

export function buildDobAnswer(day: number, month: number, year: number): string {
  return formatDobText({ day, month, year });
}
