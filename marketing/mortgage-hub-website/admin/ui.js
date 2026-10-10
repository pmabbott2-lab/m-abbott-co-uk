/** Shared DOM, formatting and table helpers for the admin calculators. */
import * as M from "./model.js";

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const gbpFmt = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const gbp0Fmt = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
export const gbp = (v) => gbpFmt.format(v || 0);
export const gbp0 = (v) => gbp0Fmt.format(v || 0);
export const count = (v) => (v || 0).toLocaleString("en-GB", { maximumFractionDigits: 2 });
export const pctTxt = (v) => `${(Number(v) || 0).toLocaleString("en-GB", { maximumFractionDigits: 4 })}%`;
export const clone = (v) => JSON.parse(JSON.stringify(v));

export const HOLIDAY_NOTE = `Appointments are entered per week. Monthly and yearly figures allow for ${M.HOLIDAY_WEEKS} weeks' holiday a year ` +
  `(${M.WORKING_WEEKS} working weeks), so one month = weekly × ${M.WORKING_WEEKS} ÷ 12, about ${M.WEEKS_PER_MONTH.toFixed(2)} weeks.`;
export const LEADS_NOTE = `Leads are entered per week and arrive all ${M.LEAD_WEEKS} weeks of the year, ` +
  `so one month = weekly × ${M.LEAD_WEEKS} ÷ 12, about ${M.LEAD_WEEKS_PER_MONTH.toFixed(2)} weeks.`;

export const SPLIT = [
  { key: "adviser", label: "Adviser", cls: "c-adviser" },
  { key: "introducer", label: "External introducer", cls: "c-introducer" },
  { key: "me", label: "Mortgage Easy", cls: "c-me" },
];

export function fmtField(f, v) {
  if (f.unit === "gbp") return Number(v) >= 1000 ? gbp0(v) : gbp(v);
  if (f.unit === "%") return pctTxt(v);
  if (f.unit === "months") return `${v} mo`;
  return count(Number(v));
}

let inputSeq = 0;

/** Number box with a £ / % / mo marker. `set` receives the clamped value. Returns the wrapper, the input and a sync function. */
export function numInput(f, get, set, label) {
  const input = h("input", { type: "number", id: `in-${++inputSeq}`, min: f.min, max: f.max, step: "any", inputmode: "decimal", "aria-label": label });
  input.addEventListener("input", () => {
    const raw = input.value.trim();
    if (raw === "") return;
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    set(Math.min(f.max, Math.max(f.min, f.integer ? Math.round(v) : v)));
  });
  const scale = 10 ** (f.decimals ?? 2);
  const shown = () => String(Math.round((Number(get()) || 0) * scale) / scale);
  input.addEventListener("change", () => { input.value = shown(); });
  const unit = f.unit === "gbp" ? "£" : f.unit === "%" ? "%" : f.unit === "months" ? "mo" : "";
  const wrap = h("span", { class: `num-wrap${f.unit === "gbp" ? " has-prefix" : unit ? " has-suffix" : ""}` },
    input, unit ? h("span", { class: "adorn", text: unit }) : null);
  const sync = () => { if (document.activeElement !== input) input.value = shown(); };
  return { wrap, input, sync };
}

/** Reads a typed amount such as "£60,000", "60 000" or "60k". Empty is 0; anything else unreadable is NaN. */
export function parseAmount(text) {
  const s = String(text || "").trim().toLowerCase().replace(/[£,\s]/g, "");
  if (!s) return 0;
  const m = /^(\d+(?:\.\d+)?)([km]?)$/.exec(s);
  if (!m) return NaN;
  return Number(m[1]) * (m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : 1);
}

export function tableEl(columns, rows) {
  return h("div", { class: "table-wrap" },
    h("table", { class: "adm-table" },
      h("thead", null, h("tr", null, columns.map((c, i) => h("th", { scope: "col", class: i ? "num" : null, text: c })))),
      h("tbody", null, rows.map((r) => h("tr", { class: r.cls || null },
        r.cells.map((c, i) => (i === 0 ? h("th", { scope: "row" }, c) : h("td", { class: "num" }, c))))))));
}

export function csvCell(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v.toFixed(2) : "";
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function download(name, type, text) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const toCsv = (rows) => `\ufeff${rows.map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
