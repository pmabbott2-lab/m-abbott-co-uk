// Formula tests with made-up round-number rates. Real assumptions stay out of git; the worked
// example against real defaults lives in admin-private.local/ (gitignored).
import test from "node:test";
import assert from "node:assert/strict";
import {
  computeCase, computeMonth, forecast, sumMonths, threeYear, reverseTarget,
  cleanRates, cleanPlan, cleanScenario, blankScenario, WORKING_WEEKS, WEEKS_PER_MONTH, LEAD_WEEKS_PER_MONTH,
  computeIntroducer, introducerForecast, sumByYear,
  cleanStart, monthLabel, monthsToYearEnd, calendarSlice, sumAll, adviserForecast, planFigures,
} from "../../mortgage-hub-website/admin/model.js";

const perWeek = (monthly) => monthly / WEEKS_PER_MONTH;

const rates = {
  procRatePct: 1, procRetainedPct: 50, protectionMultiplePct: 100, giCommissionPct: 100,
  protectionNtuPct: 50, cancellationPct: 50,
  adviserMortgagePct: 50, adviserIntroPct: 10, adviserProtectionPct: 60, introducerPct: 10,
};

const remortgage = {
  seenOwnWeek: perWeek(10), seenIntroducedWeek: perWeek(10), conversionPct: 50, lapsePct: 20, avgLoan: 100000,
  brokerFee: 100, feeCollectedPct: 50, protectionConvPct: 40, protectionMonthlyPremium: 10,
  giConvPct: 20, giAnnualPremium: 100, lagMonths: 1,
};
const scenario = { remortgage, purchase: blankScenario().purchase };

const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);

test("weekly appointments allow for 5 weeks' holiday", () => {
  assert.equal(WORKING_WEEKS, 47);
  const r = computeCase({ seenOwnWeek: 3, seenIntroducedWeek: 0 }, rates);
  close(r.seenOwn, 3 * 47 / 12, "monthly seen");
  close(r.seenOwn * 12, 141, "yearly seen = 3 a week x 47 weeks");
  close(r.seenWeek, 3, "weekly kept");
});

test("plans saved with monthly appointments convert to weekly", () => {
  const sc = cleanScenario({ remortgage: { seenOwn: 47, seenIntroduced: 0 }, purchase: { seenOwnWeek: 2, seenOwn: 99 } });
  close(sc.remortgage.seenOwnWeek, 12, "47 a month = 12 a week");
  assert.equal(sc.remortgage.seenOwn, undefined);
  assert.equal(sc.purchase.seenOwnWeek, 2, "weekly value wins over a stale monthly one");
});

test("funnel, procuration, fees", () => {
  const r = computeCase(remortgage, rates);
  close(r.written, 10, "written");
  close(r.completions, 8, "completions");
  close(r.procOwn, 2000, "proc own");
  close(r.procIntro, 2000, "proc intro");
  close(r.fees, 500, "fees on written cases, not completions");
  close(r.hlpMemo, 4000, "HLP memo line");
});

test("protection and GI pass through lapse, NTU and cancellation", () => {
  const r = computeCase(remortgage, rates);
  close(r.protection.sold, 4, "sold");
  close(r.protection.completed, 3.2, "mortgage lapse");
  close(r.protection.onRisk, 1.6, "NTU");
  close(r.protection.perPolicy, 120, "monthly x 12 x multiple");
  close(r.protection.net, 96, "after cancellation");
  close(r.gi.net, 40, "GI");
});

test("allocation between adviser, introducer and Mortgage Easy", () => {
  const r = computeCase(remortgage, rates);
  close(r.adviserMortgage, 2250, "adviser on proc and fees");
  close(r.adviserIntro, 225, "adviser on own customers");
  close(r.adviserProtection, 81.6, "adviser on protection and GI");
  close(r.adviser, 2556.6, "adviser");
  close(r.introducer, 225, "introducer");
  close(r.total, 4636, "total");
  close(r.me, 1854.4, "Mortgage Easy");
  close(r.adviser + r.introducer + r.me, r.total, "no double counting");
});

test("timing: fees in written month, the rest after the lag", () => {
  const months = forecast(Array(3).fill(scenario), rates);
  close(months[0].total, 500, "month 1 fees only");
  close(months[0].adviser, 275, "month 1 adviser");
  close(months[0].me, 200, "month 1 Mortgage Easy");
  close(months[1].total, 4636, "month 2 full");
  close(sumMonths(months).total, 9772, "three months");
  const lagged = forecast(Array(3).fill({ ...scenario, remortgage: { ...remortgage, lagMonths: 6 } }), rates);
  close(sumMonths(lagged).proc, 0, "income beyond the horizon is not counted");
});

test("three-year view uses year 2 and 3 appointment overrides", () => {
  const override = { remortgage: { seenOwnWeek: perWeek(20) } };
  const res = threeYear(scenario, { y2: override, y3: override }, rates);
  const y2Steady = computeMonth({ ...scenario, remortgage: { ...remortgage, seenOwnWeek: perWeek(20) } }, rates).total.total;
  close(res.years[0].total, 500 + 11 * 4636, "year 1");
  close(res.years[2].total, 12 * y2Steady, "year 3 steady at year 2 activity");
});

test("reverse target scales the current mix", () => {
  const res = reverseTarget(scenario, rates, "me", 1854.4 * 12 * 2);
  close(res.factor, 2, "factor");
  close(res.steadySeen.remortgage.seenOwnWeek, perWeek(20), "own seen per week");
  close(res.steadySeen.totalSeenWeek, perWeek(40), "total seen per week");
  close(res.perSeen, 1854.4 / 20, "per seen");
});

test("plans keep their own rates; plans without rates stay null for the page to fill", () => {
  const a = cleanPlan({ name: "A", rates: { ...rates, adviserMortgagePct: 40 } });
  const b = cleanPlan({ name: "B", rates: { ...rates, adviserMortgagePct: 55 } });
  assert.equal(a.rates.adviserMortgagePct, 40);
  assert.equal(b.rates.adviserMortgagePct, 55);
  assert.equal(cleanPlan({ name: "Old" }).rates, null);
  assert.equal(cleanPlan({ name: "A" }).kind, "adviser");
  assert.throws(() => cleanPlan({ name: "X", rates: { introducerPct: 120 } }));
});

const introInputs = {
  leadsWeek: 10 / LEAD_WEEKS_PER_MONTH, showRatePct: 50, signUpPct: 80, completionPct: 50, avgLoan: 100000, brokerFee: 100,
  lagMonths: 2, renewalRetainedPct: 50, renewal2yPct: 25, renewalFee: 10,
};

test("introducer funnel, income split and renewals", () => {
  const r = computeIntroducer(introInputs, rates);
  close(r.leads, 10, "leads per month");
  close(computeIntroducer({ ...introInputs, leadsWeek: 3 }, rates).leads * 12, 156, "yearly leads = 3 a week x 52 weeks");
  close(r.seen, 5, "seen");
  close(r.signUps, 4, "sign-ups");
  close(r.completions, 2, "completions");
  close(r.fees, 400, "fee on every sign-up");
  close(r.proc, 1000, "procuration on completions");
  close(r.newBusiness.adviser, 700, "adviser 50% of fees and procuration, no own-customer extra");
  close(r.newBusiness.introducer, 140, "introducer 10%");
  close(r.newBusiness.me, 560, "Mortgage Easy remainder");
  close(r.renewals, 1, "retained from completions");
  close(r.renewals2y, 0.25, "2-year share");
  close(r.renewals5y, 0.75, "5-year share");
  close(r.renewal.introducer + r.renewal.adviser + r.renewal.me, 10, "renewal fees split in full");
});

test("introducer forecast: fees at sign-up, procuration after the lag, renewals 2 and 5 years after completion", () => {
  const months = introducerForecast(introInputs, rates, 84);
  const r = computeIntroducer(introInputs, rates);
  close(months[0].me, r.atSignUp.me, "month 1 fees only");
  close(months[2].completions, 2, "first completions in month 3");
  close(months[2 + 24].renewals, 0.25, "first 2-year renewals");
  close(months[2 + 23].renewals, 0, "none before");
  close(months[2 + 60].renewals, 1, "5-year renewals join");
  const years = sumByYear(months);
  assert.equal(years.length, 7);
  close(years[0].signUps, 48, "year 1 sign-ups");
  close(years[1].renewals, 0, "no renewals in year 2");
});

test("validation rejects bad numbers and requires a plan name", () => {
  assert.throws(() => cleanRates({ ...rates, adviserMortgagePct: 101 }));
  assert.throws(() => cleanRates({ ...rates, procRatePct: "abc" }));
  assert.throws(() => cleanPlan({ name: "  " }));
  const plan = cleanPlan({
    name: "Test", extra: "dropped", scenarios: { base: scenario },
    years: { ambitious: { y2: { purchase: { seenOwnWeek: 12, conversionPct: 99 } } } },
  });
  assert.equal(plan.extra, undefined);
  close(plan.scenarios.base.remortgage.seenOwnWeek, perWeek(10), "weekly seen kept");
  assert.equal(plan.scenarios.conservative.purchase.lagMonths, 1);
  assert.deepEqual(plan.years.ambitious.y2.purchase, { seenOwnWeek: 12 });
  assert.equal(plan.years.base.y2, null);
  assert.throws(() => cleanPlan({ name: "X", years: { base: { y3: { remortgage: { seenOwnWeek: -1 } } } } }));
  assert.throws(() => cleanPlan({ name: "X", scenarios: { base: { remortgage: { seenOwnWeek: 151 } } } }));
});

test("plans keep a supervisor and a start month", () => {
  const plan = cleanPlan({ name: "A", adviser: "Ann", supervisor: " Sam ", start: { year: 2027, month: 3 } });
  assert.equal(plan.supervisor, "Sam");
  assert.deepEqual(plan.start, { year: 2027, month: 3 });
  assert.equal(cleanPlan({ name: "B" }).start, null);
  assert.deepEqual(cleanPlan({ name: "I", kind: "introducer", start: { year: 2027, month: 12 } }).start, { year: 2027, month: 12 });
  assert.equal(cleanPlan({ name: "I", kind: "introducer", supervisor: "Sam" }).supervisor, undefined);
  assert.throws(() => cleanStart({ year: 2027, month: 13 }));
  assert.throws(() => cleanStart({ year: 1999, month: 1 }));
  assert.throws(() => cleanStart({ year: 2027.5, month: 1 }));
});

test("calendar years line up with the plan's start month", () => {
  const start = { year: 2027, month: 3 };
  assert.equal(monthLabel(start), "Mar 2027");
  assert.equal(monthLabel(start, 10), "Jan 2028");
  assert.equal(monthsToYearEnd(start, 2027), 12);
  assert.equal(monthsToYearEnd(start, 2028), 22);
  const months = Array.from({ length: 22 }, (_, i) => ({ month: i + 1, adviser: i + 1 }));
  const y2027 = calendarSlice(months, start, 2027);
  assert.deepEqual(y2027.map((m) => m.adviser), [0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(y2027[0].planMonth, null);
  assert.equal(y2027[2].planMonth, 1);
  assert.deepEqual(calendarSlice(months, start, 2028).map((m) => m.adviser), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
  assert.equal(sumAll(calendarSlice(months, start, 2026)).adviser, 0);
});

test("adviser forecast uses year 2 and 3 appointments, then carries year 3 on", () => {
  const plan = cleanPlan({ name: "A", scenarios: { base: scenario }, years: { base: { y3: { remortgage: { seenOwnWeek: perWeek(20) } } } }, rates });
  plan.rates = rates;
  const months = adviserForecast(plan, 48);
  const three = threeYear(plan.scenarios.base, plan.years.base, rates);
  for (let i = 0; i < 36; i++) close(months[i].adviser, three.months[i].adviser, `month ${i + 1}`);
  close(months[47].adviser, months[40].adviser, "year 4 steady at year 3 level");
});

test("plan figures: steady month, first 12 months and calendar year", () => {
  const plan = { ...cleanPlan({ name: "A", scenarios: { base: scenario } }), rates };
  const start = { year: 2027, month: 7 };
  const f = planFigures(plan, start, 2027);
  const steady = computeMonth(plan.scenarios.base, rates).total;
  close(f.steady.adviser, steady.adviser, "steady adviser");
  close(f.steady.total, steady.adviser + steady.introducer + steady.me, "total received splits in full");
  close(f.first12.adviser, sumMonths(forecast(Array(12).fill(plan.scenarios.base), rates)).adviser, "first 12 months");
  const months = adviserForecast(plan, 6);
  close(f.calendar.adviser, sumAll(months).adviser, "Jul to Dec 2027 = first 6 plan months");
  const intro = { ...cleanPlan({ name: "I", kind: "introducer", inputs: introInputs }), rates };
  const fi = planFigures(intro, { year: 2027, month: 1 }, 2029);
  const all = introducerForecast(introInputs, rates, 36);
  close(fi.calendar.introducer, sumAll(all.slice(24, 36)).introducer, "third calendar year");
  close(fi.calendar.total, fi.calendar.adviser + fi.calendar.introducer + fi.calendar.me, "introducer total received");
  assert.ok(fi.calendar.renewalTotal > 0, "2-year renewals land in year 3");
});
