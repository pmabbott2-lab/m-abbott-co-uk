export type RateAttribution = {
  sourceName: string;
  sourceUrl?: string;
  asOf: string;
};

export type MarketRatesSnapshot = {
  ok: true;
  asOf: string;
  baseRate: {
    label: string;
    ratePct: number;
    attribution: RateAttribution;
  };
  disclaimer: string;
};

const BOE_DEC_2025_URL =
  "https://www.bankofengland.co.uk/monetary-policy-summary-and-minutes/2025/december-2025";

const STATIC_DISCLAIMER =
  "Bank of England Bank Rate for reference only — not a mortgage quote or recommendation. " +
  "Your mortgage rate depends on product type, LTV, and lender criteria. MortgageEasy will confirm suitable products after advice.";

function envNum(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envStr(key: string, fallback: string): string {
  const raw = process.env[key]?.trim();
  return raw || fallback;
}

function officialBankOfEnglandBaseRate(): MarketRatesSnapshot["baseRate"] {
  const ratePct = envNum("MARKET_RATE_BOE_PCT", 3.75);
  const asOf = envStr("MARKET_RATE_BOE_AS_OF", "2025-12-17");
  return {
    label: "Bank of England Bank Rate",
    ratePct,
    attribution: {
      sourceName: "Bank of England — Monetary Policy Summary",
      sourceUrl: BOE_DEC_2025_URL,
      asOf,
    },
  };
}

export function fetchMarketRatesSnapshot(): Promise<MarketRatesSnapshot> {
  const asOf = new Date().toISOString().slice(0, 10);
  return Promise.resolve({
    ok: true,
    asOf,
    baseRate: officialBankOfEnglandBaseRate(),
    disclaimer: STATIC_DISCLAIMER,
  });
}

export const BANK_OF_ENGLAND_RATE_URL =
  "https://www.bankofengland.co.uk/monetary-policy/the-interest-rate-bank-rate";
