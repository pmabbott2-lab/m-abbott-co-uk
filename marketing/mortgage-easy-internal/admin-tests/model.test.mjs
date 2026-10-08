// Formula tests with made-up round-number rates. Real assumptions stay out of git; the worked
// example against real defaults lives in admin-private.local/ (gitignored).
import test from "node:test";
import assert from "node:assert/strict";
import {
  computeCase, computeMonth, forecast, sumMonths, threeYear, reverseTarget,
  cleanRates, cleanPlan, cleanScenario, blankScenario, WORKING_WEEKS, WEEKS_PER_MONTH,
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
