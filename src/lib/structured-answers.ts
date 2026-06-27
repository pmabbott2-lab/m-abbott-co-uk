import type { Json } from "@/integrations/supabase/types";

const UK_POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
const DOB =
  /\b(\d{1,2}(?:st|nd|rd|th)?\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{2,4}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\b/i;

const SMALL_NUMBERS: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS_NUMBERS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, grand: 1000, million: 1_000_000, billion: 1_000_000_000 };

/** Convert spoken English number words to a value, e.g. "three hundred thousand" → 300000. */
export function wordsToNumber(text: string): number | null {
  const tokens = text.toLowerCase().replace(/-/g, " ").match(/[a-z]+/g) ?? [];
  let current = 0;
  let total = 0;
  let any = false;
  for (const token of tokens) {
    if (token in SMALL_NUMBERS) {
      current += SMALL_NUMBERS[token];
      any = true;
    } else if (token in TENS_NUMBERS) {
      current += TENS_NUMBERS[token];
      any = true;
    } else if (token === "hundred") {
      current = (current || 1) * 100;
      any = true;
    } else if (token in SCALES) {
      current = (current || 1) * SCALES[token];
      total += current;
      current = 0;
      any = true;
    }
    // Non-number words (and stray "and"/"a") are ignored so phrases work.
  }
  if (!any) return null;
  return total + current;
}

export function parseMoneyFromText(text: string): number | null {
  const s = text.toLowerCase().replace(/,/g, "");
  // £-prefixed or plain number, optionally followed by k / m / thousand / million / grand.
  const m = s.match(/£?\s*(\d+(?:\.\d+)?)\s*(k|m|thousand|million|grand|bn)?/);
  if (m) {
    let n = parseFloat(m[1]);
    const suffix = m[2];
    if (suffix === "k" || suffix === "thousand" || suffix === "grand") n *= 1000;
    if (suffix === "m" || suffix === "million") n *= 1_000_000;
    if (suffix === "bn") n *= 1_000_000_000;
    // Ignore tiny standalone numbers (e.g. "10" from "10%") unless scaled up.
    if (!isNaN(n) && (n >= 1000 || (suffix && n > 0))) return Math.round(n);
  }
  // Fall back to spoken words ("three hundred thousand", "fifty grand", etc.).
  // Skip spoken decimals ("one point five million") — the digit form is handled
  // above and word-parsing them is unreliable.
  if (!/\bpoint\b/.test(s)) {
    const words = wordsToNumber(s);
    if (words != null && words >= 100) return Math.round(words);
  }
  return null;
}

function parseYears(text: string): number | null {
  const m = text.match(/\b(\d{1,2})\s*(?:year|yr|years)\b/i);
  if (m) return parseInt(m[1], 10);
  return null;
}

function parseEmploymentStatus(text: string): string | undefined {
  const s = text.toLowerCase();
  if (/\bself[- ]?employ/.test(s)) return "self-employed";
  if (/\bcontractor\b/.test(s)) return "contractor";
  if (/\bretir/.test(s)) return "retired";
  if (/\bemploy/.test(s)) return "employed";
  return undefined;
}

function parseMortgagePurpose(text: string): string | undefined {
  const s = text.toLowerCase();
  if (/\bfirst[- ]?(time|home|buyer)\b/.test(s)) return "first purchase";
  if (/\bbuy[- ]?to[- ]?let\b|\bbtl\b/.test(s)) return "buy-to-let";
  if (/\bremortgage\b/.test(s)) return "remortgage";
  if (/\bnext home\b|\bmove\b|\bupsiz/.test(s)) return "next home";
  if (/\bpurchase\b|\bbuying\b/.test(s)) return "purchase";
  return undefined;
}

/** Extract typed facts from a free-text answer for adviser dashboards and integrations. */
export function extractStructuredFields(fieldKey: string, value: string): Json {
  const text = (value ?? "").trim();
  if (!text) return {};

  switch (fieldKey) {
    case "full_name": {
      const parts = text.replace(/Captured\s+[^:]+:\s*/gi, "").trim().split(/\s+/);
      return parts.length >= 2
        ? { first_name: parts[0], surname: parts.slice(1).join(" ") }
        : { first_name: parts[0] ?? text };
    }
    case "date_of_birth": {
      const m = text.match(DOB);
      return m ? { date_of_birth: m[1] } : {};
    }
    case "home":
    case "home_postcode": {
      const pc = text.match(UK_POSTCODE);
      return pc ? { postcode: pc[1].toUpperCase().replace(/\s+/, " ") } : {};
    }
    case "home_address": {
      const pc = text.match(UK_POSTCODE);
      return { address: text, ...(pc ? { postcode: pc[1].toUpperCase().replace(/\s+/, " ") } : {}) };
    }
    case "home_house":
    case "home_duration":
      return {};
    case "family": {
      const s = text.toLowerCase();
      let status: string | undefined;
      if (/\bmarried\b/.test(s)) status = "married";
      else if (/\bcivil partner/.test(s)) status = "civil partnership";
      else if (/\bcohabit/.test(s)) status = "cohabiting";
      else if (/\bdivorc/.test(s)) status = "divorced";
      else if (/\bseparat/.test(s)) status = "separated";
      else if (/\bwidow/.test(s)) status = "widowed";
      else if (/\bsingle\b/.test(s)) status = "single";
      const dep = s.match(/\b(\d+)\s*(?:child|children|dependant|dependent)/);
      return {
        ...(status ? { relationship_status: status } : {}),
        ...(dep ? { dependants_count: parseInt(dep[1], 10) } : {}),
      };
    }
    case "marital_status": {
      const s = text.toLowerCase();
      let status: string | undefined;
      if (/\bmarried\b/.test(s)) status = "married";
      else if (/\bcivil partner/.test(s)) status = "civil partnership";
      else if (/\bcohabit|living with/.test(s)) status = "living with partner";
      else if (/\bdivorc/.test(s)) status = "divorced";
      else if (/\bseparat/.test(s)) status = "separated";
      else if (/\bwidow/.test(s)) status = "widowed";
      else if (/\bsingle\b/.test(s)) status = "single";
      return status ? { relationship_status: status } : { relationship_status: text };
    }
    case "dependants": {
      const s = text.toLowerCase();
      if (/\bno dependants\b/.test(s) || /\bnone\b/.test(s)) return { dependants_count: 0 };
      const m = text.match(/^\s*(\d+)\s+dependant/i);
      return m ? { dependants_count: parseInt(m[1], 10) } : {};
    }
    case "employer": {
      return text ? { employer: text } : {};
    }
    case "job_title": {
      return text ? { job_title: text } : {};
    }
    case "work":
    case "retirement_income": {
      const income = parseMoneyFromText(text);
      const status = parseEmploymentStatus(text);
      return {
        ...(status ? { employment_status: status } : {}),
        ...(income ? { annual_income_gbp: income } : {}),
      };
    }
    case "outgoings_credit": {
      const amounts = [...text.matchAll(/£\s*([\d,]+)/g)].map((m) => parseFloat(m[1].replace(/,/g, "")));
      const adverse = /\b(yes|default|ccj|missed payment|bankrupt|iva|adverse)\b/i.test(text);
      return {
        ...(amounts[0] ? { monthly_essentials_gbp: Math.round(amounts[0]) } : {}),
        ...(amounts[1] ? { monthly_credit_commitments_gbp: Math.round(amounts[1]) } : {}),
        adverse_credit: adverse,
      };
    }
    case "employment_status": {
      const status = parseEmploymentStatus(text);
      return status ? { employment_status: status } : {};
    }
    case "income": {
      const income = parseMoneyFromText(text);
      const status = parseEmploymentStatus(text);
      return { ...(status ? { employment_status: status } : {}), ...(income ? { annual_income_gbp: income } : {}) };
    }
    case "monthly_essentials": {
      const n = parseMoneyFromText(text);
      return n ? { monthly_essentials_gbp: n } : {};
    }
    case "ongoing_loans":
    case "ongoing_credit": {
      const s = text.toLowerCase();
      const none = /\b(no|none|nope|nothing|n\/?a|don'?t have)\b/.test(s) && !/£|\b\d{3,}\b/.test(s);
      const amounts = [...text.matchAll(/£\s*([\d,]+)/g)].map((m) => Math.round(parseFloat(m[1].replace(/,/g, ""))));
      return {
        has_commitment: !none,
        ...(amounts[0] ? { monthly_payment_gbp: amounts[0] } : {}),
        ...(amounts[1] ? { balance_gbp: amounts[1] } : {}),
      };
    }
    case "credit_commitments": {
      const s = text.toLowerCase();
      const none = /\bnone\b/.test(s) || /\bno (?:ongoing )?(?:credit|commitments?)\b/.test(s);
      if (none) return { has_commitment: false, total_monthly_payment_gbp: 0, total_balance_gbp: 0 };
      // Wizard summary uses "£X/month" for payments and "£Y balance" for balances.
      const monthly = [...text.matchAll(/£\s*([\d,]+)\s*(?:\/\s*month|per month|a month|monthly|pm)/gi)]
        .map((m) => parseFloat(m[1].replace(/,/g, "")));
      const balances = [...text.matchAll(/£\s*([\d,]+)\s*(?:balance|outstanding|owed|left)/gi)]
        .map((m) => parseFloat(m[1].replace(/,/g, "")));
      const sum = (arr: number[]) => Math.round(arr.reduce((a, b) => a + b, 0));
      return {
        has_commitment: true,
        ...(monthly.length ? { total_monthly_payment_gbp: sum(monthly) } : {}),
        ...(balances.length ? { total_balance_gbp: sum(balances) } : {}),
      };
    }
    case "adverse_credit": {
      const s = text.toLowerCase();
      const positive = /\b(yes|default|ccj|missed|bankrupt|iva|arrears|behind)\b/.test(s);
      const negative = /\b(no|none|never|nothing|clean|all good|nope)\b/.test(s);
      const adverse = /\byes\b/.test(s) || (positive && !negative);
      return { adverse_credit: adverse };
    }
    case "mortgage_purpose": {
      const purpose = parseMortgagePurpose(text);
      return purpose ? { purpose } : {};
    }
    case "property_price": {
      const n = parseMoneyFromText(text);
      return n ? { property_price_gbp: n } : {};
    }
    case "deposit": {
      const n = parseMoneyFromText(text);
      const pct = text.match(/(\d{1,2}(?:\.\d+)?)\s*(?:%|percent|per\s+cent)/i);
      return { ...(n ? { deposit_gbp: n } : {}), ...(pct ? { deposit_pct: parseFloat(pct[1]) } : {}) };
    }
    case "amount_owed": {
      const n = parseMoneyFromText(text);
      return n ? { amount_owed_gbp: n } : {};
    }
    case "equity_confirm":
      return {};
    case "mortgage_term": {
      const t = parseYears(text) ?? (text.match(/\b(\d{1,2})\b/) ? parseInt(text.match(/\b(\d{1,2})\b/)![1], 10) : null);
      return t ? { mortgage_term_years: t } : {};
    }
    case "property_type": {
      const s = text.toLowerCase();
      let property_type: string | undefined;
      if (/\bflat\b|\bapartment\b|\bmaisonette\b/.test(s)) property_type = "flat";
      else if (/\bterraced?\b/.test(s)) property_type = "terraced";
      else if (/\bsemi[- ]?detached\b|\bsemi\b/.test(s)) property_type = "semi-detached";
      else if (/\bdetached\b/.test(s)) property_type = "detached";
      else if (/\bbungalow\b/.test(s)) property_type = "bungalow";
      return property_type ? { property_type } : {};
    }
    case "mortgage_need": {
      const amounts = [...text.matchAll(/£\s*([\d,]+)/g)].map((m) => parseFloat(m[1].replace(/,/g, "")));
      const price = amounts[0] ? Math.round(amounts[0]) : parseMoneyFromText(text);
      const deposit = amounts[1] ? Math.round(amounts[1]) : undefined;
      const term = parseYears(text);
      const purpose = parseMortgagePurpose(text);
      let property_type: string | undefined;
      const s = text.toLowerCase();
      if (/\bflat\b|\bapartment\b/.test(s)) property_type = "flat";
      else if (/\bterraced\b/.test(s)) property_type = "terraced";
      else if (/\bsemi[- ]?detached\b/.test(s)) property_type = "semi-detached";
      else if (/\bdetached\b/.test(s)) property_type = "detached";
      return {
        ...(purpose ? { purpose } : {}),
        ...(price ? { property_price_gbp: price } : {}),
        ...(deposit ? { deposit_gbp: deposit } : {}),
        ...(term ? { mortgage_term_years: term } : {}),
        ...(property_type ? { property_type } : {}),
      };
    }
    default:
      return {};
  }
}

export type KeyFacts = {
  property_price_gbp?: number;
  deposit_gbp?: number;
  deposit_pct?: number;
  amount_owed_gbp?: number;
  equity_gbp?: number;
  loan_amount_gbp?: number;
  mortgage_term_years?: number;
  annual_income_gbp?: number;
  monthly_essentials_gbp?: number;
  monthly_credit_gbp?: number;
  credit_balance_gbp?: number;
  employment_status?: string;
  purpose?: string;
  property_type?: string;
  postcode?: string;
  address?: string;
  adverse_credit?: boolean;
};

/** Merge structured fields from all answers into one adviser-facing summary. */
export function mergeKeyFacts(
  answers: Array<{ field_key: string; structured_value?: Json | null; value?: string | null }>,
): KeyFacts {
  const facts: KeyFacts = {};
  for (const a of answers) {
    const structured =
      a.structured_value && typeof a.structured_value === "object" && !Array.isArray(a.structured_value)
        ? (a.structured_value as Record<string, unknown>)
        : extractStructuredFields(a.field_key, a.value ?? "");
    if (typeof structured.property_price_gbp === "number") facts.property_price_gbp = structured.property_price_gbp;
    if (typeof structured.deposit_gbp === "number") facts.deposit_gbp = structured.deposit_gbp;
    if (typeof structured.deposit_pct === "number") facts.deposit_pct = structured.deposit_pct;
    if (typeof structured.amount_owed_gbp === "number") facts.amount_owed_gbp = structured.amount_owed_gbp;
    if (typeof structured.mortgage_term_years === "number") facts.mortgage_term_years = structured.mortgage_term_years;
    if (typeof structured.annual_income_gbp === "number") facts.annual_income_gbp = structured.annual_income_gbp;
    if (typeof structured.monthly_essentials_gbp === "number") facts.monthly_essentials_gbp = structured.monthly_essentials_gbp;
    if (typeof structured.total_monthly_payment_gbp === "number") facts.monthly_credit_gbp = structured.total_monthly_payment_gbp;
    if (typeof structured.total_balance_gbp === "number") facts.credit_balance_gbp = structured.total_balance_gbp;
    if (typeof structured.employment_status === "string") facts.employment_status = structured.employment_status;
    if (typeof structured.purpose === "string") facts.purpose = structured.purpose;
    if (typeof structured.property_type === "string") facts.property_type = structured.property_type;
    if (typeof structured.postcode === "string") facts.postcode = structured.postcode;
    if (typeof structured.address === "string") facts.address = structured.address;
    if (typeof structured.adverse_credit === "boolean") facts.adverse_credit = structured.adverse_credit;
  }

  // Derive the deposit from a percentage if only a percentage was given.
  if (facts.deposit_gbp == null && facts.deposit_pct != null && facts.property_price_gbp != null) {
    facts.deposit_gbp = Math.round((facts.property_price_gbp * facts.deposit_pct) / 100);
  }

  const isRemortgage = (facts.purpose ?? "").toLowerCase().includes("remortgage");
  if (isRemortgage && facts.property_price_gbp != null && facts.amount_owed_gbp != null) {
    // Remortgage: equity = value − balance owed; the loan is the balance owed.
    facts.equity_gbp = Math.max(0, facts.property_price_gbp - facts.amount_owed_gbp);
    facts.loan_amount_gbp = facts.amount_owed_gbp;
  } else if (facts.property_price_gbp != null && facts.deposit_gbp != null) {
    // Purchase: loan = price − deposit.
    facts.loan_amount_gbp = Math.max(0, facts.property_price_gbp - facts.deposit_gbp);
  }
  return facts;
}

/** Loan = price − deposit, resolving a percentage deposit if needed. */
export function computeLoanAmount(
  priceGbp: number | null | undefined,
  depositGbp: number | null | undefined,
  depositPct: number | null | undefined,
): number | null {
  if (priceGbp == null) return null;
  let deposit = depositGbp ?? null;
  if (deposit == null && depositPct != null) deposit = Math.round((priceGbp * depositPct) / 100);
  if (deposit == null) return null;
  return Math.max(0, priceGbp - deposit);
}

export function formatGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n);
}
