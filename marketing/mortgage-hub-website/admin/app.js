import * as M from "./model.js";
import { lineChart, donut, groupedBars, funnel } from "./charts.js";
import { icon } from "./icons.js";
import { h, gbp, gbp0, count, pctTxt, clone, fmtField, numInput, tableEl, download, toCsv, parseAmount, HOLIDAY_NOTE, LEADS_NOTE } from "./ui.js";
import { createIntroducerView } from "./introducer.js";

const $ = (id) => document.getElementById(id);

/** Demo-safe view: adviser earnings only. Introducer shares and Mortgage Easy's margin are on the owner page. */
const ADVISER = [{ key: "adviser", label: "Adviser", cls: "c-adviser" }];

const today = new Date();
const thisMonth = () => ({ year: today.getFullYear(), month: today.getMonth() + 1 });

const state = {
  user: null,
  mode: "adviser",
  defaultRates: M.cleanRates({}),
  assumptions: null,
  plan: null,
  planId: null,
  plans: [],
  filter: { supervisor: "", who: "" },
  calYear: null,
  scenario: "base",
  caseType: "remortgage",
  panel: "overview",
  dirty: false,
  target: { amount: 0 },
};

const planStart = () => (state.plan && state.plan.start) || thisMonth();
const viewYear = () => state.calYear || planStart().year;

/* ---------- status and API ---------- */

let statusTimer;
function setStatus(text, kind = "") {
  clearTimeout(statusTimer);
  const box = $("status");
  box.replaceChildren(text ? h("div", { class: `adm-alert ${kind ? `is-${kind}` : ""}`, text }) : "");
  if (kind === "ok") statusTimer = setTimeout(() => box.replaceChildren(), 4000);
}

async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (_err) {
    throw new Error("Could not reach the server. Your sign-in may have expired: reload the page to sign in again.");
  }
  if (!/application\/json/.test(res.headers.get("content-type") || "")) {
    throw new Error(res.status === 403 ? "Access refused. Reload the page to sign in again." : `Unexpected response (${res.status}).`);
  }
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

/* ---------- plan state ---------- */

const emptyYears = () => ({ base: { y2: null, y3: null } });

/** Starting inputs for a new introducer plan: the saved template, else blank with the purchase mortgage, fee and timing. */
function introducerStart() {
  const a = state.assumptions || {};
  if (a.introducerTemplate) return M.cleanIntroInputs(a.introducerTemplate);
  const out = M.blankIntroducer();
  const purchase = a.adviserTemplate && M.cleanScenario(a.adviserTemplate).purchase;
  if (purchase) Object.assign(out, { avgLoan: purchase.avgLoan, brokerFee: purchase.brokerFee, lagMonths: purchase.lagMonths });
  return out;
}

function newPlan(kind = state.mode) {
  const rates = clone(state.defaultRates);
  const start = thisMonth();
  if (kind === "introducer") {
    return { kind, name: "New introducer plan", introducer: filterName(state.filter.who), start, notes: "", inputs: introducerStart(), rates };
  }
  const template = state.assumptions && state.assumptions.adviserTemplate ? state.assumptions.adviserTemplate : M.blankScenario();
  const scenarios = { base: M.cleanScenario(clone(template)) };
  return { kind: "adviser", name: "New plan", adviser: filterName(state.filter.who), supervisor: filterName(state.filter.supervisor), start, notes: "", scenarios, years: emptyYears(), rates };
}

const whoKey = () => (state.mode === "introducer" ? "introducer" : "adviser");
const isBase = () => state.scenario === "base";
const currentScenario = () => M.scenarioOf(state.plan, state.scenario);
const currentYears = () => M.yearsOf(state.plan, state.scenario);
const baseYears = () => state.plan.years.base || (state.plan.years.base = { y2: null, y3: null });

function markDirty() {
  state.dirty = true;
  $("dirty").hidden = false;
}

function markClean() {
  state.dirty = false;
  $("dirty").hidden = true;
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderAll();
  });
}

/* ---------- input controls ---------- */

/** A plan input: every change marks the plan unsaved and redraws. */
const field = (f, get, set, label) => numInput(f, get, (v) => { set(v); markDirty(); scheduleRender(); }, label);

const COMMISSION_LABELS = {
  adviserMortgagePct: "Adviser: procuration and fees",
  adviserIntroPct: "Adviser: own-customer introductions",
  adviserProtectionPct: "Adviser: protection and GI",
};
const ADVISER_COMMISSION = M.COMMISSION_FIELDS.filter((f) => COMMISSION_LABELS[f.key]);
/** Back-office rates on the Assumptions panel; the external introducer rate only affects the owner page. */
const PLAN_RATE_FIELDS = [...M.BUSINESS_RATE_FIELDS, ...M.COMMISSION_FIELDS.filter((f) => f.key === "introducerPct")];

const INPUT_GROUPS = [
  { label: "Appointments seen per week", icon: "calendar", keys: { seenOwnWeek: "Own customers", seenIntroducedWeek: "Introduced" } },
  { label: "Conversion", icon: "funnel", keys: { conversionPct: "Seen to written", lapsePct: "NTU rate" } },
  { label: "Mortgage and fees", icon: "home", keys: { avgLoan: "Average mortgage", brokerFee: "Broker fee", feeCollectedPct: "Cases paying a fee" } },
  { label: "Protection", icon: "shield", keys: { protectionConvPct: "Cases with protection", protectionMonthlyPremium: "Monthly premium" } },
  { label: "General insurance", icon: "umbrella", keys: { giConvPct: "Cases with GI", giAnnualPremium: "Annual premium" } },
  { label: "Timing", icon: "clock", keys: { lagMonths: "Months to payment" } },
];

const inputSyncs = [];

function buildInputs() {
  const scen = $("scenario-tabs");
  for (const s of M.SCENARIOS) {
    scen.append(h("button", { type: "button", role: "tab", "data-key": s.key, text: s.label, onclick: () => { state.scenario = s.key; syncInputs(); renderAll(); } }));
  }
  const fields = Object.fromEntries(M.CASE_FIELDS.map((f) => [f.key, f]));
  const grid = h("div", { class: "in-grid" }, h("span"), ...M.CASE_TYPES.map((t) => h("span", { class: "in-colhead", text: t.label })));
  for (const g of INPUT_GROUPS) {
    grid.append(h("div", { class: "in-group" }, icon(g.icon), h("span", { text: g.label })));
    for (const [key, short] of Object.entries(g.keys)) {
      const f = fields[key];
      const cells = M.CASE_TYPES.map((t) => {
        const c = field(f, () => currentScenario()[t.key][key], (v) => { state.plan.scenarios.base[t.key][key] = v; }, `${t.label}: ${f.label}`);
        inputSyncs.push(c.sync);
        return c;
      });
      const hint = key.startsWith("seen") ? null : f.hint;
      grid.append(h("label", { class: "in-label", for: cells[0].input.id }, short, hint ? h("span", { class: "field-hint", text: hint }) : null),
        ...cells.map((c) => c.wrap));
    }
  }
  grid.append(h("div", { class: "in-group" }, icon("user"), h("span", { text: "Commission (this adviser's terms)" })));
  for (const f of ADVISER_COMMISSION) {
    const c = field(f, () => state.plan.rates[f.key], (v) => { state.plan.rates[f.key] = v; }, f.label);
    inputSyncs.push(c.sync);
    c.wrap.classList.add("in-span");
    grid.append(h("label", { class: "in-label", for: c.input.id }, COMMISSION_LABELS[f.key], h("span", { class: "field-hint", text: f.hint })), c.wrap);
  }
  $("case-fields").append(grid, h("p", { class: "field-hint holiday-note", text: HOLIDAY_NOTE }));
}

function syncTabs(boxId, active) {
  for (const b of $(boxId).children) {
    const on = b.dataset.key === active;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  }
}

function syncInputs() {
  if (state.mode === "introducer") return intro.sync();
  syncTabs("scenario-tabs", state.scenario);
  const s = M.SCENARIOS.find((x) => x.key === state.scenario);
  $("scenario-note").textContent = isBase()
    ? "Enter figures on Base. Conservative and Ambitious follow it automatically, and team and owner totals use Base."
    : `${s.note}. These boxes are fixed: change Base to change them.`;
  for (const input of $("case-fields").querySelectorAll("input")) input.disabled = !isBase();
  for (const sync of inputSyncs) sync();
  for (const p of panels) if (p.sync) p.sync();
}

function syncToolbar() {
  $("plan-name").value = state.plan.name;
  $("plan-adviser").value = state.plan[whoKey()] || "";
  $("plan-supervisor").value = state.plan.supervisor || "";
  const start = planStart();
  ensureYear($("start-year"), start.year);
  ensureYear($("cal-year"), viewYear());
  $("start-month").value = String(start.month);
  $("start-year").value = String(start.year);
  $("cal-year").value = String(viewYear());
  $("plan-select").value = state.planId || "";
}

/* ---------- tables ---------- */

const typeCols = ["", "Remortgage", "Purchase", "Total"];
function byTypeRow(month, label, fn, fmt = gbp, cls) {
  return { cls, cells: [label, fmt(fn(month.byType.remortgage)), fmt(fn(month.byType.purchase)), fmt(fn(month.total))] };
}

function pipeline(el, t) {
  funnel(el, [
    { label: "Appointments seen", value: t.seen, sub: `${count(t.seenWeek)} a week · ${count(t.seenOwn)} own · ${count(t.seenIntro)} introduced` },
    { label: "Written", value: t.written, sub: `${count(t.feeCases)} paying a broker fee` },
    { label: "Completed", value: t.completions, sub: `${count(t.written - t.completions)} NTU` },
    { label: "Protection on risk", value: t.protection.onRisk, sub: `${count(t.protection.sold)} sold` },
    { label: "GI on risk", value: t.gi.onRisk, sub: `${count(t.gi.sold)} sold` },
  ], count);
}

/* ---------- panels ---------- */

const panels = [
  {
    key: "overview",
    label: "Overview",
    intro: "One month for this adviser once each case type's lag has passed. Yearly = 12 steady months.",
    build(body) {
      body.append(h("div", { class: "adm-alert holiday-alert" }, icon("calendar"), h("span", { text: HOLIDAY_NOTE })));
      this.main = h("div", { class: "grid-2" });
      this.table = h("div");
      this.chart = h("div", { class: "chart chart-donut" });
      this.main.append(this.table, h("div", null, h("h3", { text: "Adviser earnings by source" }), this.chart));
      this.funnel = h("div", { class: "chart" });
      this.inputs = h("div");
      this.notes = h("textarea", { id: "plan-notes", maxlength: "2000", oninput: () => { state.plan.notes = this.notes.value; markDirty(); } });
      body.append(this.main, h("h3", { text: "Monthly pipeline" }), this.funnel, h("h3", { text: "Inputs used (this scenario)" }), this.inputs,
        h("h3", null, h("label", { for: "plan-notes", text: "Plan notes" })), this.notes);
    },
    sync() { if (document.activeElement !== this.notes) this.notes.value = state.plan.notes || ""; },
    update({ month, sc }) {
      const line = (label, fn, cls) => ({ cls, cells: [label, gbp(fn(month.byType.remortgage)), gbp(fn(month.byType.purchase)), gbp(fn(month.total)), gbp(fn(month.total) * 12)] });
      this.table.replaceChildren(tableEl(["Monthly", "Remortgage", "Purchase", "Total / month", "Total / year"], [
        line("Adviser", (x) => x.adviser, "is-total"),
        line("on procuration and fees", (x) => x.adviserMortgage, "is-sub"),
        line("on own-customer introductions", (x) => x.adviserIntro, "is-sub"),
        line("on protection and GI", (x) => x.adviserProtection, "is-sub"),
      ]));
      const t = month.total;
      donut(this.chart, [
        { label: "Procuration and fees", value: t.adviserMortgage, cls: "c-adviser" },
        { label: "Own-customer introductions", value: t.adviserIntro, cls: "c-introducer" },
        { label: "Protection and GI", value: t.adviserProtection, cls: "c-me" },
      ], `${gbp0(t.adviser)}/mo`);
      pipeline(this.funnel, t);
      this.inputs.replaceChildren(tableEl(["Input", "Remortgage", "Purchase"],
        M.CASE_FIELDS.map((f) => ({ cells: [f.label, fmtField(f, sc.remortgage[f.key]), fmtField(f, sc.purchase[f.key])] }))));
    },
  },
  {
    key: "activity",
    label: "Sales activity",
    intro: "Appointments seen through to written, completed and policies on risk, per month.",
    build(body) {
      this.funnel = h("div", { class: "chart" });
      this.table = h("div");
      body.append(this.funnel, this.table);
    },
    update({ month }) {
      pipeline(this.funnel, month.total);
      const c = (label, fn, cls) => byTypeRow(month, label, fn, count, cls);
      this.table.replaceChildren(tableEl(typeCols, [
        c("Seen per week", (x) => x.seenWeek, "is-sub"),
        c("Seen per month: own customers", (x) => x.seenOwn),
        c("Seen: introduced", (x) => x.seenIntro),
        c("Seen: total", (x) => x.seen, "is-total"),
        c("Written: own customers", (x) => x.writtenOwn),
        c("Written: introduced", (x) => x.writtenIntro),
        c("Written: total", (x) => x.written, "is-total"),
        c("Paying a broker fee", (x) => x.feeCases, "is-sub"),
        c("NTU (written, not completed)", (x) => x.written - x.completions, "is-sub"),
        c("Completed", (x) => x.completions, "is-total"),
        c("Protection sold", (x) => x.protection.sold),
        c("…mortgage completed", (x) => x.protection.completed, "is-sub"),
        c("…policy on risk (after protection NTU)", (x) => x.protection.onRisk),
        c("GI sold", (x) => x.gi.sold),
        c("…mortgage completed", (x) => x.gi.completed, "is-sub"),
        c("…policy on risk (after GI NTU)", (x) => x.gi.onRisk),
      ]));
    },
  },
  {
    key: "mortgage",
    label: "Mortgage income",
    intro: "Procuration is paid on completed cases at the rate received after HLP's share. Broker fees are taken on written cases and are not refunded.",
    update({ month, rates }) {
      this.body.replaceChildren(
        tableEl(typeCols, [
          byTypeRow(month, "Completed cases", (x) => x.completions, count),
          byTypeRow(month, "Total lent", (x) => x.lent, gbp0),
          { cells: ["Procuration rate received", pctTxt(M.computeCase({}, rates).procRate * 100), "", ""], cls: "is-sub no-print" },
          byTypeRow(month, "Procuration: own customers", (x) => x.procOwn),
          byTypeRow(month, "Procuration: introduced", (x) => x.procIntro),
          byTypeRow(month, "Procuration", (x) => x.proc, gbp, "is-total"),
          byTypeRow(month, "Fee-paying cases", (x) => x.feeCases, count),
          byTypeRow(month, "Broker fees: own customers", (x) => x.feesOwn),
          byTypeRow(month, "Broker fees: introduced", (x) => x.feesIntro),
          byTypeRow(month, "Broker fees", (x) => x.fees, gbp, "is-total"),
          byTypeRow(month, "HLP share of procuration (memo: already deducted)", (x) => x.hlpMemo, gbp, "is-sub no-print"),
        ]),
        h("p", { class: "note no-print", text: "HLP takes no share of broker fees, protection or GI." }),
      );
    },
  },
  {
    key: "protection",
    label: "Protection and GI",
    intro: "Policies fall away with the mortgage NTU rate, then again for protection and GI NTU (mortgage completes, policy never starts), then for cancellations after the policy starts.",
    update({ month }) {
      const rows = (k, name) => [
        byTypeRow(month, `${name} sold`, (x) => x[k].sold, count),
        byTypeRow(month, "after mortgage NTU", (x) => x[k].completed, count, "is-sub"),
        byTypeRow(month, `on risk after ${name} NTU`, (x) => x[k].onRisk, count),
        { cells: ["Commission per policy", gbp(month.byType.remortgage[k].perPolicy), gbp(month.byType.purchase[k].perPolicy), "—"], cls: "is-sub" },
        byTypeRow(month, "Commission before cancellations", (x) => x[k].gross),
        byTypeRow(month, "Lost to cancellations", (x) => -x[k].cancelled, gbp, "is-sub"),
        byTypeRow(month, `${name} received`, (x) => x[k].net, gbp, "is-total"),
      ];
      this.body.replaceChildren(
        h("h3", { text: "Protection" }), tableEl(typeCols, rows("protection", "Protection")),
        h("h3", { text: "General insurance" }), tableEl(typeCols, rows("gi", "GI")),
      );
    },
  },
  {
    key: "adviser",
    label: "Adviser earnings",
    intro: "Commission is a share of what Mortgage Easy receives.",
    update({ month, rates, year1, sc }) {
      const perSeen = (x) => (x.seen > 0 ? x.adviser / x.seen : 0);
      const y1ByType = {};
      for (const t of M.CASE_TYPES) {
        const only = { ...M.blankScenario(), [t.key]: sc[t.key] };
        y1ByType[t.key] = M.sumMonths(M.forecast(Array(12).fill(only), rates)).adviser;
      }
      this.body.replaceChildren(tableEl(typeCols, [
        byTypeRow(month, `On procuration and fees (${pctTxt(rates.adviserMortgagePct)})`, (x) => x.adviserMortgage),
        byTypeRow(month, `On own-customer introductions (${pctTxt(rates.adviserIntroPct)})`, (x) => x.adviserIntro),
        byTypeRow(month, `On protection and GI (${pctTxt(rates.adviserProtectionPct)})`, (x) => x.adviserProtection),
        byTypeRow(month, "Adviser per month", (x) => x.adviser, gbp, "is-total"),
        byTypeRow(month, "Adviser per year (steady)", (x) => x.adviser * 12, gbp, "is-total"),
        byTypeRow(month, "Per appointment seen", perSeen),
        { cells: ["First 12 months (allowing for lags)", gbp(y1ByType.remortgage), gbp(y1ByType.purchase), gbp(year1.adviser)] },
      ]));
    },
  },
  {
    key: "calendar",
    label: "Calendar year",
    build(body) {
      this.note = h("p");
      this.chart = h("div", { class: "chart" });
      this.table = h("div");
      body.append(this.note, this.chart, this.table);
    },
    update({ cal, start, year }) {
      this.note.textContent = `What this adviser earns in ${year}, month by month, with the plan starting in ${M.monthLabel(start)}. ` +
        "Years 2 and 3 use the appointments under Three-year growth, and year 3 carries on after that. Change the year at the top of the page.";
      lineChart(this.chart, cal.map((m) => ({ label: m.label, values: m })), ADVISER, { title: `Calendar ${year}` });
      const total = M.sumAll(cal);
      const row = (label, m, cls) => ({ cls, cells: [label, count(m.written), count(m.completions), gbp(m.adviser)] });
      this.table.replaceChildren(tableEl(["Month", "Written", "Completions paid", "Adviser"],
        [...cal.map((m) => row(`${m.label} ${year}`, m, m.planMonth ? null : "is-sub")), row(`Total ${year}`, total, "is-total")]));
    },
  },
  {
    key: "forecast",
    label: "12-month forecast",
    intro: "From a standing start in the plan's first month. Earnings from broker fees arrive in the month written; procuration, protection and GI arrive after each case type's lag.",
    build(body) {
      this.chart = h("div", { class: "chart" });
      this.table = h("div");
      body.append(this.chart, this.table);
    },
    update({ months12, year1, start }) {
      lineChart(this.chart, months12.map((m) => ({ label: M.monthLabel(start, m.month - 1).slice(0, 3), values: m })), ADVISER, { title: "12-month forecast" });
      const row = (label, m, cls) => ({ cls, cells: [label, count(m.written), count(m.completions), gbp(m.adviser)] });
      this.table.replaceChildren(tableEl(
        ["Month", "Written", "Completions paid", "Adviser"],
        [...months12.map((m) => row(`Month ${m.month} (${M.monthLabel(start, m.month - 1)})`, m)), row("First 12 months", year1, "is-total")],
      ));
    },
  },
  {
    key: "threeyear",
    label: "Three-year growth",
    intro: "Years 2 and 3 start as copies of year 1. On Base, change the appointments seen for those years here (leave blank to keep year 1's). All other inputs stay as entered. Conservative and Ambitious follow Base.",
    build(body) {
      this.cells = [];
      const rows = [];
      for (const t of M.CASE_TYPES) {
        for (const f of M.SEEN_FIELDS) {
          const y1 = h("td", { class: "num" });
          const inputs = ["y2", "y3"].map((y) => {
            const input = h("input", { type: "number", min: f.min, max: f.max, step: "any", "aria-label": `${t.label} ${f.label} ${y === "y2" ? "year 2" : "year 3"}` });
            input.addEventListener("input", () => {
              if (!isBase()) return;
              const years = baseYears();
              const raw = input.value.trim();
              const v = Number(raw);
              if (raw !== "" && !(Number.isFinite(v) && v >= f.min && v <= f.max)) return;
              years[y] = years[y] || {};
              years[y][t.key] = years[y][t.key] || {};
              if (raw === "") delete years[y][t.key][f.key];
              else years[y][t.key][f.key] = v;
              markDirty();
              scheduleRender();
            });
            return input;
          });
          this.cells.push({ t, f, y1, inputs });
          rows.push(h("tr", null, h("th", { scope: "row", text: `${t.label}: ${f.label.replace("Appointments seen per week: ", "")}` }), y1,
            ...inputs.map((i) => h("td", { class: "num" }, i))));
        }
      }
      body.append(h("div", { class: "table-wrap" }, h("table", { class: "adm-table" },
        h("thead", null, h("tr", null, ["Appointments seen per week", "Year 1", "Year 2", "Year 3"].map((c, i) => h("th", { class: i ? "num" : null, text: c })))),
        h("tbody", null, rows))));
      this.chart = h("div", { class: "chart" });
      this.table = h("div");
      body.append(h("h3", { text: "36 months" }), this.chart, this.table);
    },
    sync() {
      const years = currentYears();
      for (const c of this.cells) {
        ["y2", "y3"].forEach((y, i) => {
          const v = years[y] && years[y][c.t.key] && years[y][c.t.key][c.f.key];
          c.inputs[i].disabled = !isBase();
          if (document.activeElement !== c.inputs[i]) c.inputs[i].value = v === undefined || v === null ? "" : String(isBase() ? v : Math.round(v * 100) / 100);
        });
      }
    },
    update({ sc, rates }) {
      for (const c of this.cells) {
        c.y1.textContent = count(sc[c.t.key][c.f.key]);
        for (const i of c.inputs) i.placeholder = count(sc[c.t.key][c.f.key]);
      }
      const res = M.threeYear(sc, currentYears(), rates);
      const start = planStart();
      lineChart(this.chart, res.months.map((m) => ({ label: M.monthLabel(start, m.month - 1).slice(0, 3), values: m })), ADVISER, { labelEvery: 3, title: "Three-year forecast" });
      const total = M.sumMonths(res.months);
      const row = (label, y, cls) => ({ cls, cells: [label, count(y.written), count(y.completions), gbp(y.adviser)] });
      const span = (y) => `${M.monthLabel(start, (y - 1) * 12)} to ${M.monthLabel(start, y * 12 - 1)}`;
      this.table.replaceChildren(tableEl(["", "Written", "Completions paid", "Adviser"],
        [...res.years.map((y) => row(`Year ${y.year} (${span(y.year)})`, y)), row("Three years", total, "is-total")]));
    },
  },
  {
    key: "target",
    label: "Reverse target",
    intro: "Enter the adviser's annual earnings target. Everything scales with appointments seen, so the answer keeps this scenario's mix of case types, sources and conversion.",
    build(body) {
      this.amount = h("input", { type: "text", id: "target-amount", inputmode: "decimal", autocomplete: "off", placeholder: "e.g. 60,000 or 60k" });
      this.amount.addEventListener("input", () => { state.target.amount = parseAmount(this.amount.value); scheduleRender(); });
      this.headline = h("div", { class: "adm-alert target-headline" });
      this.result = h("div");
      body.append(
        h("div", { class: "adm-toolbar" }, h("label", null, "Annual adviser earnings target (£)", this.amount)),
        this.headline,
        this.result,
      );
    },
    update({ sc, rates }) {
      const raw = this.amount.value.trim();
      const r = M.reverseTarget(sc, rates, "adviser", Number.isFinite(state.target.amount) ? state.target.amount : 0);
      const name = "Adviser earnings";
      if (r.perSeen === null || r.factor === null) {
        this.headline.hidden = true;
        this.result.replaceChildren(h("p", { class: "note", text: "Enter some appointments and rates first: this scenario currently earns nothing to scale from." }));
        return;
      }
      this.headline.hidden = false;
      this.headline.classList.toggle("is-error", Boolean(raw) && !(state.target.amount > 0));
      this.headline.textContent = !raw
        ? "Type a yearly target above to see the appointments needed each week."
        : !(state.target.amount > 0)
          ? "Enter the target as a number of pounds, for example 60000, 60,000 or 60k."
          : `To earn ${gbp0(r.target)} a year: about ${count(r.steadySeen.totalSeenWeek)} appointments a week once payments are flowing` +
            (r.firstYearSeen ? `, or ${count(r.firstYearSeen.totalSeenWeek)} a week to reach it in the first 12 months.` : ".");
      const seenRows = [];
      for (const t of M.CASE_TYPES) {
        for (const f of M.SEEN_FIELDS) {
          seenRows.push({ cells: [`${t.label}: ${f.label.replace("Appointments seen per week: ", "")}`, count(sc[t.key][f.key]),
            r.target > 0 ? count(r.steadySeen[t.key][f.key]) : "—", r.target > 0 && r.firstYearSeen ? count(r.firstYearSeen[t.key][f.key]) : "—"] });
        }
      }
      seenRows.push({ cls: "is-total", cells: ["Total seen per week", count(M.computeMonth(sc, rates).total.seenWeek),
        r.target > 0 ? count(r.steadySeen.totalSeenWeek) : "—", r.target > 0 && r.firstYearSeen ? count(r.firstYearSeen.totalSeenWeek) : "—"] });
      this.result.replaceChildren(
        tableEl(["", "Value"], [
          { cells: [`${name} now (steady year)`, gbp(r.steadyAnnual)] },
          { cells: [`${name} now (first 12 months)`, gbp(r.firstAnnual)] },
          { cells: [`${name} per appointment seen`, gbp(r.perSeen)] },
        ]),
        h("h3", { text: "Appointments needed per week" }),
        tableEl(["", "Now", "For target (steady)", "For target in first 12 months"], seenRows),
        h("p", { class: "note", text: `First 12 months allows for the lag before procuration, protection and GI are paid, so more appointments are needed to hit the same figure in year 1. Weekly figures assume ${M.WORKING_WEEKS} working weeks a year.` }),
      );
    },
  },
  {
    key: "scenarios",
    label: "Scenario comparison",
    intro: `Base, Conservative and Ambitious side by side, using this adviser's rates and commission. ${M.SCENARIOS.filter((s) => s.note).map((s) => `${s.label}: ${s.note.charAt(0).toLowerCase()}${s.note.slice(1)}.`).join(" ")} Actual-versus-projection tracking is planned for later.`,
    build(body) {
      this.table = h("div");
      this.chart = h("div", { class: "chart" });
      body.append(this.table, h("h3", { text: "Yearly (steady)" }), this.chart);
    },
    update({ rates }) {
      const res = M.SCENARIOS.map((s) => {
        const sc = M.scenarioOf(state.plan, s.key);
        return { s, m: M.computeMonth(sc, rates).total, y1: M.sumMonths(M.forecast(Array(12).fill(sc), rates)) };
      });
      const row = (label, fn, fmt = gbp, cls) => ({ cls, cells: [label, ...res.map((r) => fmt(fn(r)))] });
      this.table.replaceChildren(tableEl(["", ...M.SCENARIOS.map((s) => s.label)], [
        row("Appointments seen / week", (r) => r.m.seenWeek, count),
        row("Written / month", (r) => r.m.written, count),
        row("Completed / month", (r) => r.m.completions, count),
        row("Adviser / month", (r) => r.m.adviser, gbp, "is-total"),
        row("Adviser / year (steady)", (r) => r.m.adviser * 12),
        row("Adviser, first 12 months", (r) => r.y1.adviser, gbp, "is-sub"),
      ]));
      groupedBars(this.chart, res.map((r) => ({ label: r.s.label, values: { adviser: r.m.adviser * 12 } })), ADVISER);
    },
  },
  {
    key: "assumptions",
    label: "Assumptions",
    print: false,
    intro: "Rates for this adviser's plan, saved with the plan, so each adviser can be on different terms. The adviser's commission is with the inputs. The stored defaults are only the starting point for new plans.",
    build(body) {
      this.controls = PLAN_RATE_FIELDS.map((f) => field(f, () => state.plan.rates[f.key], (v) => { state.plan.rates[f.key] = v; }, f.label));
      const grid = h("div", { class: "in-grid in-grid-one" });
      PLAN_RATE_FIELDS.forEach((f, i) => grid.append(
        h("label", { class: "in-label", for: this.controls[i].input.id }, f.label, f.hint ? h("span", { class: "field-hint", text: f.hint }) : null),
        this.controls[i].wrap));
      this.derived = h("p", { class: "note" });
      this.saved = h("p", { class: "note" });
      body.append(grid, this.derived,
        h("div", { class: "adm-toolbar no-print" },
          h("button", { type: "button", class: "btn btn-green", text: "Save these rates as defaults for new plans", onclick: () => saveDefaultRates() }),
          h("button", { type: "button", class: "btn btn-ghost", text: "Use Base inputs as starting inputs", onclick: () => saveTemplate() }),
          h("button", { type: "button", class: "btn btn-ghost", text: "Reset this plan's rates to defaults", onclick: () => resetRates() })),
        this.saved);
    },
    sync() { for (const c of this.controls) c.sync(); },
    update({ rates }) {
      const procRate = M.computeCase({}, rates).procRate * 100;
      this.derived.textContent = `Procuration received: ${pctTxt(rates.procRatePct)} × ${pctTxt(rates.procRetainedPct)} = ${pctTxt(procRate)} of the loan. ` +
        `HLP's share (${pctTxt(100 - rates.procRetainedPct)}) is already removed and is never deducted again.`;
      this.saved.textContent = defaultsNote();
    },
  },
  {
    key: "formulas",
    label: "How it's calculated",
    print: false,
    intro: "Each step with this scenario's numbers.",
    build(body) {
      this.toggle = h("div", { class: "seg no-print", role: "tablist", "aria-label": "Case type" },
        M.CASE_TYPES.map((t) => h("button", { type: "button", role: "tab", "data-key": t.key, text: t.label, onclick: () => { state.caseType = t.key; renderAll(); } })));
      this.list = h("div");
      body.append(this.toggle, this.list);
    },
    update({ sc, rates }) {
      for (const b of this.toggle.children) b.classList.toggle("is-active", b.dataset.key === state.caseType);
      const t = M.CASE_TYPES.find((x) => x.key === state.caseType);
      const c = sc[t.key];
      const r = M.computeCase(c, rates);
      const f = (title, formula) => h("div", { class: "formula" }, h("strong", { text: title }), h("code", { text: formula }));
      const count = (v) => (v || 0).toLocaleString("en-GB", { maximumFractionDigits: 4 });
      this.list.replaceChildren(
        h("p", { class: "lead", text: `${t.label}, ${M.SCENARIOS.find((s) => s.key === state.scenario).label} scenario.` }),
        f("Appointments seen per month", `seen per week × ${M.WORKING_WEEKS} working weeks ÷ 12  (52 weeks less ${M.HOLIDAY_WEEKS} weeks' holiday)\n(${count(r.seenOwnWeek)} + ${count(r.seenIntroWeek)}) × ${M.WORKING_WEEKS} ÷ 12 = ${count(r.seen)}`),
        f("Written cases", `appointments seen per month × seen-to-written\n(${count(r.seenOwn)} + ${count(r.seenIntro)}) × ${pctTxt(c.conversionPct)} = ${count(r.written)}`),
        f("Completed cases", `written × (1 − NTU rate)\n${count(r.written)} × (1 − ${pctTxt(c.lapsePct)}) = ${count(r.completions)}`),
        f("Procuration", `completed × average mortgage × (procuration rate × share received after HLP)\n${count(r.completions)} × ${gbp0(c.avgLoan)} × (${pctTxt(rates.procRatePct)} × ${pctTxt(rates.procRetainedPct)}) = ${gbp(r.proc)}`),
        f("Broker fees", `written × cases paying a fee × broker fee  (in the month written, not refunded)\n${count(r.written)} × ${pctTxt(c.feeCollectedPct)} × ${gbp(c.brokerFee)} = ${gbp(r.fees)}`),
        f("Protection policies on risk", `written × with protection × (1 − NTU rate) × (1 − protection NTU)\n${count(r.written)} × ${pctTxt(c.protectionConvPct)} × (1 − ${pctTxt(c.lapsePct)}) × (1 − ${pctTxt(rates.protectionNtuPct)}) = ${count(r.protection.onRisk)}`),
        f("Protection received", `policies × (monthly premium × 12 × commission) × (1 − cancellations)\n${count(r.protection.onRisk)} × (${gbp(c.protectionMonthlyPremium)} × 12 × ${pctTxt(rates.protectionMultiplePct)}) × (1 − ${pctTxt(rates.cancellationPct)}) = ${gbp(r.protection.net)}`),
        f("GI received", `written × with GI × (1 − NTU rate) × (1 − GI NTU) × (annual premium × commission) × (1 − cancellations)\n${count(r.gi.onRisk)} × (${gbp(c.giAnnualPremium)} × ${pctTxt(rates.giCommissionPct)}) × (1 − ${pctTxt(rates.cancellationPct)}) = ${gbp(r.gi.net)}`),
        f("Adviser", `${pctTxt(rates.adviserMortgagePct)} × (procuration + fees) + ${pctTxt(rates.adviserIntroPct)} × (own customers' procuration + fees) + ${pctTxt(rates.adviserProtectionPct)} × (protection + GI)\n${gbp(r.adviserMortgage)} + ${gbp(r.adviserIntro)} + ${gbp(r.adviserProtection)} = ${gbp(r.adviser)}`),
        f("Timing", `Broker fees arrive in the month written. Procuration, protection and GI arrive ${r.lag} month${r.lag === 1 ? "" : "s"} later.`),
        f("HLP (for information)", `completed × average mortgage × procuration rate × HLP share = ${gbp(r.hlpMemo)}. Already excluded above; HLP takes nothing from fees, protection or GI.`),
      );
    },
  },
];

const PANEL_ICONS = {
  overview: "chart", activity: "funnel", mortgage: "home", protection: "shield", adviser: "user", calendar: "calendar",
  forecast: "clock", threeyear: "trend", target: "target", scenarios: "layers", assumptions: "list", formulas: "doc",
};

function buildPanels() {
  const nav = $("panel-nav");
  const box = $("panels");
  for (const p of panels) {
    p.btn = h("button", { type: "button", text: p.label, onclick: () => { state.panel = p.key; showPanel(); } });
    nav.append(p.btn);
    p.section = h("section", { class: "card panel", "aria-label": p.label, "data-print": p.print === false ? "no" : null });
    p.body = h("div");
    p.section.append(h("h2", { class: "panel-title" }, h("span", { class: "panel-icon" }, icon(PANEL_ICONS[p.key] || "chart")), p.label),
      ...(p.intro ? [h("p", { text: p.intro })] : []), p.body);
    if (p.build) p.build(p.body);
    box.append(p.section);
  }
}

function showPanel() {
  for (const p of panels) {
    const on = p.key === state.panel;
    p.section.classList.toggle("is-off", !on);
    p.btn.classList.toggle("is-active", on);
  }
}

/* ---------- render ---------- */

function computeContext() {
  const sc = currentScenario();
  const rates = state.plan.rates;
  const months12 = M.forecast(Array(12).fill(sc), rates);
  const start = planStart();
  const year = viewYear();
  const long = M.adviserForecast(state.plan, M.monthsToYearEnd(start, year), state.scenario);
  return { sc, rates, start, year, month: M.computeMonth(sc, rates), months12, year1: M.sumMonths(months12), cal: M.calendarSlice(long, start, year) };
}

function renderKpis({ month, year1, cal, start, year }) {
  const t = month.total;
  const kpi = (iconName, label, value, sub, cls = "") => h("div", { class: `card kpi ${cls}` },
    h("span", { class: "kpi-icon" }, icon(iconName)),
    h("div", null, h("div", { class: "kpi-label", text: label }), h("div", { class: "kpi-value", text: value }), h("div", { class: "kpi-sub", text: sub })));
  $("kpis").replaceChildren(
    kpi("user", "Adviser / month", gbp0(t.adviser), `${gbp0(t.adviser * 12)} a year annualised · ${gbp0(year1.adviser)} in first 12 months`),
    kpi("calendar", `Calendar ${year}`, gbp0(M.sumAll(cal).adviser), `Adviser earnings · plan starts ${M.monthLabel(start)}`, "k-green"),
    kpi("doc", "Cases / month", count(t.written), `${count(t.completions)} complete · ${count(t.seenWeek)} seen a week`, "k-amber"),
  );
}

function renderAll() {
  if (state.mode === "introducer") intro.render();
  else {
    const ctx = computeContext();
    renderKpis(ctx);
    for (const p of panels) p.update(ctx);
  }
  renderSummary();
}

/* ---------- plans and storage ---------- */

function setPlan(plan, id) {
  state.plan = plan;
  state.planId = id || null;
  markClean();
  syncToolbar();
  syncInputs();
  renderAll();
}

/** Plans saved before rates were per plan pick up the current defaults. */
function normalisePlan(record) {
  const clean = M.cleanPlan(record);
  if (!clean.rates) clean.rates = clone(state.defaultRates);
  return clean;
}

const planKind = (p) => p.kind || "adviser";
const whoOf = (p) => (planKind(p) === "introducer" ? p.introducer : p.adviser) || "";

/* ---------- finding plans: filters, plan list and summary ---------- */

const NONE = "__none__";
const matches = (filter, value) => !filter || (filter === NONE ? !value : value === filter);
const filterName = (v) => (v === NONE ? "" : v);
const distinct = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));

const modePlans = () => state.plans.filter((p) => planKind(p) === state.mode);
const filteredPlans = () => modePlans().filter((p) =>
  (state.mode !== "adviser" || matches(state.filter.supervisor, p.supervisor || "")) && matches(state.filter.who, whoOf(p)));

/** Refills a filter list, keeping the current choice if it still exists. Returns the choice in force. */
function fillFilter(select, allLabel, values, hasBlank, current) {
  select.replaceChildren(h("option", { value: "", text: allLabel }),
    ...values.map((v) => h("option", { value: v, text: v })),
    ...(hasBlank ? [h("option", { value: NONE, text: "(not set)" })] : []));
  select.value = current;
  return select.value === current ? current : (select.value = "");
}

function renderPlanPickers() {
  const adviserMode = state.mode === "adviser";
  const mine = modePlans();
  if (adviserMode) {
    state.filter.supervisor = fillFilter($("filter-supervisor"), "All supervisors", distinct(mine.map((p) => p.supervisor)),
      mine.some((p) => !p.supervisor), state.filter.supervisor);
  }
  const pool = mine.filter((p) => !adviserMode || matches(state.filter.supervisor, p.supervisor || ""));
  state.filter.who = fillFilter($("filter-who"), adviserMode ? "All advisers" : "All introducers", distinct(pool.map(whoOf)),
    pool.some((p) => !whoOf(p)), state.filter.who);
  const list = filteredPlans();
  const loaded = state.planId && !list.some((p) => p.id === state.planId) ? state.plans.filter((p) => p.id === state.planId) : [];
  $("plan-select").replaceChildren(h("option", { value: "", text: adviserMode ? "New plan" : "New introducer plan" }),
    ...[...loaded, ...list].map((p) => h("option", { value: p.id, text: whoOf(p) ? `${p.name} (${whoOf(p)})` : p.name })));
  $("plan-select").value = state.planId || "";
  $("plan-count").textContent = `${list.length} of ${mine.length}`;
  $("names-who").replaceChildren(...distinct(mine.map(whoOf)).map((v) => h("option", { value: v })));
  $("names-supervisor").replaceChildren(...distinct(state.plans.filter((p) => planKind(p) === "adviser").map((p) => p.supervisor)).map((v) => h("option", { value: v })));
}

function renderSummary() {
  const adviserMode = state.mode === "adviser";
  const year = viewYear();
  const list = filteredPlans();
  const key = adviserMode ? "adviser" : "introducer";
  $("summary-title").textContent = `${adviserMode ? "Adviser" : "Introducer"} plans summary (${list.length})`;
  const body = $("summary-body");
  if (!list.length) {
    body.replaceChildren(h("p", { class: "note", text: modePlans().length ? "No saved plans match the filters." : "No saved plans yet." }));
    return;
  }
  const items = list.map((p) => ({ p, f: M.planFigures(p, p.start || thisMonth(), year) }));
  const nums = (x) => [gbp(x.month), gbp(x.first12), gbp(x.annual), ...(adviserMode ? [] : [gbp(x.renewals)]), gbp(x.calendar)];
  const figs = ({ f }) => ({ month: f.steady[key], first12: f.first12[key] || 0, annual: f.steady[key] * 12, renewals: f.renewal ? f.renewal[key] * 12 : 0, calendar: f.calendar[key] || 0 });
  const add = (a, b) => { for (const k of Object.keys(b)) a[k] = (a[k] || 0) + b[k]; return a; };
  const planRow = (it) => ({
    cells: [h("button", { type: "button", class: "link-btn", text: it.p.name, onclick: () => openPlan(it.p.id) }),
      whoOf(it.p) || "—", ...(adviserMode ? [it.p.supervisor || "—"] : []), it.p.start ? M.monthLabel(it.p.start) : "Not set", ...nums(figs(it))],
  });
  const blank = adviserMode ? ["", "", ""] : ["", ""];
  const rows = [];
  const groups = adviserMode && !state.filter.supervisor ? distinct(items.map((it) => it.p.supervisor)) : [];
  if (groups.length > 1 || (groups.length === 1 && items.some((it) => !it.p.supervisor))) {
    for (const g of [...groups, ""]) {
      const inGroup = items.filter((it) => (it.p.supervisor || "") === g);
      if (!inGroup.length) continue;
      rows.push(...inGroup.map(planRow));
      rows.push({ cls: "is-sub", cells: [`Supervisor total: ${g || "(not set)"}`, ...blank, ...nums(inGroup.map(figs).reduce(add, {}))] });
    }
  } else {
    rows.push(...items.map(planRow));
  }
  rows.push({ cls: "is-total", cells: ["Total (plans shown)", ...blank, ...nums(items.map(figs).reduce(add, {}))] });
  const cols = adviserMode
    ? ["Plan", "Adviser", "Supervisor", "Starts", "Adviser / month", "First 12 months", "Annualised", `Calendar ${year}`]
    : ["Plan", "Introducer", "Starts", "Introducer / month", "First 12 months", "Annualised", "Renewals / year (once running)", `Calendar ${year}`];
  body.replaceChildren(tableEl(cols, rows),
    h("p", { class: "note", text: `Saved plans matching the filters above${adviserMode ? ", Base scenario" : ""}. Per month and annualised are steady figures once payments are flowing; first 12 months runs from each plan's start; calendar ${year} is what lands in that year. Unsaved changes are not included.` }));
}

async function refreshPlanList() {
  const data = await api("/api/admin/scenarios?all=1");
  state.plans = data.plans.flatMap((p) => {
    try { return [{ id: p.id, ...normalisePlan(p) }]; } catch (_err) { return []; }
  }).sort((a, b) => a.name.localeCompare(b.name));
  renderPlanPickers();
  renderSummary();
}

async function openPlan(id) {
  if (id === state.planId) return;
  if (!confirmDiscard()) { $("plan-select").value = state.planId || ""; return; }
  if (!id) return setPlan(newPlan(), null);
  try {
    const data = await api(`/api/admin/scenarios?id=${encodeURIComponent(id)}`);
    setPlan(normalisePlan(data.plan), id);
    renderPlanPickers();
  } catch (err) {
    $("plan-select").value = state.planId || "";
    setStatus(err.message, "error");
  }
}

function setMode(mode) {
  if (mode === state.mode) return;
  if (!confirmDiscard()) return;
  state.mode = mode;
  state.filter = { supervisor: "", who: "" };
  for (const b of $("mode-tabs").children) {
    const on = b.dataset.mode === mode;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  }
  const adviserMode = mode === "adviser";
  $("layout-adviser").hidden = !adviserMode;
  $("layout-introducer").hidden = adviserMode;
  $("supervisor-wrap").hidden = !adviserMode;
  $("filter-supervisor-wrap").hidden = !adviserMode;
  $("who-label").textContent = adviserMode ? "Adviser" : "Introducer";
  $("filter-who-label").textContent = adviserMode ? "Adviser" : "Introducer";
  setPlan(newPlan(mode), null);
  renderPlanPickers();
  renderSummary();
}

const confirmDiscard = () => !state.dirty || window.confirm("Discard unsaved changes to this plan?");

async function savePlan(asNew) {
  try {
    const plan = M.cleanPlan(state.plan);
    const data = await api("/api/admin/scenarios", { method: "PUT", body: { id: asNew ? undefined : state.planId || undefined, plan } });
    state.planId = data.plan.id;
    markClean();
    await refreshPlanList();
    setStatus(`Saved “${plan.name}”.`, "ok");
  } catch (err) {
    setStatus(err.message, "error");
  }
}

async function deletePlan() {
  if (!state.planId) return setStatus("This plan hasn't been saved yet.", "error");
  if (!window.confirm(`Delete “${state.plan.name}”? This cannot be undone.`)) return;
  try {
    await api(`/api/admin/scenarios?id=${encodeURIComponent(state.planId)}`, { method: "DELETE" });
    setPlan(newPlan(), null);
    await refreshPlanList();
    setStatus("Plan deleted.", "ok");
  } catch (err) {
    setStatus(err.message, "error");
  }
}

/* ---------- defaults for new plans ---------- */

async function putAssumptions(body, message) {
  try {
    const data = await api("/api/admin/assumptions", { method: "PUT", body: { rates: state.defaultRates, ...body } });
    state.assumptions = data.assumptions;
    state.defaultRates = M.cleanRates(data.assumptions.rates);
    renderAll();
    setStatus(message, "ok");
  } catch (err) {
    setStatus(err.message, "error");
  }
}

const saveDefaultRates = () => putAssumptions({ rates: M.cleanRates(state.plan.rates) }, "These rates are now the defaults for new plans. Existing plans keep their own.");
const saveTemplate = () => (state.mode === "introducer"
  ? putAssumptions({ introducerTemplate: M.cleanIntroInputs(state.plan.inputs) }, "Starting inputs saved for new introducer plans.")
  : putAssumptions({ adviserTemplate: M.cleanScenario(state.plan.scenarios.base) }, "Starting inputs saved for new adviser plans."));

function resetRates() {
  state.plan.rates = clone(state.defaultRates);
  markDirty();
  syncInputs();
  renderAll();
}

function defaultsNote() {
  const a = state.assumptions;
  const same = JSON.stringify(M.cleanRates(state.plan.rates)) === JSON.stringify(state.defaultRates);
  return `${same ? "This plan uses the default rates." : "This plan has its own rates, different from the defaults."} ` +
    (a && a.updatedAt ? `Defaults last saved ${new Date(a.updatedAt).toLocaleString("en-GB")}${a.updatedBy ? ` by ${a.updatedBy}` : ""}.`
      : a ? "Defaults are from the initial setup." : "No defaults saved yet.");
}

const intro = createIntroducerView({
  els: { fields: $("intro-fields"), kpis: $("intro-kpis"), nav: $("intro-nav"), panels: $("intro-panels") },
  field,
  getPlan: () => state.plan,
  getStart: planStart,
  getYear: viewYear,
  markDirty,
  actions: { saveDefaultRates, saveTemplate, resetRates, defaultsNote },
});

/* ---------- export / import ---------- */

const fileStem = () => `mortgage-easy-plan-${(state.plan.name || "plan").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${new Date().toISOString().slice(0, 10)}`;

function exportCsv() {
  if (state.mode === "introducer") {
    const head = [["Mortgage Easy introducer plan (confidential)"], ["Plan", state.plan.name], ["Introducer", state.plan.introducer],
      ["Starts", M.monthLabel(planStart())], ["Exported", new Date().toISOString()], ["Note", LEADS_NOTE], []];
    download(`${fileStem()}.csv`, "text/csv;charset=utf-8", toCsv([...head, ...intro.csvRows()]));
    return;
  }
  const ctx = computeContext();
  const { month, months12, year1, sc, rates, cal, start, year } = ctx;
  const T = month.total;
  const R = month.byType.remortgage;
  const P = month.byType.purchase;
  const scenarioLabel = M.SCENARIOS.find((s) => s.key === state.scenario).label;
  const rows = [
    ["Mortgage Easy earnings plan (confidential)"],
    ["Plan", state.plan.name], ["Adviser", state.plan.adviser], ["Supervisor", state.plan.supervisor || ""], ["Starts", M.monthLabel(start)],
    ["Scenario", scenarioLabel], ["Exported", new Date().toISOString()], ["Note", HOLIDAY_NOTE],
    [],
    ["Adviser earnings (steady)", "Remortgage", "Purchase", "Total per month", "Total per year"],
  ];
  const line = (label, fn) => rows.push([label, fn(R), fn(P), fn(T), fn(T) * 12]);
  line("On procuration and fees", (x) => x.adviserMortgage);
  line("On own-customer introductions", (x) => x.adviserIntro);
  line("On protection and GI", (x) => x.adviserProtection);
  line("Adviser", (x) => x.adviser);
  rows.push([], [`Calendar ${year}`, "Written", "Completions paid", "Adviser"]);
  for (const m of cal) rows.push([`${m.label} ${year}`, m.written, m.completions, m.adviser]);
  rows.push([], ["12-month forecast", "Written", "Completions paid", "Adviser"]);
  for (const m of months12) rows.push([M.monthLabel(start, m.month - 1), m.written, m.completions, m.adviser]);
  rows.push(["First 12 months", year1.written, year1.completions, year1.adviser]);
  const three = M.threeYear(sc, currentYears(), rates);
  rows.push([], ["Three-year forecast", "Written", "Completions paid", "Adviser"]);
  for (const y of three.years) rows.push([`Year ${y.year}`, y.written, y.completions, y.adviser]);
  rows.push([], ["Scenario comparison (steady year)", "Adviser"]);
  for (const s of M.SCENARIOS) rows.push([s.label, M.computeMonth(M.scenarioOf(state.plan, s.key), rates).total.adviser * 12]);
  rows.push([], ["Inputs", "Remortgage", "Purchase"]);
  for (const f of M.CASE_FIELDS) rows.push([f.label, Number(sc.remortgage[f.key]), Number(sc.purchase[f.key])]);
  rows.push([], ["This adviser's commission", "Value"]);
  for (const f of ADVISER_COMMISSION) rows.push([f.label, Number(rates[f.key])]);
  download(`${fileStem()}.csv`, "text/csv;charset=utf-8", toCsv(rows));
}

function exportJson() {
  const body = { type: "mortgage-easy-plan", version: 2, exportedAt: new Date().toISOString(), plan: M.cleanPlan(state.plan) };
  download(`${fileStem()}.json`, "application/json", JSON.stringify(body, null, 2));
}

async function importJson(file) {
  try {
    if (file.size > 200 * 1024) throw new Error("File too large.");
    const data = JSON.parse(await file.text());
    if (!data || data.type !== "mortgage-easy-plan" || !data.plan) throw new Error("Not a Mortgage Easy plan export.");
    if (planKind(data.plan) !== state.mode) throw new Error(`This is ${state.mode === "introducer" ? "an adviser" : "an introducer"} plan: switch calculator first.`);
    if (!confirmDiscard()) return;
    const plan = normalisePlan({ ...data.plan, rates: data.plan.rates || data.rates });
    setPlan(plan, null);
    markDirty();
    setStatus(`Imported “${plan.name}” as a new unsaved plan.`, "ok");
  } catch (err) {
    setStatus(`Import failed: ${err.message}`, "error");
  }
}

/* ---------- start ---------- */

function ensureYear(select, year) {
  if ([...select.options].some((o) => o.value === String(year))) return;
  const after = [...select.options].find((o) => Number(o.value) > year);
  select.insertBefore(h("option", { value: String(year), text: String(year) }), after || null);
}

function wireToolbar() {
  const years = Array.from({ length: 13 }, (_, i) => today.getFullYear() - 2 + i);
  for (const id of ["start-year", "cal-year"]) $(id).replaceChildren(...years.map((y) => h("option", { value: String(y), text: String(y) })));
  $("start-month").replaceChildren(...M.MONTH_NAMES.map((m, i) => h("option", { value: String(i + 1), text: m })));
  const setStart = () => {
    state.plan.start = { year: Number($("start-year").value), month: Number($("start-month").value) };
    ensureYear($("cal-year"), viewYear());
    $("cal-year").value = String(viewYear());
    markDirty();
    scheduleRender();
  };
  $("start-month").addEventListener("change", setStart);
  $("start-year").addEventListener("change", setStart);
  $("cal-year").addEventListener("change", (e) => { state.calYear = Number(e.target.value); scheduleRender(); });
  $("plan-name").addEventListener("input", (e) => { state.plan.name = e.target.value; markDirty(); });
  $("plan-adviser").addEventListener("input", (e) => { state.plan[whoKey()] = e.target.value; markDirty(); });
  $("plan-supervisor").addEventListener("input", (e) => { state.plan.supervisor = e.target.value; markDirty(); });
  $("filter-supervisor").addEventListener("change", (e) => { state.filter.supervisor = e.target.value; renderPlanPickers(); renderSummary(); });
  $("filter-who").addEventListener("change", (e) => { state.filter.who = e.target.value; renderPlanPickers(); renderSummary(); });
  for (const b of $("mode-tabs").children) b.addEventListener("click", () => setMode(b.dataset.mode));
  $("plan-select").addEventListener("change", (e) => openPlan(e.target.value));
  $("btn-save").addEventListener("click", () => savePlan(false));
  $("btn-save-new").addEventListener("click", () => savePlan(true));
  $("btn-delete").addEventListener("click", deletePlan);
  $("btn-print").addEventListener("click", () => window.print());
  $("btn-csv").addEventListener("click", exportCsv);
  $("btn-json").addEventListener("click", exportJson);
  $("import-file").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (file) importJson(file);
  });
  window.addEventListener("beforeunload", (e) => {
    if (state.dirty) { e.preventDefault(); e.returnValue = ""; }
  });
}

async function start() {
  buildInputs();
  buildPanels();
  intro.build();
  wireToolbar();
  showPanel();
  state.plan = newPlan();
  try {
    const data = await api("/api/admin/assumptions");
    state.user = data.user;
    state.assumptions = data.assumptions;
    if (data.assumptions && data.assumptions.rates) {
      state.defaultRates = M.cleanRates(data.assumptions.rates);
    } else {
      setStatus("No default rates are stored yet. Enter them under Assumptions and choose “Save these rates as defaults for new plans”.");
    }
    $("user").textContent = state.user ? `Signed in as ${state.user}` : "";
    state.plan = newPlan();
    await refreshPlanList();
  } catch (err) {
    setStatus(err.message, "error");
  }
  setPlan(state.plan, null);
}

start();
