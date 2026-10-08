/** Small in-page SVG charts (no third-party scripts; text only via textContent). */

const NS = "http://www.w3.org/2000/svg";

function s(tag, attrs = {}, text) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

function niceMax(v) {
  if (!(v > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * mag >= v) return m * mag;
  return 10 * mag;
}

const trim = (v) => v.toLocaleString("en-GB", { maximumFractionDigits: 1 });
const shortGbp = (v) => (v >= 1000000 ? `£${trim(v / 1000000)}m` : v >= 1000 ? `£${trim(v / 1000)}k` : `£${Math.round(v)}`);

/** One line per series (no stacking). rows: [{ label, values: { key: number } }] */
export function lineChart(container, rows, series, { height = 260, labelEvery = 1, title = "" } = {}) {
  const width = 760;
  const pad = { l: 56, r: 14, t: 14, b: 28 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const max = niceMax(Math.max(0, ...rows.flatMap((r) => series.map((sr) => r.values[sr.key] || 0))));
  const svg = s("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": title });
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + innerH - (innerH * i) / 4;
    svg.append(s("line", { x1: pad.l, x2: width - pad.r, y1: y, y2: y, class: "grid" }));
    svg.append(s("text", { x: pad.l - 6, y: y + 4, "text-anchor": "end" }, shortGbp((max * i) / 4)));
  }
  const step = rows.length > 1 ? innerW / (rows.length - 1) : 0;
  const x = (i) => pad.l + i * step;
  const y = (v) => pad.t + innerH - (Math.max(0, v) / max) * innerH;
  rows.forEach((r, i) => {
    if (i % labelEvery === 0) svg.append(s("text", { x: x(i), y: height - 9, "text-anchor": "middle" }, r.label));
  });
  for (const sr of series) {
    const pts = rows.map((r, i) => `${x(i)},${y(r.values[sr.key] || 0)}`);
    svg.append(s("path", { d: `M ${pad.l},${pad.t + innerH} L ${pts.join(" L ")} L ${x(rows.length - 1)},${pad.t + innerH} Z`, class: `area ${sr.cls}` }));
    svg.append(s("polyline", { points: pts.join(" "), class: `line ${sr.cls}` }));
    if (rows.length <= 12) {
      rows.forEach((r, i) => {
        const dot = s("circle", { cx: x(i), cy: y(r.values[sr.key] || 0), r: 3.5, class: `dot ${sr.cls}` });
        dot.append(s("title", {}, `${r.label} · ${sr.label}: £${Math.round(r.values[sr.key] || 0).toLocaleString("en-GB")}`));
        svg.append(dot);
      });
    }
  }
  container.replaceChildren(svg, legend(series));
}

/** Donut of parts: [{ label, value, cls }] */
export function donut(container, parts, centreText) {
  const size = 220;
  const r = 80;
  const c = size / 2;
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0);
  const svg = s("svg", { viewBox: `0 0 ${size} ${size}`, role: "img", "aria-label": "Split of money received" });
  if (total <= 0) {
    svg.append(s("circle", { cx: c, cy: c, r, fill: "none", stroke: "#dde3ea", "stroke-width": 34 }));
  } else {
    let angle = -Math.PI / 2;
    for (const p of parts) {
      const frac = Math.max(0, p.value) / total;
      if (frac <= 0) continue;
      const end = angle + frac * Math.PI * 2;
      const large = end - angle > Math.PI ? 1 : 0;
      const pt = (a, rad) => `${c + rad * Math.cos(a)} ${c + rad * Math.sin(a)}`;
      const d = frac >= 0.9999
        ? `M ${pt(0, r + 17)} A ${r + 17} ${r + 17} 0 1 1 ${pt(Math.PI, r + 17)} A ${r + 17} ${r + 17} 0 1 1 ${pt(0, r + 17)} M ${pt(0, r - 17)} A ${r - 17} ${r - 17} 0 1 0 ${pt(Math.PI, r - 17)} A ${r - 17} ${r - 17} 0 1 0 ${pt(0, r - 17)} Z`
        : `M ${pt(angle, r + 17)} A ${r + 17} ${r + 17} 0 ${large} 1 ${pt(end, r + 17)} L ${pt(end, r - 17)} A ${r - 17} ${r - 17} 0 ${large} 0 ${pt(angle, r - 17)} Z`;
      const path = s("path", { d, class: p.cls, "fill-rule": "evenodd" });
      path.append(s("title", {}, `${p.label}: ${(frac * 100).toFixed(1)}%`));
      svg.append(path);
      angle = end;
    }
  }
  svg.append(s("text", { x: c, y: c + 5, "text-anchor": "middle", class: "donut-label" }, centreText));
  container.replaceChildren(svg, legend(parts.map((p) => ({ ...p, label: total > 0 ? `${p.label} ${((Math.max(0, p.value) / total) * 100).toFixed(1)}%` : p.label }))));
}

/** Grouped horizontal bars: groups [{ label, values: { key: number } }], series [{ key, label, cls }] */
export function groupedBars(container, groups, series) {
  const width = 760;
  const rowH = 16;
  const gap = 14;
  const pad = { l: 150, r: 90, t: 6 };
  const height = pad.t + groups.length * (series.length * rowH + gap);
  const max = niceMax(Math.max(0, ...groups.flatMap((g) => series.map((sr) => g.values[sr.key] || 0))));
  const svg = s("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "Scenario comparison" });
  groups.forEach((g, gi) => {
    const top = pad.t + gi * (series.length * rowH + gap);
    svg.append(s("text", { x: pad.l - 8, y: top + (series.length * rowH) / 2 + 4, "text-anchor": "end" }, g.label));
    series.forEach((sr, si) => {
      const v = Math.max(0, g.values[sr.key] || 0);
      const w = ((width - pad.l - pad.r) * v) / max;
      const y = top + si * rowH;
      svg.append(s("rect", { x: pad.l, y: y + 2, width: Math.max(0, w), height: rowH - 4, class: sr.cls }));
      svg.append(s("text", { x: pad.l + w + 6, y: y + rowH - 4 }, `£${Math.round(v).toLocaleString("en-GB")}`));
    });
  });
  container.replaceChildren(svg, legend(series));
}

/** Sales funnel: stages [{ label, value }], widths proportional to the first stage. */
export function funnel(container, stages, fmt) {
  const width = 760;
  const rowH = 46;
  const gap = 6;
  const minW = 170;
  const maxW = 520;
  const height = stages.length * (rowH + gap);
  const top = Math.max(...stages.map((s) => s.value), 0);
  const w = (v) => (top > 0 ? minW + ((maxW - minW) * Math.max(0, v)) / top : minW);
  const svg = s("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "Sales funnel" });
  const cx = 300;
  stages.forEach((st, i) => {
    const y = i * (rowH + gap);
    const a = w(st.value) / 2;
    const b = (i + 1 < stages.length ? w(stages[i + 1].value) : w(st.value) * 0.9) / 2;
    svg.append(s("path", { d: `M ${cx - a} ${y} L ${cx + a} ${y} L ${cx + b} ${y + rowH} L ${cx - b} ${y + rowH} Z`, class: `funnel-${i % 5}` }));
    svg.append(s("text", { x: cx, y: y + rowH / 2 + 5, "text-anchor": "middle", class: "funnel-value" }, fmt(st.value)));
    svg.append(s("text", { x: cx + maxW / 2 + 24, y: y + rowH / 2 - 2, class: "funnel-label" }, st.label));
    if (st.sub) svg.append(s("text", { x: cx + maxW / 2 + 24, y: y + rowH / 2 + 14, class: "funnel-sub" }, st.sub));
  });
  container.replaceChildren(svg);
}

function legend(items) {
  const div = document.createElement("div");
  div.className = "legend";
  for (const it of items) {
    const span = document.createElement("span");
    span.className = `l-${String(it.cls || "").replace(/^c-/, "")}`;
    span.textContent = it.label;
    div.append(span);
  }
  return div;
}
