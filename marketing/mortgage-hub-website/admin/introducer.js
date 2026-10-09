/**
 * Introducer plans: weekly leads from one introducer through to completions and renewals.
 * Shows the introducer's own commission only; the adviser's share and Mortgage Easy's margin are on the owner page.
 */
import * as M from "./model.js";
import { lineChart, donut, funnel } from "./charts.js";
import { icon } from "./icons.js";
import { h, gbp, gbp0, count, pctTxt, tableEl, fmtField, LEADS_NOTE } from "./ui.js";

const YEARS = 7;
const SERIES = [{ key: "introducer", label: "Introducer commission", cls: "c-introducer" }];
const COMMISSION = M.RATE_FIELDS.filter((f) => f.key === "introducerPct");

/**
 * Introducers see one net procuration rate (what Mortgage Easy receives). It is stored as the lender rate
 * and retained share like every plan, so editing it scales the lender rate and leaves the retained share alone.
 */
const NET_PROC = { key: "netProcPct", label: "Net procuration fee", hint: "% of the loan Mortgage Easy receives", unit: "%", min: 0, max: 5, step: 0.0001, decimals: 4 };
const netProc = (rates) => (rates.procRatePct * rates.procRetainedPct) / 100;
function setNetProc(rates, v) {
  if (!(rates.procRetainedPct > 0)) rates.procRetainedPct = 100;
  rates.procRatePct = Math.min(5, (v * 100) / rates.procRetainedPct);
}

const GROUPS = [
  { label: "Leads", icon: "calendar", keys: { leadsWeek: "Leads sent per week" } },
  { label: "Conversion", icon: "funnel", keys: { showRatePct: "Show rate", seenWeek: "Seen per week", signUpPct: "Seen to sign-up", completionPct: "Sign-up to completion" } },
  { label: "Mortgage and fee", icon: "home", keys: { avgLoan: "Average mortgage", brokerFee: "Broker fee" } },
  { label: "Renewals", icon: "trend", keys: { renewalRetainedPct: "Retained at renewal", renewal2yPct: "On 2-year terms", renewalFee: "Renewal fee" } },
  { label: "Timing", icon: "clock", keys: { lagMonths: "Months to completion" } },
];

/**
 * els: { fields, kpis, nav, panels }; field(f, get, set, label) builds a number box that marks the plan dirty and re-renders.
 * getStart() and getYear() give the plan's start month and the calendar year being viewed.
 * actions: { saveDefaultRates(), saveTemplate(), resetRates(), defaultsNote() }
 */
export function createIntroducerView({ els, field, getPlan, getStart, getYear, markDirty, actions }) {
  const syncs = [];
  const live = [];
  let panelKey = "overview";

  function buildInputs() {
    const fields = Object.fromEntries(M.INTRO_FIELDS.map((f) => [f.key, f]));
    const grid = h("div", { class: "in-grid in-grid-intro" });
    for (const g of GROUPS) {
      grid.append(h("div", { class: "in-group" }, icon(g.icon), h("span", { text: g.label })));
      for (const [key, short] of Object.entries(g.keys)) {
        if (key === "seenWeek") {
          const out = h("output", { class: "in-calc" });
          live.push((r) => { out.textContent = count(r.seenWeek); });
          grid.append(h("span", { class: "in-label" }, short, h("span", { class: "field-hint", text: "Leads × show rate" })), out);
          continue;
        }
        const f = fields[key];
        const c = field(f, () => getPlan().inputs[key], (v) => { getPlan().inputs[key] = v; }, f.label);
        syncs.push(c.sync);
        grid.append(h("label", { class: "in-label", for: c.input.id }, short, f.hint ? h("span", { class: "field-hint", text: f.hint }) : null), c.wrap);
      }
    }
    grid.append(h("div", { class: "in-group" }, icon("user"), h("span", { text: "Commission (this introducer's terms)" })));
    for (const f of COMMISSION) {
      const c = field(f, () => getPlan().rates[f.key], (v) => { getPlan().rates[f.key] = v; }, f.label);
      syncs.push(c.sync);
      grid.append(h("label", { class: "in-label", for: c.input.id }, "Introducer commission", h("span", { class: "field-hint", text: f.hint })), c.wrap);
    }
    els.fields.append(grid, h("p", { class: "field-hint holiday-note", text: LEADS_NOTE }));
  }

  const yearRange = (start, y) => `${M.monthLabel(start, (y - 1) * 12)} to ${M.monthLabel(start, y * 12 - 1)}`;

  const panels = [
    {
      key: "overview",
      label: "Overview",
      intro: "One steady month of leads from this introducer once completions are being paid. Renewals are shown separately because they only start two years after completion.",
      build(body) {
        body.append(h("div", { class: "adm-alert holiday-alert" }, icon("calendar"), h("span", { text: LEADS_NOTE })));
        this.table = h("div");
        this.chart = h("div", { class: "chart chart-donut" });
        this.funnel = h("div", { class: "chart" });
        this.inputs = h("div");
        this.notes = h("textarea", { id: "intro-notes", maxlength: "2000", oninput: () => { getPlan().notes = this.notes.value; markDirty(); } });
        body.append(this.table,
          h("h3", { text: "Monthly pipeline" }), this.funnel,
          h("h3", { text: "Introducer commission by source (yearly)" }), this.chart,
          h("h3", { text: "Inputs used" }), this.inputs,
          h("h3", null, h("label", { for: "intro-notes", text: "Plan notes" })), this.notes);
      },
      sync() { if (document.activeElement !== this.notes) this.notes.value = getPlan().notes || ""; },
      update({ r, plan }) {
        const nb = r.newBusiness.introducer;
        const ren = r.renewal.introducer;
        const row = (label, v, cls) => ({ cls, cells: [label, gbp(v), gbp(v * 12)] });
        this.table.replaceChildren(tableEl(["Introducer commission", "Per month", "Per year"], [
          row("On broker fees (at sign-up)", r.atSignUp.introducer, "is-sub"),
          row("On procuration (at completion)", r.atCompletion.introducer, "is-sub"),
          row("New business", nb, "is-total"),
          row("Renewals (once both waves are running)", ren),
          row("With renewals running", nb + ren, "is-total"),
        ]));
        donut(this.chart, [
          { label: "Broker fees", value: r.atSignUp.introducer, cls: "c-fees" },
          { label: "Procuration", value: r.atCompletion.introducer, cls: "c-adviser" },
          { label: "Renewals (once running)", value: ren, cls: "c-me" },
        ], `${gbp0((nb + ren) * 12)}/yr`);
        funnel(this.funnel, [
          { label: "Leads", value: r.leads, sub: `${count(r.leadsWeek)} a week` },
          { label: "Seen", value: r.seen, sub: `${pctTxt(plan.inputs.showRatePct)} show rate` },
          { label: "Signed up", value: r.signUps, sub: `${pctTxt(plan.inputs.signUpPct)} of seen · broker fee taken` },
          { label: "Completed", value: r.completions, sub: `${pctTxt(plan.inputs.completionPct)} of sign-ups · procuration paid` },
          { label: "Renewals", value: r.renewals, sub: `${count(r.renewals2y)} at 2 years · ${count(r.renewals5y)} at 5 years` },
        ], count);
        const all = [...M.INTRO_FIELDS.map((f) => [f.label, fmtField(f, plan.inputs[f.key])]),
          [NET_PROC.label, pctTxt(Math.round(netProc(plan.rates) * 10000) / 10000)],
          ...COMMISSION.map((f) => [f.label, pctTxt(plan.rates[f.key])])];
        this.inputs.replaceChildren(tableEl(["Input", "Value"], all.map((cells) => ({ cells }))));
      },
    },
    {
      key: "calendar",
      label: "Calendar year",
      icon: "calendar",
      build(body) {
        this.note = h("p");
        this.chart = h("div", { class: "chart" });
        this.table = h("div");
        body.append(this.note, this.chart, this.table);
      },
      update({ start, year, cal }) {
        this.note.textContent = `What this introducer earns in ${year}, month by month, with the plan starting in ${M.monthLabel(start)}. Change the year at the top of the page.`;
        lineChart(this.chart, cal.map((m) => ({ label: m.label, values: m })), SERIES, { title: `Calendar ${year}` });
        const total = M.sumAll(cal);
        const row = (label, m, cls) => ({ cls, cells: [label, count(m.signUps), count(m.completions), count(m.renewals), gbp(m.introducer), gbp(m.renewalIntroducer)] });
        this.table.replaceChildren(tableEl(["Month", "Sign-ups", "Completions", "Renewals", "Introducer", "…of which renewals"],
          [...cal.map((m) => row(`${m.label} ${year}`, m, m.planMonth ? null : "is-sub")), row(`Total ${year}`, total, "is-total")]));
      },
    },
    {
      key: "forecast",
      label: `${YEARS}-year forecast`,
      icon: "trend",
      intro: `From a standing start with the same leads every month. Broker fees arrive at sign-up, procuration at completion, and renewal fees 2 and 5 years after completion, so ${YEARS} years shows both renewal waves. Years run from the plan's start month.`,
      build(body) {
        this.chart = h("div", { class: "chart" });
        this.table = h("div");
        body.append(this.chart, this.table);
      },
      update({ months, years, start }) {
        lineChart(this.chart, months.map((m) => ({ label: m.month % 12 === 1 ? `Y${Math.ceil(m.month / 12)}` : "", values: m })), SERIES, { labelEvery: 1, title: `${YEARS}-year forecast` });
        const total = M.sumAll(years);
        const row = (label, y, cls) => ({ cls, cells: [label, count(y.signUps), count(y.completions), count(y.renewals), gbp(y.introducer), gbp(y.renewalIntroducer)] });
        this.table.replaceChildren(tableEl(["", "Sign-ups", "Completions", "Renewals", "Introducer", "…of which renewals"],
          [...years.map((y) => row(`Year ${y.year} (${yearRange(start, y.year)})`, y)), row(`${YEARS} years`, total, "is-total")]));
      },
    },
    {
      key: "renewals",
      label: "Renewals",
      icon: "layers",
      intro: "Retained completed cases come back for a renewal when their product ends: 2 years or 5 years after completion. The introducer earns the same commission on the renewal fee as on broker fees.",
      update({ r, plan, start }) {
        const firstMonth = (term) => `month ${r.lag + term.months + 1} (${M.monthLabel(start, r.lag + term.months)})`;
        this.body.replaceChildren(
          tableEl(["Each month's completions", "Value"], [
            { cells: ["Completions", count(r.completions)] },
            { cells: [`Retained at renewal (${pctTxt(plan.inputs.renewalRetainedPct)})`, count(r.renewals)], cls: "is-total" },
            ...M.RENEWAL_TERMS.map((t) => ({ cells: [`…on ${t.label} terms, first renewing ${firstMonth(t)}`, count(r[t.key])], cls: "is-sub" })),
            { cells: ["Renewal fee each", gbp(plan.inputs.renewalFee)] },
          ]),
          h("h3", { text: "Once both renewal waves are running" }),
          tableEl(["", "Per month", "Per year"], [
            { cls: "is-total", cells: ["Introducer commission on renewals", gbp(r.renewal.introducer), gbp(r.renewal.introducer * 12)] },
          ]),
          h("p", { class: "note", text: "Only the first renewal of each case is counted, and no procuration is assumed on renewals." }),
        );
      },
    },
    {
      key: "assumptions",
      label: "Assumptions",
      icon: "list",
      intro: "The net procuration fee for this plan, saved with it. The introducer's commission is with the inputs.",
      build(body) {
        const fields = [NET_PROC];
        this.controls = [field(NET_PROC, () => netProc(getPlan().rates), (v) => setNetProc(getPlan().rates, v), NET_PROC.label)];
        const grid = h("div", { class: "in-grid in-grid-one" });
        fields.forEach((f, i) => grid.append(
          h("label", { class: "in-label", for: this.controls[i].input.id }, f.label, f.hint ? h("span", { class: "field-hint", text: f.hint }) : null),
          this.controls[i].wrap));
        this.saved = h("p", { class: "note" });
        body.append(grid,
          h("div", { class: "adm-toolbar no-print" },
            h("button", { type: "button", class: "btn btn-green", text: "Save these rates as defaults for new plans", onclick: () => actions.saveDefaultRates() }),
            h("button", { type: "button", class: "btn btn-ghost", text: "Use these inputs for new introducer plans", onclick: () => actions.saveTemplate() }),
            h("button", { type: "button", class: "btn btn-ghost", text: "Reset this plan's rates to defaults", onclick: () => actions.resetRates() })),
          this.saved);
      },
      sync() { for (const c of this.controls) c.sync(); },
      update() { this.saved.textContent = actions.defaultsNote(); },
    },
    {
      key: "formulas",
      label: "How it's calculated",
      icon: "doc",
      intro: "Each step with this plan's numbers.",
      update({ r, plan }) {
        const c = plan.inputs;
        const rates = plan.rates;
        const f = (title, formula) => h("div", { class: "formula" }, h("strong", { text: title }), h("code", { text: formula }));
        const n = (v) => (v || 0).toLocaleString("en-GB", { maximumFractionDigits: 4 });
        this.body.replaceChildren(
          f("Leads per month", `leads per week × ${M.LEAD_WEEKS} weeks ÷ 12\n${n(c.leadsWeek)} × ${M.LEAD_WEEKS} ÷ 12 = ${n(r.leads)}`),
          f("Seen", `leads × show rate\n${n(r.leads)} × ${pctTxt(c.showRatePct)} = ${n(r.seen)}`),
          f("Sign-ups", `seen × seen-to-sign-up\n${n(r.seen)} × ${pctTxt(c.signUpPct)} = ${n(r.signUps)}`),
          f("Completions", `sign-ups × sign-up-to-completion\n${n(r.signUps)} × ${pctTxt(c.completionPct)} = ${n(r.completions)}`),
          f("Broker fees", `sign-ups × broker fee  (at sign-up, not refunded)\n${n(r.signUps)} × ${gbp(c.brokerFee)} = ${gbp(r.fees)}`),
          f("Procuration", `completions × average mortgage × net procuration fee\n${n(r.completions)} × ${gbp0(c.avgLoan)} × ${pctTxt(Math.round(netProc(rates) * 10000) / 10000)} = ${gbp(r.proc)}`),
          f("Introducer", `${pctTxt(rates.introducerPct)} × (broker fees + procuration)\n${pctTxt(rates.introducerPct)} × ${gbp(r.fees + r.proc)} = ${gbp(r.newBusiness.introducer)}`),
          f("Renewals", `completions × retained × renewal fee × introducer commission, split ${pctTxt(c.renewal2yPct)} at 2 years / ${pctTxt(100 - c.renewal2yPct)} at 5 years after completion\n${n(r.completions)} × ${pctTxt(c.renewalRetainedPct)} × ${gbp(c.renewalFee)} × ${pctTxt(rates.introducerPct)} = ${gbp(r.renewal.introducer)} a month once running`),
          f("Timing", `Broker fees at sign-up; procuration ${r.lag} month${r.lag === 1 ? "" : "s"} later at completion; renewals 24 and 60 months after completion.`),
        );
      },
    },
  ];

  function buildPanels() {
    for (const p of panels) {
      p.btn = h("button", { type: "button", text: p.label, onclick: () => { panelKey = p.key; showPanel(); } });
      els.nav.append(p.btn);
      p.section = h("section", { class: "card panel", "aria-label": p.label });
      p.body = h("div");
      p.section.append(h("h2", { class: "panel-title" }, h("span", { class: "panel-icon" }, icon(p.icon || "chart")), p.label),
        ...(p.intro ? [h("p", { text: p.intro })] : []), p.body);
      if (p.build) p.build(p.body);
      els.panels.append(p.section);
    }
    showPanel();
  }

  function showPanel() {
    for (const p of panels) {
      p.section.classList.toggle("is-off", p.key !== panelKey);
      p.btn.classList.toggle("is-active", p.key === panelKey);
    }
  }

  function context() {
    const plan = getPlan();
    const start = getStart();
    const year = getYear();
    const r = M.computeIntroducer(plan.inputs, plan.rates);
    const months = M.introducerForecast(plan.inputs, plan.rates, Math.max(YEARS * 12, M.monthsToYearEnd(start, year)));
    const cal = M.calendarSlice(months, start, year);
    const shown = months.slice(0, YEARS * 12);
    return { plan, r, start, year, cal, months: shown, years: M.sumByYear(shown) };
  }

  function renderKpis({ r, years, cal, start, year }) {
    const nb = r.newBusiness.introducer;
    const kpi = (iconName, label, value, sub, cls = "") => h("div", { class: `card kpi ${cls}` },
      h("span", { class: "kpi-icon" }, icon(iconName)),
      h("div", null, h("div", { class: "kpi-label", text: label }), h("div", { class: "kpi-value", text: value }), h("div", { class: "kpi-sub", text: sub })));
    els.kpis.replaceChildren(
      kpi("users", "Introducer / month", gbp0(nb), `${gbp0(nb * 12)} a year annualised · ${gbp0(years[0].introducer)} in first 12 months`, "k-slate"),
      kpi("calendar", `Calendar ${year}`, gbp0(M.sumAll(cal).introducer), `Introducer commission · plan starts ${M.monthLabel(start)}`),
      kpi("doc", "Sign-ups / month", count(r.signUps), `${count(r.completions)} complete · ${count(r.leadsWeek)} leads a week`, "k-amber"),
      kpi("trend", "Renewals / month", count(r.renewals), "Once running: 2-year from year 3, 5-year from year 6", "k-green"),
    );
  }

  return {
    build() { buildInputs(); buildPanels(); },
    sync() { for (const s of syncs) s(); for (const p of panels) if (p.sync) p.sync(); },
    render() {
      const ctx = context();
      for (const fn of live) fn(ctx.r);
      renderKpis(ctx);
      for (const p of panels) p.update(ctx);
    },
    csvRows() {
      const { plan, r, years, cal, start, year } = context();
      const nb = r.newBusiness.introducer;
      const rows = [["Introducer commission (steady)", "Per month", "Per year"],
        ["New business", nb, nb * 12], ["Renewals once running", r.renewal.introducer, r.renewal.introducer * 12]];
      rows.push([], [`Calendar ${year}`, "Sign-ups", "Completions", "Renewals", "Introducer"]);
      for (const m of cal) rows.push([`${m.label} ${year}`, m.signUps, m.completions, m.renewals, m.introducer]);
      rows.push([], [`${YEARS}-year forecast from ${M.monthLabel(start)}`, "Sign-ups", "Completions", "Renewals", "Introducer", "Introducer from renewals"]);
      for (const y of years) rows.push([`Year ${y.year}`, y.signUps, y.completions, y.renewals, y.introducer, y.renewalIntroducer]);
      rows.push([], ["Inputs", "Value"]);
      for (const f of M.INTRO_FIELDS) rows.push([f.label, Number(plan.inputs[f.key])]);
      rows.push([NET_PROC.label, netProc(plan.rates)]);
      for (const f of COMMISSION) rows.push([f.label, Number(plan.rates[f.key])]);
      return rows;
    },
  };
}
