/** Owner analytics: total received and the company split across saved plans. Not linked from the calculator. */
import * as M from "../model.js";
import { lineChart, donut } from "../charts.js";
import { icon } from "../icons.js";
import { h, gbp, gbp0, pctTxt, tableEl, download, toCsv, SPLIT } from "../ui.js";

const $ = (id) => document.getElementById(id);
const today = new Date();
const thisMonth = () => ({ year: today.getFullYear(), month: today.getMonth() + 1 });

const state = { plans: [], year: today.getFullYear(), basis: "calendar", supervisor: "", withIntro: false, off: new Set() };
const KEYS = ["total", "adviser", "introducer", "me", "renewalTotal"];
const ALL_SERIES = [{ key: "total", label: "Total received", cls: "c-fees" }, ...SPLIT];
const NONE = "__none__";

function setStatus(text, kind = "") {
  $("status").replaceChildren(text ? h("div", { class: `adm-alert ${kind ? `is-${kind}` : ""}`, text }) : "");
}

async function api(path) {
  let res;
  try {
    res = await fetch(path, { credentials: "same-origin" });
  } catch (_err) {
    throw new Error("Could not reach the server. Your sign-in may have expired: reload the page to sign in again.");
  }
  if (!/application\/json/.test(res.headers.get("content-type") || "")) throw new Error(`Unexpected response (${res.status}). Reload the page to sign in again.`);
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

const basisLabel = () => (state.basis === "calendar" ? `calendar ${state.year}` : state.basis === "first12" ? "the first 12 months of each plan" : "a steady year (annualised)");

/** Money for one plan on the chosen basis. Annualised introducer figures are new business only; renewals once running are shown alongside. */
function money(p) {
  const f = M.planFigures(p, p.start || thisMonth(), state.year);
  const src = state.basis === "calendar" ? f.calendar : state.basis === "first12" ? f.first12 : Object.fromEntries(Object.entries(f.steady).map(([k, v]) => [k, v * 12]));
  const out = Object.fromEntries(KEYS.map((k) => [k, Number(src[k]) || 0]));
  if (state.basis === "annual") out.renewalTotal = f.renewal ? f.renewal.total * 12 : 0;
  return { out, months: f.calendarMonths };
}

const addUp = (list) => list.reduce((a, b) => { for (const k of KEYS) a[k] += b[k]; return a; }, Object.fromEntries(KEYS.map((k) => [k, 0])));
const margin = (x) => (x.total > 0 ? pctTxt(Math.round((x.me / x.total) * 1000) / 10) : "—");
const starts = (p) => (p.start ? M.monthLabel(p.start) : "Not set");
const supervisorMatch = (p) => !state.supervisor || (state.supervisor === NONE ? !p.supervisor : p.supervisor === state.supervisor);

function includeBox(p) {
  const box = h("input", { type: "checkbox", "aria-label": `Include ${p.name}` });
  box.checked = !state.off.has(p.id);
  box.addEventListener("change", () => { if (box.checked) state.off.delete(p.id); else state.off.add(p.id); render(); });
  return h("span", null, box, " ", p.name);
}

function render() {
  const advRows = state.plans.filter((p) => p.kind === "adviser" && supervisorMatch(p)).map((p) => ({ p, ...money(p) }));
  const introRows = state.plans.filter((p) => p.kind === "introducer").map((p) => ({ p, ...money(p) }));
  const on = (r) => !state.off.has(r.p.id);
  $("with-intro").disabled = Boolean(state.supervisor);
  const counted = [...advRows.filter(on), ...(state.withIntro && !state.supervisor ? introRows.filter(on) : [])];
  const total = addUp(counted.map((r) => r.out));

  const kpi = (iconName, label, value, sub, cls = "") => h("div", { class: `card kpi ${cls}` },
    h("span", { class: "kpi-icon" }, icon(iconName)),
    h("div", null, h("div", { class: "kpi-label", text: label }), h("div", { class: "kpi-value", text: value }), h("div", { class: "kpi-sub", text: sub })));
  const share = (v) => (total.total > 0 ? `${Math.round((v / total.total) * 100)}% of received` : "");
  $("kpis").replaceChildren(
    kpi("building", "Total received", gbp0(total.total), `${counted.length} plan${counted.length === 1 ? "" : "s"} · ${basisLabel()}`, "k-amber"),
    kpi("user", "Advisers", gbp0(total.adviser), share(total.adviser)),
    kpi("users", "External introducers", gbp0(total.introducer), share(total.introducer), "k-slate"),
    kpi("chart", "Mortgage Easy margin", gbp0(total.me), `${margin(total)} margin · no costs deducted`, "k-green"),
  );

  $("split-note").textContent = `Money received and how it splits, for ${basisLabel()}.` +
    (state.basis === "calendar" ? " The chart shows each month of the year." : " The month-by-month chart is shown for calendar years only.");
  if (state.basis === "calendar") {
    const months = M.MONTH_NAMES.map((label, i) => {
      const v = { total: 0, adviser: 0, introducer: 0, me: 0 };
      for (const r of counted) for (const k of Object.keys(v)) v[k] += r.months[i][k] || 0;
      return { label, values: v };
    });
    lineChart($("chart-months"), months, ALL_SERIES, { title: `Calendar ${state.year}` });
  } else {
    $("chart-months").replaceChildren();
  }
  donut($("chart-split"), SPLIT.map((s) => ({ label: s.label, value: total[s.key], cls: s.cls })), gbp0(total.total));

  const cells = (x) => [gbp(x.total), gbp(x.adviser), gbp(x.introducer), gbp(x.me), margin(x)];
  const advTotal = addUp(advRows.filter(on).map((r) => r.out));
  $("advisers").replaceChildren(advRows.length
    ? tableEl(["Plan", "Adviser", "Supervisor", "Starts", "Received", "Adviser", "Introducer", "Mortgage Easy", "Margin"], [
      ...advRows.map((r) => ({ cls: on(r) ? null : "is-sub", cells: [includeBox(r.p), r.p.adviser || "—", r.p.supervisor || "—", starts(r.p), ...cells(r.out)] })),
      { cls: "is-me", cells: ["Adviser plans (ticked)", "", "", "", ...cells(advTotal)] },
    ])
    : h("p", { class: "note", text: "No saved adviser plans match." }));

  const groups = [...new Set(advRows.filter(on).map((r) => r.p.supervisor || ""))].sort((a, b) => a.localeCompare(b));
  $("supervisors").replaceChildren(groups.length
    ? tableEl(["Supervisor", "Plans", "Received", "Adviser", "Introducer", "Mortgage Easy", "Margin"],
      groups.map((g) => {
        const rows = advRows.filter((r) => on(r) && (r.p.supervisor || "") === g);
        return { cells: [g || "(not set)", String(rows.length), ...cells(addUp(rows.map((r) => r.out)))] };
      }))
    : h("p", { class: "note", text: "No ticked adviser plans." }));

  const introTotal = addUp(introRows.filter(on).map((r) => r.out));
  const renewalHead = state.basis === "annual" ? "Renewals received / year (once running, not included)" : "…of which renewals";
  $("introducers").replaceChildren(introRows.length
    ? tableEl(["Plan", "Introducer", "Starts", "Received", "Adviser", "Introducer", "Mortgage Easy", "Margin", renewalHead], [
      ...introRows.map((r) => ({ cls: on(r) ? null : "is-sub", cells: [includeBox(r.p), r.p.introducer || "—", starts(r.p), ...cells(r.out), gbp(r.out.renewalTotal)] })),
      { cls: "is-me", cells: ["Introducer plans (ticked)", "", "", ...cells(introTotal), gbp(introTotal.renewalTotal)] },
    ])
    : h("p", { class: "note", text: "No saved introducer plans." }));
}

function exportCsv() {
  const rows = [["Mortgage Easy owner analytics (confidential)"], ["Figures for", basisLabel()], ["Exported", new Date().toISOString()], [],
    ["Plan", "Type", "Adviser / introducer", "Supervisor", "Starts", "Included", "Received", "Adviser", "Introducer", "Mortgage Easy", "Renewals received"]];
  for (const p of state.plans) {
    if (p.kind === "adviser" && !supervisorMatch(p)) continue;
    const { out } = money(p);
    rows.push([p.name, p.kind, (p.kind === "introducer" ? p.introducer : p.adviser) || "", p.supervisor || "", starts(p),
      state.off.has(p.id) || (p.kind === "introducer" && (!state.withIntro || state.supervisor)) ? "no" : "yes", out.total, out.adviser, out.introducer, out.me, out.renewalTotal]);
  }
  download(`mortgage-easy-owner-analytics-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8", toCsv(rows));
}

async function start() {
  const years = Array.from({ length: 13 }, (_, i) => today.getFullYear() - 2 + i);
  $("year").replaceChildren(...years.map((y) => h("option", { value: String(y), text: String(y) })));
  $("year").value = String(state.year);
  $("year").addEventListener("change", (e) => { state.year = Number(e.target.value); render(); });
  $("basis").addEventListener("change", (e) => { state.basis = e.target.value; render(); });
  $("supervisor").addEventListener("change", (e) => { state.supervisor = e.target.value; render(); });
  $("with-intro").addEventListener("change", (e) => { state.withIntro = e.target.checked; render(); });
  $("btn-print").addEventListener("click", () => window.print());
  $("btn-csv").addEventListener("click", exportCsv);
  try {
    const [a, s] = await Promise.all([api("/api/admin/assumptions"), api("/api/admin/scenarios?all=1")]);
    $("user").textContent = a.user ? `Signed in as ${a.user}` : "";
    const defaults = M.cleanRates((a.assumptions && a.assumptions.rates) || {});
    state.plans = s.plans.flatMap((p) => {
      try {
        const clean = M.cleanPlan(p);
        return [{ id: p.id, ...clean, rates: clean.rates || defaults }];
      } catch (_err) { return []; }
    }).sort((x, y) => x.name.localeCompare(y.name));
    const adviserPlans = state.plans.filter((p) => p.kind === "adviser");
    const names = [...new Set(adviserPlans.map((p) => p.supervisor).filter(Boolean))].sort((x, y) => x.localeCompare(y));
    $("supervisor").append(...names.map((v) => h("option", { value: v, text: v })),
      adviserPlans.some((p) => !p.supervisor) ? h("option", { value: NONE, text: "(not set)" }) : "");
  } catch (err) {
    setStatus(err.message, "error");
  }
  render();
}

start();
