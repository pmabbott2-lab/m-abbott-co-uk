/**
 * Same-origin Bank of England Bank Rate for the site (GET /api/bank-rate).
 * Source: Bank of England database, series IUDBEDR (official Bank Rate, daily).
 * Falls back to the Hub market-rates endpoint (server-side, so no CORS) if the BoE feed fails.
 * Response shape matches the Hub endpoint so market-rates-strip.js can use either.
 */
const SERIES_URL =
  "https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp" +
  "?csv.x=yes&Datefrom=01/Jan/2020&Dateto=now&SeriesCodes=IUDBEDR&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N";
const SOURCE_PAGE = "https://www.bankofengland.co.uk/monetary-policy/the-interest-rate-bank-rate";
const HUB_FALLBACK = "https://mymortgagehub.uk/api/calculator/market-rates";
const UPSTREAM_CACHE_SECONDS = 60 * 60;
const BROWSER_CACHE_SECONDS = 30 * 60;

const DISCLAIMER =
  "Bank of England Bank Rate for reference only — not a mortgage quote or recommendation. " +
  "Your mortgage rate depends on product type, LTV, and lender criteria. " +
  "MortgageEasy will confirm suitable products after advice.";

const MONTHS = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function todayLondon() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}

function parseSeries(csv) {
  const rows = [];
  for (const line of csv.split(/\r?\n/)) {
    const m = /^(\d{2}) ([A-Z][a-z]{2}) (\d{4}),\s*(-?\d+(?:\.\d+)?)$/.exec(line.trim());
    if (m && MONTHS[m[2]]) {
      rows.push({ date: `${m[3]}-${MONTHS[m[2]]}-${m[1]}`, rate: Number(m[4]) });
    }
  }
  if (!rows.length) return null;
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const latest = rows[rows.length - 1];
  let since = latest.date;
  for (let i = rows.length - 1; i >= 0 && rows[i].rate === latest.rate; i--) since = rows[i].date;
  return { ratePct: latest.rate, asOf: latest.date, since };
}

async function fromBankOfEngland() {
  const res = await fetch(SERIES_URL, {
    headers: { Accept: "text/csv,application/csv,*/*" },
    cf: { cacheTtl: UPSTREAM_CACHE_SECONDS, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`BoE ${res.status}`);
  const parsed = parseSeries(await res.text());
  if (!parsed || !Number.isFinite(parsed.ratePct)) throw new Error("BoE series unreadable");
  return {
    ok: true,
    asOf: todayLondon(),
    baseRate: {
      label: "Bank of England Bank Rate",
      ratePct: parsed.ratePct,
      effectiveFrom: parsed.since,
      attribution: { sourceName: "Bank of England", sourceUrl: SOURCE_PAGE, asOf: parsed.asOf },
    },
    disclaimer: DISCLAIMER,
  };
}

async function fromHub() {
  const res = await fetch(HUB_FALLBACK, { cf: { cacheTtl: UPSTREAM_CACHE_SECONDS } });
  if (!res.ok) throw new Error(`Hub ${res.status}`);
  const data = await res.json();
  if (!data || !data.ok || !data.baseRate || !Number.isFinite(data.baseRate.ratePct)) {
    throw new Error("Hub response unusable");
  }
  return data;
}

function json(body, status, maxAge) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    },
  });
}

export async function onRequestGet() {
  try {
    return json(await fromBankOfEngland(), 200, BROWSER_CACHE_SECONDS);
  } catch (_boeError) {
    try {
      return json(await fromHub(), 200, BROWSER_CACHE_SECONDS);
    } catch (_hubError) {
      return json({ ok: false, error: "Bank Rate unavailable" }, 502, 0);
    }
  }
}
