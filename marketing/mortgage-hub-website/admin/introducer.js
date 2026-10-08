/** Introducer plans: weekly leads from one introducer through to completions and renewals. */
import * as M from "./model.js";
import { lineChart, donut, funnel } from "./charts.js";
import { icon } from "./icons.js";
import { h, gbp, gbp0, count, pctTxt, tableEl, fmtField, LEADS_NOTE, SPLIT } from "./ui.js";

const YEARS = 7;

const GROUPS = [
  { label: "Leads", icon: "calendar", keys: { leadsWeek: "Leads sent per week" } },
  { label: "Conversion", icon: "funnel", keys: { showRatePct: "Show rate", seenWeek: "Seen per week", signUpPct: "Seen to sign-up", completionPct: "Sign-up to completion" } },
  { label: "Mortgage and fee", icon: "home", keys: { avgLoan: "Average mortgage", brokerFee: "Broker fee" } },
  { label: "Renewals", icon: "trend", keys: { renewalRetainedPct: "Retained at renewal", renewal2yPct: "On 2-year terms", renewalFee: "Renewal fee" } },
  { label: "Timing", icon: "clock", keys: { lagMonths: "Months to completion" } },
];

const COMMISSION_LABELS = { introducerPct: "Introducer commission", adviserMortgagePct: "Adviser commission" };

/**
 * els: { fields, kpis, nav, panels }; field(f, get, set, label) builds a number box that marks the plan dirty and re-renders.
 * actions: { saveDefaultRates(), saveTemplate(), resetRates(), defaultsNote() }
 */
export function createIntroducerView({ els, field, getPlan, markDirty, actions }) {
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
    for (const f of M.INTRO_COMMISSION_FIELDS) {
      const c = field(f, () => getPlan().rates[f.key], (v) => { getPlan().rates[f.key] = v; }, f.label);
      syncs.push(c.sync);
      grid.append(h("label", { class: "in-label", for: c.input.id }, COMMISSION_LABELS[f.key], h("span", { class: "field-hint", text: f.hint })), c.wrap);
    }
    els.fields.append(grid, h("p", { class: "field-hint holiday-note", text: LEADS_NOTE }));
  }

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
        const nb = r.newBusiness;
        const row = (label, k, cls) => ({ cls, cells: [label, gbp(nb[k]), gbp(nb[k] * 12), gbp(r.renewal[k] * 12)] });
        this.table.replaceChildren(tableEl(["", "New business / month", "New business / year", "Renewals / year (once running)"], [
          row("Introducer", "introducer", "is-total"),
          row("Adviser", "adviser"),
          row("Mortgage Easy margin", "me", "is-me"),
        ]));
        donut(this.chart, [
          { label: "Broker fees", value: r.atSignUp.introducer, cls: "c-fees" },
          { label: "Procuration", value: r.atCompletion.introducer, cls: "c-adviser" },
          { label: "Renewals (once running)", value: r.renewal.introducer, cls: "c-me" },
        ], `${gbp0((nb.introducer + r.renewal.introducer) * 12)}/yr`);
        funnel(this.funnel, [
          { label: "Leads", value: r.leads, sub: `${count(r.leadsWeek)} a week` },
          { label: "Seen", value: r.seen, sub: `${pctTxt(plan.inputs.showRatePct)} show rate` },
          { label: "Signed up", value: r.signUps, sub: `${pctTxt(plan.inputs.signUpPct)} of seen · broker fee taken` },
          { label: "Completed", value: r.completions, sub: `${pctTxt(plan.inputs.completionPct)} of sign-ups · procuration paid` },
          { label: "Renewals", value: r.renewals, sub: `${count(r.renewals2y)} at 2 years · ${count(r.renewals5y)} at 5 years` },
        ], count);
        const all = [...M.INTRO_FIELDS.map((f) => [f.label, fmtField(f, plan.inputs[f.key])]),
          ...M.INTRO_COMMISSION_FIELDS.map((f) => [f.label, pctTxt(plan.rates[f.key])])];
        this.inputs.replaceChildren(tableEl(["Input", "Value"], all.map((cells) => ({ cells }))));
      },
    },
    {
      key: "forecast",
      label: `${YEARS}-year forecast`,
      icon: "trend",
      intro: `From a standing start in month 1 with the same leads every month. Broker fees arrive at sign-up, procuration at completion, and renewal fees 2 and 5 years after completion, so ${YEARS} years shows both renewal waves.`,
      build(body) {
        this.chart = h("div", { class: "chart" });
        this.table = h("div");
        body.append(this.chart, this.table);
      },
      update({ months, years }) {
        lineChart(this.chart, months.map((m) => ({ label: m.month % 12 === 1 ? `Y${Math.ceil(m.month / 12)}` : "", values: m })), SPLIT, { labelEvery: 1, title: `${YEARS}-year forecast` });
        const total = years.reduce((a, y) => { for (const [k, v] of Object.entries(y)) if (k !== "year") a[k] = (a[k] || 0) + v; return a; }, {});
        const row = (label, y, cls) => ({ cls, cells: [label, count(y.signUps), count(y.completions), count(y.renewals), gbp(y.introducer), gbp(y.adviser), gbp(y.me), gbp(y.renewalMe)] });
        this.table.replaceChildren(tableEl(["", "Sign-ups", "Completions", "Renewals", "Introducer", "Adviser", "Mortgage Easy", "…of which renewals"],
          [...years.map((y) => row(`Year ${y.year}`, y)), row(`${YEARS} years`, total, "is-total")]));
      },
    },
    {
      key: "renewals",
      label: "Renewals",
      icon: "layers",
      intro: "Retained completed cases come back for a renewal when their product ends: 2 years or 5 years after completion. The renewal fee is split between the introducer, adviser and Mortgage Easy on the same commission terms as broker fees.",
      update({ r, plan }) {
        const firstMonth = (term) => `month ${r.lag + term.months + 1}`;
        const steady = (k) => r.renewal[k];
        this.body.replaceChildren(
          tableEl(["Each month's sign-ups", "Value"], [
            { cells: ["Completions", count(r.completions)] },
            { cells: [`Retained at renewal (${pctTxt(plan.inputs.renewalRetainedPct)})`, count(r.renewals)], cls: "is-total" },
            ...M.RENEWAL_TERMS.map((t) => ({ cells: [`…on ${t.label} terms, first renewing ${firstMonth(t)}`, count(r[t.key])], cls: "is-sub" })),
            { cells: ["Renewal fee each", gbp(plan.inputs.renewalFee)] },
          ]),
          h("h3", { text: "Once both renewal waves are running" }),
          tableEl(["", "Per month", "Per year"], [
            ...SPLIT.map((s) => ({ cls: s.key === "me" ? "is-me" : null, cells: [s.key === "me" ? "Mortgage Easy margin" : s.label, gbp(steady(s.key)), gbp(steady(s.key) * 12)] })),
          ]),
          h("p", { class: "note", text: "Only the first renewal of each case is counted, and no procuration is assumed on renewals." }),
        );
      },
    },
    {
      key: "assumptions",
      label: "Assumptions",
      icon: "list",
      intro: "Procuration rates for this plan, saved with it. Commission levels are with the inputs.",
      build(body) {
        const fields = M.BUSINESS_RATE_FIELDS.filter((f) => f.key === "procRatePct" || f.key === "procRetainedPct");
        this.controls = fields.map((f) => field(f, () => getPlan().rates[f.key], (v) => { getPlan().rates[f.key] = v; }, f.label));
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
          f("Procuration", `completions × average mortgage × (procuration rate × share received after HLP)\n${n(r.completions)} × ${gbp0(c.avgLoan)} × (${pctTxt(rates.procRatePct)} × ${pctTxt(rates.procRetainedPct)}) = ${gbp(r.proc)}`),
          f("Introducer", `${pctTxt(rates.introducerPct)} × (broker fees + procuration)\n${pctTxt(rates.introducerPct)} × ${gbp(r.fees + r.proc)} = ${gbp(r.newBusiness.introducer)}`),
          f("Adviser", `${pctTxt(rates.adviserMortgagePct)} × (broker fees + procuration)\n${pctTxt(rates.adviserMortgagePct)} × ${gbp(r.fees + r.proc)} = ${gbp(r.newBusiness.adviser)}`),
          f("Mortgage Easy margin", `what remains after the introducer and adviser = ${gbp(r.newBusiness.me)}`),
          f("Renewals", `completions × retained × renewal fee, split ${pctTxt(c.renewal2yPct)} at 2 years / ${pctTxt(100 - c.renewal2yPct)} at 5 years after completion\n${n(r.completions)} × ${pctTxt(c.renewalRetainedPct)} × ${gbp(c.renewalFee)} = ${gbp(r.renewalFees)} a month once running, shared on the same terms`),
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
        p.intro ? h("p", { text: p.intro }) : null, p.body);
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
    const r = M.computeIntroducer(plan.inputs, plan.rates);
    const months = M.introducerForecast(plan.inputs, plan.rates, YEARS * 12);
    return { plan, r, months, years: M.sumByYear(months) };
  }

  function renderKpis({ r, years }) {
    const nb = r.newBusiness;
    const kpi = (iconName, label, value, sub, cls = "") => h("div", { class: `card kpi ${cls}` },
      h("span", { class: "kpi-icon" }, icon(iconName)),
      h("div", null, h("div", { class: "kpi-label", text: label }), h("div", { class: "kpi-value", text: value }), h("div", { class: "kpi-sub", text: sub })));
    els.kpis.replaceChildren(
      kpi("users", "Introducer / month", gbp0(nb.introducer), `${gbp0(nb.introducer * 12)} a year · ${gbp0(years[0].introducer)} in first 12 months`, "k-slate"),
      kpi("user", "Adviser / month", gbp0(nb.adviser), `${gbp0(nb.adviser * 12)} a year · ${gbp0(years[0].adviser)} in first 12 months`),
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
      const { plan, r, years } = context();
      const rows = [["Monthly (steady)", "New business / month", "New business / year", "Renewals / year (once running)"]];
      for (const s of SPLIT) rows.push([s.key === "me" ? "Mortgage Easy margin" : s.label, r.newBusiness[s.key], r.newBusiness[s.key] * 12, r.renewal[s.key] * 12]);
      rows.push([], [`${YEARS}-year forecast`, "Sign-ups", "Completions", "Renewals", "Introducer", "Adviser", "Mortgage Easy", "Mortgage Easy from renewals"]);
      for (const y of years) rows.push([`Year ${y.year}`, y.signUps, y.completions, y.renewals, y.introducer, y.adviser, y.me, y.renewalMe]);
      rows.push([], ["Inputs", "Value"]);
      for (const f of M.INTRO_FIELDS) rows.push([f.label, Number(plan.inputs[f.key])]);
      rows.push([], ["Rates", "Value"]);
      for (const f of [...M.INTRO_COMMISSION_FIELDS, ...M.BUSINESS_RATE_FIELDS.filter((x) => x.key.startsWith("proc"))]) rows.push([f.label, Number(plan.rates[f.key])]);
      return rows;
    },
  };
}
