// Shared styles and layout helpers for the Project Atlas investment memorandum.

export const MEMO_CSS = String.raw`
  :root {
    --navy: #1a2238;
    --navy-mid: #232c4c;
    --navy-soft: #2b3658;
    --accent: #c47e26;
    --accent-light: #e09a3b;
    --accent-soft: #f7ead2;
    --cream: #faf9f6;
    --ink: #1f2540;
    --muted: #5c6478;
    --line: #ddd8ce;
    --white: #ffffff;
    --live: #2d6a3e;
    --soon: #8a6d1a;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    font-family: "Helvetica Neue", Helvetica, Arial, "Segoe UI", sans-serif;
    color: var(--ink); background: #ccc;
    -webkit-font-smoothing: antialiased;
  }
  @page { size: A4; margin: 0; }
  .page {
    width: 210mm; min-height: 297mm; margin: 0 auto;
    background: var(--white); position: relative; overflow: hidden;
    display: flex; flex-direction: column;
    page-break-after: always; break-after: page;
  }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .page-num {
    position: absolute; bottom: 7mm; right: 14mm;
    font-size: 8px; color: var(--muted);
  }
  .page-footer {
    position: absolute; bottom: 7mm; left: 14mm;
    font-size: 7px; color: var(--muted); letter-spacing: 0.3px;
  }

  /* Cover */
  .cover-page {
    background: linear-gradient(165deg, var(--navy) 0%, var(--navy-mid) 55%, #2a3555 100%);
    color: #fff; justify-content: space-between; padding: 0;
  }
  .cover-top { padding: 18mm 16mm 0; }
  .cover-conf {
    font-size: 8px; letter-spacing: 3px; text-transform: uppercase; font-weight: 600;
    color: rgba(255,255,255,0.92); margin-bottom: 14mm;
  }
  .cover-title {
    font-size: 11px; letter-spacing: 4px; text-transform: uppercase;
    color: var(--accent-light); font-weight: 700; margin-bottom: 6mm;
  }
  .cover-project { font-size: 42px; font-weight: 800; line-height: 1.05; letter-spacing: -0.5px; }
  .cover-sub { font-size: 16px; font-weight: 400; color: rgba(255,255,255,0.95); margin-top: 5mm; line-height: 1.45; max-width: 140mm; }
  .cover-bottom {
    padding: 10mm 16mm 16mm;
    border-top: 1px solid rgba(255,255,255,0.22);
    display: grid; grid-template-columns: 1fr 1fr; gap: 8mm;
  }
  .cover-bottom dt { font-size: 7.5px; letter-spacing: 2px; text-transform: uppercase; font-weight: 600; color: rgba(255,255,255,0.80); margin-bottom: 2px; }
  .cover-bottom dd { font-size: 11px; font-weight: 700; color: #fff; margin: 0 0 6mm; }
  .cover-accent-bar {
    height: 4px; background: linear-gradient(90deg, var(--accent), var(--accent-light));
  }

  /* Header strip */
  .memo-header {
    background: var(--navy); color: #fff;
    padding: 5mm 14mm 4.5mm;
    display: flex; align-items: center; justify-content: space-between;
    border-bottom: 3px solid var(--accent);
  }
  .memo-header .brand { font-size: 9px; letter-spacing: 2.5px; text-transform: uppercase; font-weight: 700; color: rgba(255,255,255,0.7); }
  .memo-header .part { font-size: 8px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--accent-light); }

  /* Body */
  .memo-body { padding: 7mm 14mm 12mm; flex: 1; }
  .memo-body h1 { font-size: 20px; font-weight: 800; color: var(--navy); line-height: 1.15; margin-bottom: 4mm; }
  .memo-body h2 {
    font-size: 13px; font-weight: 800; color: var(--navy);
    margin: 5mm 0 2.5mm; padding-bottom: 2px;
    border-bottom: 2px solid var(--accent);
  }
  .memo-body h3 { font-size: 10.5px; font-weight: 700; color: var(--navy-soft); margin: 3.5mm 0 2mm; }
  .memo-body p, .memo-body li { font-size: 9.2px; line-height: 1.58; color: var(--ink); }
  .memo-body ul, .memo-body ol { margin: 2mm 0 3mm 14px; }
  .memo-body li { margin-bottom: 1.5px; }
  .memo-body .lead { font-size: 10px; color: var(--muted); margin-bottom: 3mm; line-height: 1.55; }
  .memo-body .divider { border: none; border-top: 1px solid var(--line); margin: 4mm 0; }

  /* Tables */
  table.memo {
    width: 100%; border-collapse: collapse; margin: 2.5mm 0 4mm; font-size: 8.5px;
  }
  table.memo th, table.memo td {
    border: 1px solid var(--line); padding: 4px 7px; text-align: left; vertical-align: top;
  }
  table.memo th { background: var(--navy); color: #fff; font-weight: 700; }
  table.memo tr:nth-child(even) td { background: var(--cream); }
  table.memo .num { text-align: right; font-variant-numeric: tabular-nums; }
  table.memo .neg { color: #8b2020; }

  /* Callouts */
  .callout {
    background: var(--accent-soft); border-left: 3px solid var(--accent);
    padding: 7px 10px; border-radius: 0 6px 6px 0; margin: 3mm 0;
  }
  .callout p { font-size: 8.8px; margin: 0; }
  .callout b { color: var(--navy); }
  .callout.ai {
    background: #eef4fb; border-left-color: var(--navy-mid);
  }

  /* TOC */
  .toc { margin-top: 3mm; }
  .toc-part { font-size: 8px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase;
    color: var(--accent); margin: 4mm 0 2mm; }
  .toc-item {
    display: flex; justify-content: space-between; align-items: baseline;
    font-size: 9px; padding: 3px 0; border-bottom: 1px dotted var(--line);
  }
  .toc-item span { color: var(--muted); font-size: 8.5px; }

  /* Diagrams */
  .diagram {
    background: var(--cream); border: 1px solid var(--line);
    border-radius: 8px; padding: 8px 10px; margin: 3mm 0 4mm;
  }
  .diagram-title { font-size: 8.5px; font-weight: 800; color: var(--navy); letter-spacing: 1px; text-transform: uppercase; margin-bottom: 6px; }
  .funnel { display: flex; flex-direction: column; align-items: center; gap: 3px; }
  .funnel-step {
    background: var(--navy); color: #fff; text-align: center;
    padding: 5px 10px; border-radius: 4px; font-size: 8px; font-weight: 600;
    width: var(--w, 100%);
  }
  .funnel-step.accent { background: var(--accent); color: var(--navy); }
  .funnel-step.soft { background: var(--navy-soft); }
  .funnel-arrow { font-size: 10px; color: var(--muted); line-height: 1; }
  .engines { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .engine {
    background: #fff; border: 1px solid var(--line); border-radius: 8px;
    padding: 8px; border-top: 3px solid var(--accent);
  }
  .engine h4 { font-size: 9px; font-weight: 800; color: var(--navy); margin-bottom: 3px; }
  .engine p, .engine li { font-size: 7.8px; color: var(--muted); line-height: 1.45; }
  .engine ul { margin: 0; padding-left: 12px; }
  .roadmap { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .roadmap-phase {
    border: 1px solid var(--line); border-radius: 8px; padding: 7px 8px;
    background: #fff;
  }
  .roadmap-phase .phase-tag {
    font-size: 7px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase;
    color: var(--accent); margin-bottom: 3px;
  }
  .roadmap-phase h4 { font-size: 9px; font-weight: 800; color: var(--navy); margin-bottom: 3px; }
  .roadmap-phase p, .roadmap-phase li { font-size: 7.8px; color: var(--muted); line-height: 1.4; }
  .roadmap-phase ul { margin: 0; padding-left: 11px; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }
  .three-col { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; }
  .badge-live {
    display: inline-block; font-size: 7px; font-weight: 700; letter-spacing: 0.8px;
    text-transform: uppercase; background: #e6f4ea; color: var(--live);
    padding: 1px 6px; border-radius: 999px; margin-left: 4px; vertical-align: middle;
  }
  .badge-soon {
    display: inline-block; font-size: 7px; font-weight: 700; letter-spacing: 0.8px;
    text-transform: uppercase; background: var(--accent-soft); color: var(--soon);
    padding: 1px 6px; border-radius: 999px; margin-left: 4px; vertical-align: middle;
  }
  .appendix-cover {
    flex: 1; display: flex; flex-direction: column; justify-content: center;
    padding: 20mm 16mm; text-align: center; background: var(--cream);
  }
  .appendix-cover h1 { font-size: 26px; color: var(--navy); font-weight: 800; }
  .appendix-cover p { font-size: 11px; color: var(--muted); margin-top: 6px; }
`;

export function memoPage(part, content, pageNum, footer = "Project Atlas · Strictly Private & Confidential") {
  return `<div class="page">
    <div class="memo-header">
      <div class="brand">Mortgage Hub · Project Atlas</div>
      <div class="part">${part}</div>
    </div>
    <div class="memo-body">${content}</div>
    <div class="page-footer">${footer}</div>
    ${pageNum ? `<div class="page-num">${pageNum}</div>` : ""}
  </div>`;
}

export function coverPage() {
  return `<div class="page cover-page" style="background: linear-gradient(165deg, var(--navy) 0%, var(--navy-mid) 55%, #2a3555 100%); color:#fff; -webkit-print-color-adjust: exact; print-color-adjust: exact;">
    <div class="cover-accent-bar"></div>
    <div class="cover-top">
      <div class="cover-conf">Strictly Private &amp; Confidential</div>
      <div class="cover-title">Confidential Investment Memorandum</div>
      <div class="cover-project">Project Atlas</div>
      <p class="cover-sub">Strategic Development &amp; Equity Partnership Proposal</p>
    </div>
    <div class="cover-bottom">
      <div>
        <dl>
          <dt>Prepared for</dt><dd>HLP</dd>
          <dt>Version</dt><dd>0.1 — Founder Draft</dd>
        </dl>
      </div>
      <div>
        <dl>
          <dt>Founder</dt><dd>Peter Mabbott</dd>
          <dt>Date</dt><dd>July 2026</dd>
        </dl>
      </div>
    </div>
  </div>`;
}

export function table(headers, rows, opts = {}) {
  const ths = headers.map((h) => `<th${opts.right?.includes(h) ? ' class="num"' : ""}>${h}</th>`).join("");
  const trs = rows
    .map((row) => {
      const tds = row
        .map((cell, i) => {
          const cls = [];
          if (opts.right?.includes(headers[i])) cls.push("num");
          if (opts.neg?.includes(cell)) cls.push("neg");
          return `<td${cls.length ? ` class="${cls.join(" ")}"` : ""}>${cell}</td>`;
        })
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");
  return `<table class="memo"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

export function funnelDiagram(title, steps) {
  const stepsHtml = steps
    .map((s, i) => {
      const arrow = i < steps.length - 1 ? `<div class="funnel-arrow">↓</div>` : "";
      return `<div class="funnel-step ${s.cls || ""}" style="--w:${s.width || "100%"}">${s.label}</div>${arrow}`;
    })
    .join("");
  return `<div class="diagram"><div class="diagram-title">${title}</div><div class="funnel">${stepsHtml}</div></div>`;
}

export function enginesDiagram() {
  return `<div class="diagram"><div class="diagram-title">The Three Engines of Growth</div>
  <div class="engines">
    <div class="engine"><h4>Engine One — Distribution</h4><p>The regulated mortgage &amp; protection business.</p><ul>
      <li>Customer acquisition</li><li>Introducer relationships</li><li>Adviser productivity</li><li>Commercial growth</li></ul></div>
    <div class="engine"><h4>Engine Two — Talent</h4><p>Mortgage Academy — the long-term talent engine.</p><ul>
      <li>Recruitment &amp; CAS prep</li><li>Leadership development</li><li>CPD &amp; coaching</li><li>HLP ecosystem pipeline</li></ul></div>
    <div class="engine"><h4>Engine Three — Technology</h4><p>Proprietary AI-enabled operating platform.</p><ul>
      <li>Susan AI</li><li>CRM &amp; customer portal</li><li>Telephony &amp; automation</li><li>Business intelligence</li></ul></div>
  </div></div>`;
}

export function susanRoadmap() {
  return `<div class="diagram"><div class="diagram-title">Susan — Capability Roadmap</div>
  <div class="roadmap">
    <div class="roadmap-phase"><div class="phase-tag">Phase 1 · Live</div><h4>Administrative colleague</h4><ul>
      <li>Welcome &amp; fact-find</li><li>Voice &amp; typed chat</li><li>Appointment booking</li><li>SMS confirmations</li><li>Progress updates</li></ul></div>
    <div class="roadmap-phase"><div class="phase-tag">Phase 2 · In development</div><h4>Adviser support</h4><ul>
      <li>Integrated telephony</li><li>Call transcription &amp; AI summary</li><li>Document intelligence</li><li>Workflow management</li><li>Case preparation</li></ul></div>
    <div class="roadmap-phase"><div class="phase-tag">Future vision</div><h4>Strategic capability</h4><ul>
      <li>Open Banking integration</li><li>ID verification</li><li>Affordability pre-assessment</li><li>Payment links</li><li>Quality assurance</li></ul></div>
  </div></div>`;
}

export function governanceRoadmap() {
  return `<div class="diagram"><div class="diagram-title">Governance Maturity</div>
  <div class="roadmap">
    <div class="roadmap-phase"><div class="phase-tag">Phase 1</div><h4>Launch</h4><p>Founder-led · HLP supervision · Technology build · Recruitment</p></div>
    <div class="roadmap-phase"><div class="phase-tag">Phase 2 · ~10 advisers</div><h4>Enhanced capability</h4><p>Shared supervisory responsibilities · Formal management reporting</p></div>
    <div class="roadmap-phase"><div class="phase-tag">Phase 3 · 25 advisers</div><h4>Operational maturity</h4><p>Sales Manager · Structured coaching · Leadership development</p></div>
  </div></div>`;
}
