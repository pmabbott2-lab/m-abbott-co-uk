/**
 * Mortgage Easy earnings model. Formulas only: every rate and default is loaded at runtime
 * from the protected assumptions store, never hard-coded here.
 */

export const CASE_TYPES = [
  { key: "remortgage", label: "Remortgage" },
  { key: "purchase", label: "Purchase" },
];

export const SCENARIOS = [
  { key: "base", label: "Base" },
  { key: "conservative", label: "Conservative" },
  { key: "ambitious", label: "Ambitious" },
];

export const RATE_FIELDS = [
  { key: "procRatePct", label: "Procuration fee paid by lender", hint: "% of loan", unit: "%", min: 0, max: 5, step: 0.005 },
  { key: "procRetainedPct", label: "Share of procuration received after HLP", hint: "HLP's share is already removed here", unit: "%", min: 0, max: 100, step: 0.5 },
  { key: "protectionMultiplePct", label: "Protection commission", hint: "% of annual premium, indemnity, as received", unit: "%", min: 0, max: 500, step: 1 },
  { key: "giCommissionPct", label: "GI commission", hint: "% of annual premium, as received", unit: "%", min: 0, max: 100, step: 1 },
  { key: "protectionNtuPct", label: "Protection and GI NTU after completion", hint: "Mortgage completes but the policy never starts", unit: "%", min: 0, max: 100, step: 0.5 },
  { key: "cancellationPct", label: "Protection and GI cancellations", hint: "Policies lost after starting (clawback)", unit: "%", min: 0, max: 100, step: 0.5 },
  { key: "adviserMortgagePct", label: "Adviser commission: procuration and broker fees", hint: "% of what Mortgage Easy receives", unit: "%", min: 0, max: 100, step: 0.5, commission: true },
  { key: "adviserIntroPct", label: "Adviser commission: own-customer introductions", hint: "Extra % of procuration and fees on the adviser's own customers", unit: "%", min: 0, max: 100, step: 0.5, commission: true },
  { key: "adviserProtectionPct", label: "Adviser commission: protection and GI", hint: "% of what Mortgage Easy receives", unit: "%", min: 0, max: 100, step: 0.5, commission: true },
  { key: "introducerPct", label: "External introducer commission", hint: "% of procuration and fees on introduced customers", unit: "%", min: 0, max: 100, step: 0.5, commission: true },
];

export const COMMISSION_FIELDS = RATE_FIELDS.filter((f) => f.commission);
export const BUSINESS_RATE_FIELDS = RATE_FIELDS.filter((f) => !f.commission);

/** Appointments are entered per week; a year has 52 weeks less holiday, spread evenly over 12 months. */
export const HOLIDAY_WEEKS = 5;
export const WORKING_WEEKS = 52 - HOLIDAY_WEEKS;
export const WEEKS_PER_MONTH = WORKING_WEEKS / 12;
/** Introducer leads keep arriving through adviser holidays, so they use the full 52-week year. */
export const LEAD_WEEKS = 52;
export const LEAD_WEEKS_PER_MONTH = LEAD_WEEKS / 12;

export const CASE_FIELDS = [
  { key: "seenOwnWeek", label: "Appointments seen per week: own customers", hint: "Per week", unit: "count", min: 0, max: 150, step: 1 },
  { key: "seenIntroducedWeek", label: "Appointments seen per week: introduced", hint: "Per week", unit: "count", min: 0, max: 150, step: 1 },
  { key: "conversionPct", label: "Seen to written", hint: "Same rate for both sources", unit: "%", min: 0, max: 100, step: 1 },
  { key: "lapsePct", label: "NTU rate", hint: "Written but mortgage not completed; protection and GI fall away too", unit: "%", min: 0, max: 100, step: 1 },
  { key: "avgLoan", label: "Average mortgage", unit: "gbp", min: 0, max: 5000000, step: 5000 },
  { key: "brokerFee", label: "Broker fee", hint: "Taken at application, not refunded", unit: "gbp", min: 0, max: 10000, step: 1 },
  { key: "feeCollectedPct", label: "Written cases paying a broker fee", unit: "%", min: 0, max: 100, step: 1 },
  { key: "protectionConvPct", label: "Written cases with protection", unit: "%", min: 0, max: 100, step: 1 },
  { key: "protectionMonthlyPremium", label: "Average monthly protection premium", unit: "gbp", min: 0, max: 5000, step: 1 },
  { key: "giConvPct", label: "Written cases with GI", unit: "%", min: 0, max: 100, step: 1 },
  { key: "giAnnualPremium", label: "Average annual GI premium", hint: "Leave at 0 until known", unit: "gbp", min: 0, max: 20000, step: 5 },
  { key: "lagMonths", label: "Months from written to paid", hint: "Procuration, protection and GI", unit: "months", min: 1, max: 6, step: 1, integer: true },
];

export const SEEN_FIELDS = CASE_FIELDS.filter((f) => f.key === "seenOwnWeek" || f.key === "seenIntroducedWeek");
const LEGACY_MONTHLY_SEEN = { seenOwnWeek: "seenOwn", seenIntroducedWeek: "seenIntroduced" };

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const pct = (v) => num(v) / 100;

export function lagOf(caseInputs) {
  const lag = Math.round(num(caseInputs && caseInputs.lagMonths));
  return Math.min(6, Math.max(1, lag || 1));
}

/** Splits one bucket of money received between the adviser, the external introducer and Mortgage Easy. */
export function allocate(bucket, rates) {
  const potOwn = num(bucket.procOwn) + num(bucket.feesOwn);
  const potIntro = num(bucket.procIntro) + num(bucket.feesIntro);
  const policies = num(bucket.protection) + num(bucket.gi);
  const adviserMortgage = pct(rates.adviserMortgagePct) * (potOwn + potIntro);
  const adviserIntro = pct(rates.adviserIntroPct) * potOwn;
  const adviserProtection = pct(rates.adviserProtectionPct) * policies;
  const adviser = adviserMortgage + adviserIntro + adviserProtection;
  const introducer = pct(rates.introducerPct) * potIntro;
  const total = potOwn + potIntro + policies;
  return { adviserMortgage, adviserIntro, adviserProtection, adviser, introducer, me: total - adviser - introducer, total };
}

function policyLine(written, convPct, lapsePct, ntuPct, perPolicy, cancellationPct) {
  const sold = written * pct(convPct);
  const completed = sold * (1 - pct(lapsePct));
  const onRisk = completed * (1 - pct(ntuPct));
  const gross = onRisk * perPolicy;
  const cancelled = gross * pct(cancellationPct);
  return { sold, completed, onRisk, perPolicy, gross, cancelled, net: gross - cancelled };
}

/** One month of activity for one case type, in steady state (before timing). */
export function computeCase(c, rates) {
  const seenOwnWeek = num(c.seenOwnWeek);
  const seenIntroWeek = num(c.seenIntroducedWeek);
  const seenOwn = seenOwnWeek * WEEKS_PER_MONTH;
  const seenIntro = seenIntroWeek * WEEKS_PER_MONTH;
  const conv = pct(c.conversionPct);
  const keep = 1 - pct(c.lapsePct);
  const writtenOwn = seenOwn * conv;
  const writtenIntro = seenIntro * conv;
  const completionsOwn = writtenOwn * keep;
  const completionsIntro = writtenIntro * keep;
  const avgLoan = num(c.avgLoan);
  const procRate = pct(rates.procRatePct) * pct(rates.procRetainedPct);
  const procOwn = completionsOwn * avgLoan * procRate;
  const procIntro = completionsIntro * avgLoan * procRate;
  const feeTake = pct(c.feeCollectedPct) * num(c.brokerFee);
  const feesOwn = writtenOwn * feeTake;
  const feesIntro = writtenIntro * feeTake;
  const written = writtenOwn + writtenIntro;
  const completions = completionsOwn + completionsIntro;

  const protection = policyLine(
    written, c.protectionConvPct, c.lapsePct, rates.protectionNtuPct,
    num(c.protectionMonthlyPremium) * 12 * pct(rates.protectionMultiplePct), rates.cancellationPct,
  );
  const gi = policyLine(
    written, c.giConvPct, c.lapsePct, rates.protectionNtuPct,
    num(c.giAnnualPremium) * pct(rates.giCommissionPct), rates.cancellationPct,
  );

  const atWritten = allocate({ feesOwn, feesIntro }, rates);
  const afterLag = allocate({ procOwn, procIntro, protection: protection.net, gi: gi.net }, rates);
  const sum = (k) => atWritten[k] + afterLag[k];

  return {
    seenOwnWeek, seenIntroWeek, seenWeek: seenOwnWeek + seenIntroWeek,
    seenOwn, seenIntro, seen: seenOwn + seenIntro,
    writtenOwn, writtenIntro, written,
    completionsOwn, completionsIntro, completions,
    lent: completions * avgLoan,
    procRate,
    procOwn, procIntro, proc: procOwn + procIntro,
    hlpMemo: completions * avgLoan * pct(rates.procRatePct) * (1 - pct(rates.procRetainedPct)),
    feeCases: written * pct(c.feeCollectedPct),
    feesOwn, feesIntro, fees: feesOwn + feesIntro,
    protection, gi,
    atWritten, afterLag,
    adviserMortgage: sum("adviserMortgage"),
    adviserIntro: sum("adviserIntro"),
    adviserProtection: sum("adviserProtection"),
    adviser: sum("adviser"),
    introducer: sum("introducer"),
    me: sum("me"),
    total: sum("total"),
    lag: lagOf(c),
  };
}

function addInto(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (typeof v === "number") target[k] = (target[k] || 0) + v;
    else if (v && typeof v === "object") addInto((target[k] = target[k] || {}), v);
  }
  return target;
}

/** Steady-state month for a whole adviser plan: each case type plus the combined total. */
export function computeMonth(scenario, rates) {
  const byType = {};
  const total = {};
  for (const { key } of CASE_TYPES) {
    byType[key] = computeCase((scenario && scenario[key]) || {}, rates);
    addInto(total, byType[key]);
  }
  delete total.lag;
  delete total.procRate;
  delete total.protection.perPolicy;
  delete total.gi.perPolicy;
  return { byType, total };
}

const emptyMonth = () => ({ written: 0, completions: 0, fees: 0, proc: 0, protection: 0, gi: 0, total: 0, adviser: 0, introducer: 0, me: 0 });

/**
 * Month-by-month cash received. monthInputs[i] is the scenario for month i. Broker fees land in the
 * month written; procuration, protection and GI land `lag` months later and drop off the horizon.
 */
export function forecast(monthInputs, rates) {
  const months = monthInputs.map(emptyMonth);
  monthInputs.forEach((scenario, m) => {
    for (const { key } of CASE_TYPES) {
      const r = computeCase((scenario && scenario[key]) || {}, rates);
      const now = months[m];
      now.written += r.written;
      now.fees += r.fees;
      now.total += r.atWritten.total;
      now.adviser += r.atWritten.adviser;
      now.introducer += r.atWritten.introducer;
      now.me += r.atWritten.me;
      const paid = months[m + r.lag];
      if (!paid) continue;
      paid.completions += r.completions;
      paid.proc += r.proc;
      paid.protection += r.protection.net;
      paid.gi += r.gi.net;
      paid.total += r.afterLag.total;
      paid.adviser += r.afterLag.adviser;
      paid.introducer += r.afterLag.introducer;
      paid.me += r.afterLag.me;
    }
  });
  return months.map((m, i) => ({ month: i + 1, ...m }));
}

export function sumMonths(months) {
  const out = emptyMonth();
  for (const m of months) for (const k of Object.keys(out)) out[k] += m[k];
  return out;
}

/** Year 1 uses the scenario as entered; years 2 and 3 replace only the appointments seen. */
export function yearScenario(scenario, seenOverride) {
  const out = {};
  for (const { key } of CASE_TYPES) {
    out[key] = { ...((scenario && scenario[key]) || {}) };
    const o = seenOverride && seenOverride[key];
    if (o) for (const f of SEEN_FIELDS) if (o[f.key] !== undefined && o[f.key] !== null && o[f.key] !== "") out[key][f.key] = o[f.key];
  }
  return out;
}

export function threeYear(scenario, years, rates) {
  const y1 = yearScenario(scenario, null);
  const y2 = yearScenario(scenario, years && years.y2);
  const y3 = yearScenario(scenario, years && years.y3);
  const inputs = [...Array(12).fill(y1), ...Array(12).fill(y2), ...Array(12).fill(y3)];
  const months = forecast(inputs, rates);
  return {
    months,
    years: [0, 1, 2].map((y) => ({ year: y + 1, ...sumMonths(months.slice(y * 12, y * 12 + 12)) })),
  };
}

/**
 * Activity needed for an annual target. Every line scales in proportion to appointments seen,
 * so the current mix is multiplied by one factor (steady state and first-year-with-lag versions).
 */
export function reverseTarget(scenario, rates, who, annualTarget) {
  const target = num(annualTarget);
  const steady = computeMonth(scenario, rates).total;
  const firstYear = sumMonths(forecast(Array(12).fill(scenario), rates));
  const steadyAnnual = steady[who] * 12;
  const firstAnnual = firstYear[who];
  const factor = steadyAnnual > 0 ? target / steadyAnnual : null;
  const firstYearFactor = firstAnnual > 0 ? target / firstAnnual : null;
  const scale = (f) => {
    if (f === null) return null;
    const out = {};
    for (const { key } of CASE_TYPES) {
      const c = (scenario && scenario[key]) || {};
      out[key] = { seenOwnWeek: num(c.seenOwnWeek) * f, seenIntroducedWeek: num(c.seenIntroducedWeek) * f };
    }
    out.totalSeenWeek = steady.seenWeek * f;
    return out;
  };
  return {
    who, target, steadyAnnual, firstAnnual,
    perSeen: steady.seen > 0 ? steady[who] / steady.seen : null,
    factor, firstYearFactor,
    steadySeen: scale(factor),
    firstYearSeen: scale(firstYearFactor),
  };
}

function checkNumber(field, value, where) {
  if (value === undefined || value === null || value === "") return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${where}${field.label} must be a number`);
  if (n < field.min || n > field.max) throw new Error(`${where}${field.label} must be between ${field.min} and ${field.max}`);
  return field.integer ? Math.round(n) : n;
}

export function cleanRates(input) {
  const out = {};
  for (const f of RATE_FIELDS) out[f.key] = checkNumber(f, input && input[f.key], "");
  return out;
}

/** Plans saved before appointments were weekly hold monthly counts; convert them on load. */
function weeklySeen(input) {
  if (!input || typeof input !== "object") return input;
  const out = { ...input };
  for (const [weekKey, monthKey] of Object.entries(LEGACY_MONTHLY_SEEN)) {
    const old = out[monthKey];
    delete out[monthKey];
    if ((out[weekKey] === undefined || out[weekKey] === null || out[weekKey] === "") && old !== undefined && old !== null && old !== "") {
      out[weekKey] = Number.isFinite(Number(old)) ? Number(old) / WEEKS_PER_MONTH : old;
    }
  }
  return out;
}

export function cleanCase(raw, where = "") {
  const input = weeklySeen(raw);
  const out = {};
  for (const f of CASE_FIELDS) out[f.key] = checkNumber(f, input && input[f.key], where);
  if (out.lagMonths < 1) out.lagMonths = 1;
  return out;
}

export function cleanScenario(input, where = "") {
  const out = {};
  for (const t of CASE_TYPES) out[t.key] = cleanCase(input && input[t.key], `${where}${t.label}: `);
  return out;
}

export function cleanSeenOverride(input, where = "") {
  if (!input || typeof input !== "object") return null;
  const out = {};
  for (const t of CASE_TYPES) {
    out[t.key] = {};
    const caseInput = weeklySeen(input[t.key]);
    for (const f of SEEN_FIELDS) {
      const v = caseInput && caseInput[f.key];
      if (v !== undefined && v !== null && v !== "") out[t.key][f.key] = checkNumber(f, v, `${where}${t.label}: `);
    }
  }
  return out;
}

const cleanText = (v, max) => String(v === undefined || v === null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);

/** Calendar month a plan starts: { year, month } with month 1 to 12, or null if not set. */
export function cleanStart(input) {
  if (!input || typeof input !== "object") return null;
  const year = Number(input.year);
  const month = Number(input.month);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new Error("Start year must be between 2020 and 2100");
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error("Start month must be between 1 and 12");
  return { year, month };
}

/** Plans carry their own rates (each adviser or introducer can be on different terms). */
export function cleanPlan(input) {
  if (!input || typeof input !== "object") throw new Error("Plan is missing");
  const name = cleanText(input.name, 80);
  if (!name) throw new Error("Plan name is required");
  const rates = input.rates && typeof input.rates === "object" ? cleanRates(input.rates) : null;
  const notes = cleanText(input.notes, 2000);
  const start = cleanStart(input.start);
  if (input.kind === "introducer") {
    return { kind: "introducer", name, introducer: cleanText(input.introducer, 80), start, notes, inputs: cleanIntroInputs(input.inputs), rates };
  }
  const scenarios = {};
  const years = {};
  for (const s of SCENARIOS) {
    scenarios[s.key] = cleanScenario(input.scenarios && input.scenarios[s.key], `${s.label} scenario, `);
    const y = input.years && input.years[s.key];
    years[s.key] = {
      y2: cleanSeenOverride(y && y.y2, `${s.label} year 2, `),
      y3: cleanSeenOverride(y && y.y3, `${s.label} year 3, `),
    };
  }
  return { kind: "adviser", name, adviser: cleanText(input.adviser, 80), supervisor: cleanText(input.supervisor, 80), start, notes, scenarios, years, rates };
}

export function blankScenario() {
  const out = {};
  for (const t of CASE_TYPES) {
    out[t.key] = {};
    for (const f of CASE_FIELDS) out[t.key][f.key] = f.key === "lagMonths" ? 1 : 0;
  }
  return out;
}

/* ---------- introducer plans ---------- */

export const INTRO_FIELDS = [
  { key: "leadsWeek", label: "Leads sent per week", unit: "count", min: 0, max: 500, step: 1 },
  { key: "showRatePct", label: "Show rate", hint: "Leads who attend an appointment", unit: "%", min: 0, max: 100, step: 1 },
  { key: "signUpPct", label: "Seen to sign-up", unit: "%", min: 0, max: 100, step: 1 },
  { key: "completionPct", label: "Sign-up to completion", unit: "%", min: 0, max: 100, step: 1 },
  { key: "avgLoan", label: "Average mortgage", unit: "gbp", min: 0, max: 5000000, step: 5000 },
  { key: "brokerFee", label: "Broker fee", hint: "Purchase broker fee, taken at sign-up, not refunded", unit: "gbp", min: 0, max: 10000, step: 1 },
  { key: "lagMonths", label: "Months from sign-up to completion", hint: "When procuration is paid", unit: "months", min: 1, max: 6, step: 1, integer: true },
  { key: "renewalRetainedPct", label: "Completions retained at renewal", unit: "%", min: 0, max: 100, step: 1 },
  { key: "renewal2yPct", label: "Retained cases on 2-year terms", hint: "The rest are on 5-year terms", unit: "%", min: 0, max: 100, step: 1 },
  { key: "renewalFee", label: "Renewal fee", hint: "Per renewal", unit: "gbp", min: 0, max: 10000, step: 1 },
];

/** Months after completion that each product term comes up for renewal. */
export const RENEWAL_TERMS = [{ key: "renewals2y", months: 24, label: "2-year" }, { key: "renewals5y", months: 60, label: "5-year" }];

const sumAlloc = (...parts) => {
  const out = {};
  for (const p of parts) for (const [k, v] of Object.entries(p)) out[k] = (out[k] || 0) + v;
  return out;
};

/**
 * One steady month of leads from an introducer. Every lead counts as introduced business, so the
 * adviser earns the procuration-and-fees rate and the introducer earns the introducer rate.
 * Renewal figures are what each month's completions produce when they come up for renewal.
 */
export function computeIntroducer(inp, rates) {
  const c = inp || {};
  const leadsWeek = num(c.leadsWeek);
  const leads = leadsWeek * LEAD_WEEKS_PER_MONTH;
  const seen = leads * pct(c.showRatePct);
  const signUps = seen * pct(c.signUpPct);
  const completions = signUps * pct(c.completionPct);
  const avgLoan = num(c.avgLoan);
  const procRate = pct(rates.procRatePct) * pct(rates.procRetainedPct);
  const proc = completions * avgLoan * procRate;
  const fees = signUps * num(c.brokerFee);
  const renewals = completions * pct(c.renewalRetainedPct);
  const renewals2y = renewals * pct(c.renewal2yPct);
  const renewals5y = renewals - renewals2y;
  const renewalFees = renewals * num(c.renewalFee);
  const atSignUp = allocate({ feesIntro: fees }, rates);
  const atCompletion = allocate({ procIntro: proc }, rates);
  const newBusiness = sumAlloc(atSignUp, atCompletion);
  return {
    leadsWeek, seenWeek: leadsWeek * pct(c.showRatePct),
    leads, seen, signUps, completions,
    lent: completions * avgLoan, procRate, proc, fees,
    hlpMemo: completions * avgLoan * pct(rates.procRatePct) * (1 - pct(rates.procRetainedPct)),
    renewals, renewals2y, renewals5y, renewalFees,
    atSignUp, atCompletion, newBusiness,
    renewal: allocate({ feesIntro: renewalFees }, rates),
    lag: lagOf(c),
  };
}

/** Month by month from a standing start: fees at sign-up, procuration at completion, renewals 2 and 5 years after completion. */
export function introducerForecast(inp, rates, months) {
  const r = computeIntroducer(inp, rates);
  const out = Array.from({ length: months }, (_, i) => ({
    month: i + 1, signUps: 0, completions: 0, renewals: 0,
    total: 0, adviser: 0, introducer: 0, me: 0, renewalTotal: 0, renewalAdviser: 0, renewalIntroducer: 0, renewalMe: 0,
  }));
  const add = (o, alloc, share = 1) => {
    o.total += alloc.total * share;
    o.adviser += alloc.adviser * share;
    o.introducer += alloc.introducer * share;
    o.me += alloc.me * share;
  };
  for (let m = 0; m < months; m++) {
    out[m].signUps += r.signUps;
    add(out[m], r.atSignUp);
    const done = m + r.lag;
    if (!out[done]) continue;
    out[done].completions += r.completions;
    add(out[done], r.atCompletion);
    for (const term of RENEWAL_TERMS) {
      const o = out[done + term.months];
      if (!o || !(r.renewals > 0)) continue;
      const share = r[term.key] / r.renewals;
      o.renewals += r[term.key];
      add(o, r.renewal, share);
      o.renewalTotal += r.renewal.total * share;
      o.renewalAdviser += r.renewal.adviser * share;
      o.renewalIntroducer += r.renewal.introducer * share;
      o.renewalMe += r.renewal.me * share;
    }
  }
  return out;
}

export function sumByYear(months) {
  const years = [];
  months.forEach((m, i) => {
    const y = Math.floor(i / 12);
    const into = (years[y] = years[y] || { year: y + 1 });
    for (const [k, v] of Object.entries(m)) if (k !== "month") into[k] = (into[k] || 0) + v;
  });
  return years;
}

export function cleanIntroInputs(input, where = "") {
  const out = {};
  for (const f of INTRO_FIELDS) out[f.key] = checkNumber(f, input && input[f.key], where);
  if (out.lagMonths < 1) out.lagMonths = 1;
  return out;
}

export function blankIntroducer() {
  const out = {};
  for (const f of INTRO_FIELDS) out[f.key] = f.key === "lagMonths" ? 1 : 0;
  return out;
}

/* ---------- start month, calendar years and plan summaries ---------- */

export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mar 2027" for the month `offset` months after the start (offset 0 = the start month). */
export function monthLabel(start, offset = 0) {
  const t = start.year * 12 + start.month - 1 + offset;
  return `${MONTH_NAMES[t % 12]} ${Math.floor(t / 12)}`;
}

/** Forecast length needed to reach the end of calendar `year` from `start` (never less than 12). */
export function monthsToYearEnd(start, year) {
  return Math.max(12, (year - start.year) * 12 + 13 - start.month);
}

/** Calendar `year` (Jan to Dec) from a forecast whose first month is `start`. Months outside the forecast are zero. */
export function calendarSlice(months, start, year) {
  const keys = months.length ? Object.keys(months[0]).filter((k) => k !== "month") : [];
  return MONTH_NAMES.map((label, i) => {
    const idx = (year - start.year) * 12 + i - (start.month - 1);
    const src = idx >= 0 ? months[idx] : undefined;
    const out = { label, planMonth: src ? idx + 1 : null };
    for (const k of keys) out[k] = src ? num(src[k]) : 0;
    return out;
  });
}

/** Adds every numeric field across months. */
export function sumAll(months) {
  const out = {};
  for (const m of months) for (const [k, v] of Object.entries(m)) if (k !== "month" && k !== "planMonth" && typeof v === "number") out[k] = (out[k] || 0) + v;
  return out;
}

/** Adviser plan month by month: year 1 as entered, then the year 2 and year 3 appointments, year 3 carrying on after month 36. */
export function adviserForecast(plan, months, scenarioKey = "base") {
  const sc = plan.scenarios[scenarioKey];
  const y = (plan.years && plan.years[scenarioKey]) || {};
  const byYear = [yearScenario(sc, null), yearScenario(sc, y.y2), yearScenario(sc, y.y3)];
  return forecast(Array.from({ length: months }, (_, i) => byYear[Math.min(2, Math.floor(i / 12))]), plan.rates);
}

const SPLIT_KEYS = ["total", "adviser", "introducer", "me"];
const splitOf = (o) => Object.fromEntries(SPLIT_KEYS.map((k) => [k, num(o && o[k])]));

/**
 * Headline figures for a saved plan (adviser plans use the Base scenario): one steady month, the first
 * 12 months from the start, and calendar `year`. Introducer plans also give the steady renewal month.
 */
export function planFigures(plan, start, year) {
  const horizon = monthsToYearEnd(start, year);
  let months;
  let steady;
  let renewal = null;
  if (plan.kind === "introducer") {
    const r = computeIntroducer(plan.inputs, plan.rates);
    months = introducerForecast(plan.inputs, plan.rates, horizon);
    steady = splitOf(r.newBusiness);
    renewal = splitOf(r.renewal);
  } else {
    months = adviserForecast(plan, horizon);
    steady = splitOf(computeMonth(plan.scenarios.base, plan.rates).total);
  }
  const calendarMonths = calendarSlice(months, start, year);
  return { steady, renewal, first12: sumAll(months.slice(0, 12)), calendar: sumAll(calendarMonths), calendarMonths };
}
