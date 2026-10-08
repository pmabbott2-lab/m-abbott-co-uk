/** Line icons drawn as inline SVG (24×24, stroke = currentColor). */

const NS = "http://www.w3.org/2000/svg";

const SHAPES = {
  user: [["circle", { cx: 12, cy: 8, r: 4 }], ["path", { d: "M4 21c0-4 3.6-6 8-6s8 2 8 6" }]],
  users: [["circle", { cx: 9, cy: 8, r: 3.5 }], ["circle", { cx: 17, cy: 9, r: 2.5 }], ["path", { d: "M2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5M16 14.5c3 0 6 1.5 6 4.5" }]],
  building: [["path", { d: "M4 21V5l8-3 8 3v16M2 21h20M9 21v-5h6v5M8 8h2M14 8h2M8 12h2M14 12h2" }]],
  doc: [["path", { d: "M6 2h9l5 5v15H6zM14 2v6h6M9 13h8M9 17h6" }]],
  calendar: [["rect", { x: 3, y: 5, width: 18, height: 16, rx: 2 }], ["path", { d: "M3 10h18M8 3v4M16 3v4" }]],
  funnel: [["path", { d: "M3 4h18l-7 8v6l-4 2v-8z" }]],
  home: [["path", { d: "M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6" }]],
  shield: [["path", { d: "M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5zM9 12l2 2 4-4" }]],
  umbrella: [["path", { d: "M2 12a10 10 0 0 1 20 0zM12 12v7a2 2 0 0 0 4 0" }]],
  clock: [["circle", { cx: 12, cy: 12, r: 9 }], ["path", { d: "M12 7v5l3 2" }]],
  chart: [["path", { d: "M3 21h18M6 17v-6M11 17V7M16 17v-9M21 17V4" }]],
  trend: [["path", { d: "M3 17l6-6 4 4 8-8M15 7h6v6" }]],
  target: [["circle", { cx: 12, cy: 12, r: 9 }], ["circle", { cx: 12, cy: 12, r: 5 }], ["circle", { cx: 12, cy: 12, r: 1.5 }]],
  layers: [["path", { d: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" }]],
  list: [["path", { d: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" }]],
};

export function icon(name, cls = "icon") {
  const svg = document.createElementNS(NS, "svg");
  const attrs = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 1.8, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", class: cls };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, String(v));
  for (const [tag, shape] of SHAPES[name] || []) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(shape)) el.setAttribute(k, String(v));
    svg.append(el);
  }
  return svg;
}
