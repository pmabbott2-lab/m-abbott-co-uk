// Builds Mortgage Hub — Private Equity Investment Pitch (multi-page A4 PDF).
// A pitch-deck-style presentation of the same substance as the investment
// memorandum, without disturbing the memorandum outputs.
// Run: node marketing/build-pe-pitch.mjs

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  MEMO_CSS,
  table,
  funnelDiagram,
  susanRoadmap,
} from "./memo-shared.mjs";
import { launchBrowser, renderHtmlToPdf } from "./pdf-render.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// PE-pitch-specific styling layered on top of the memorandum CSS variables.
const PE_CSS = String.raw`
  /* Cover */
  .pe-cover { justify-content: space-between; padding: 0; color: #fff; }
  .pe-cover .cover-top { padding: 22mm 18mm 0; }
  .pe-cover .conf { font-size: 8px; letter-spacing: 3px; text-transform: uppercase; font-weight: 600; color: rgba(255,255,255,0.92); margin-bottom: 16mm; }
  .pe-cover .eyebrow { font-size: 11px; letter-spacing: 4px; text-transform: uppercase; color: var(--accent-light); font-weight: 700; margin-bottom: 6mm; }
  .pe-cover h1 { font-size: 46px; font-weight: 800; line-height: 1.03; letter-spacing: -1px; color: #fff; }
  .pe-cover .sub { font-size: 16px; font-weight: 400; color: rgba(255,255,255,0.95); margin-top: 6mm; line-height: 1.45; max-width: 150mm; }
  .pe-cover .cover-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; border-top: 1px solid rgba(255,255,255,0.22); }
  .pe-cover .cm { padding: 9mm 6mm; border-right: 1px solid rgba(255,255,255,0.12); }
  .pe-cover .cm:last-child { border-right: none; }
  .pe-cover .cm .n { font-size: 22px; font-weight: 800; color: #fff; line-height: 1; }
  .pe-cover .cm .l { font-size: 7px; letter-spacing: 1px; text-transform: uppercase; color: var(--accent-light); margin-top: 3mm; font-weight: 600; }

  /* Section divider */
  .divider-page { justify-content: center; padding: 0 22mm; color: #fff; }
  .divider-page .d-num { font-size: 64px; font-weight: 800; color: var(--accent); line-height: 1; }
  .divider-page h1 { font-size: 36px; font-weight: 800; color: #fff; margin-top: 3mm; line-height: 1.05; letter-spacing: -0.5px; }
  .divider-page p { font-size: 12px; color: rgba(255,255,255,0.85); margin-top: 4mm; max-width: 135mm; line-height: 1.5; }
  .divider-page .d-bar { width: 40mm; height: 4px; background: linear-gradient(90deg, var(--accent), var(--accent-light)); margin-top: 6mm; }

  /* PE body headlines */
  .pe-body .eyebrow { font-size: 8px; letter-spacing: 2.5px; text-transform: uppercase; color: var(--accent); font-weight: 800; margin-bottom: 2mm; }
  .pe-body h1 { font-size: 23px; font-weight: 800; color: var(--navy); line-height: 1.12; margin-bottom: 3mm; letter-spacing: -0.3px; }

  /* Stat tiles */
  .stat-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 5mm; margin: 4mm 0; }
  .stat-grid.four { grid-template-columns: repeat(2, 1fr); }
  .stat-tile { border: 1px solid var(--line); border-top: 3px solid var(--accent); border-radius: 10px; padding: 6mm 5mm; background: var(--cream); }
  .stat-tile .big { font-size: 30px; font-weight: 800; color: var(--navy); line-height: 1; letter-spacing: -1px; }
  .stat-tile .lbl { font-size: 8px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: var(--accent); margin-top: 3mm; }
  .stat-tile .sub { font-size: 8px; color: var(--muted); margin-top: 2px; line-height: 1.4; }

  /* KPI strip (dark band) */
  .kpi-strip { display: grid; grid-template-columns: repeat(4, 1fr); background: var(--navy); border-radius: 10px; overflow: hidden; margin: 3mm 0 4mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .kpi-strip.three { grid-template-columns: repeat(3, 1fr); }
  .kpi-strip .kpi { padding: 5mm 4mm; text-align: center; border-right: 1px solid rgba(255,255,255,0.12); }
  .kpi-strip .kpi:last-child { border-right: none; }
  .kpi .k-big { font-size: 19px; font-weight: 800; color: #fff; line-height: 1; }
  .kpi .k-lbl { font-size: 7px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: var(--accent-light); margin-top: 2.5mm; }

  /* Highlight list */
  .hl { list-style: none; margin: 2mm 0 0; padding: 0; }
  .hl li { position: relative; padding-left: 8mm; margin-bottom: 3mm; font-size: 9.5px; line-height: 1.5; color: var(--ink); }
  .hl li::before { content: "\25B8"; position: absolute; left: 2mm; color: var(--accent); font-weight: 800; }
  .hl li b { color: var(--navy); }

  /* The Ask */
  .ask-box { border: 2px solid var(--accent); border-radius: 12px; padding: 6mm; background: var(--accent-soft); margin: 3mm 0 4mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .ask-box .amt { font-size: 34px; font-weight: 800; color: var(--navy); line-height: 1; letter-spacing: -1px; }
  .ask-box .amt-lbl { font-size: 9px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: var(--accent); margin-top: 2mm; }

  /* Bar chart */
  .bars { margin: 3mm 0 4mm; }
  .bar-row { display: flex; align-items: center; gap: 4mm; margin-bottom: 2.5mm; }
  .bar-row .b-lbl { width: 20mm; font-size: 8px; font-weight: 700; color: var(--navy); text-align: right; }
  .bar-track { flex: 1; height: 8.5mm; }
  .bar-fill { height: 100%; background: linear-gradient(90deg, var(--navy), var(--navy-soft)); border-radius: 5px; display: flex; align-items: center; justify-content: flex-end; padding-right: 3mm; color: #fff; font-size: 8px; font-weight: 700; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .bar-fill.accent { background: linear-gradient(90deg, var(--accent), var(--accent-light)); color: var(--navy); }

  /* Feature grid (platform capabilities) */
  .feat-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4mm; margin: 3mm 0; }
  .feat-grid.three { grid-template-columns: repeat(3, 1fr); }
  .feat { border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 8px; padding: 4.5mm 5mm; background: #fff; }
  .feat h4 { font-size: 9px; font-weight: 800; color: var(--navy); margin-bottom: 1mm; }
  .feat h4 .badge-live, .feat h4 .badge-soon { margin-left: 3px; }
  .feat ul { list-style: none; margin: 1.5mm 0 0; padding: 0; }
  .feat li { position: relative; padding-left: 5mm; margin-bottom: 1.4mm; font-size: 7.8px; line-height: 1.4; color: var(--ink); }
  .feat li::before { content: "\2713"; position: absolute; left: 0; color: var(--live); font-weight: 800; }
  .feat.soon li::before { content: "\2192"; color: var(--soon); }

  /* Regulatory journey timeline */
  .reg-track { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5mm; margin: 3mm 0 4mm; }
  .reg-step { border: 1px solid var(--line); border-radius: 10px; padding: 5mm; background: var(--cream); border-top: 3px solid var(--navy-soft); }
  .reg-step.da { border-top-color: var(--accent); background: var(--accent-soft); }
  .reg-step .tag { font-size: 7px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: var(--accent); }
  .reg-step h4 { font-size: 10px; font-weight: 800; color: var(--navy); margin: 1.5mm 0; }
  .reg-step p { font-size: 7.8px; color: var(--muted); line-height: 1.45; }

  .note { font-size: 7.8px; color: var(--muted); margin-top: 2mm; line-height: 1.4; }
  .pill-note { display: inline-block; font-size: 7.5px; font-weight: 700; letter-spacing: 0.5px; background: #eef4fb; color: var(--navy-mid); padding: 2px 8px; border-radius: 999px; margin-top: 2mm; }
`;

const NAVY_BG =
  "background: linear-gradient(165deg, var(--navy) 0%, var(--navy-mid) 55%, #2a3555 100%); -webkit-print-color-adjust: exact; print-color-adjust: exact;";

function pePage(part, content, pageNum) {
  return `<div class="page">
    <div class="memo-header">
      <div class="brand">Mortgage Hub · Investment Pitch</div>
      <div class="part">${part}</div>
    </div>
    <div class="memo-body pe-body">${content}</div>
    <div class="page-footer">Private &amp; Confidential · Mortgage Hub</div>
    ${pageNum ? `<div class="page-num">${pageNum}</div>` : ""}
  </div>`;
}

function dividerPage(num, title, sub) {
  return `<div class="page divider-page" style="${NAVY_BG} color:#fff;">
    <div class="d-num">${num}</div>
    <h1>${title}</h1>
    <p>${sub}</p>
    <div class="d-bar"></div>
  </div>`;
}

function statTile(big, lbl, sub) {
  return `<div class="stat-tile"><div class="big">${big}</div><div class="lbl">${lbl}</div><div class="sub">${sub}</div></div>`;
}

function kpiStrip(items, cls = "") {
  return `<div class="kpi-strip ${cls}">${items
    .map((i) => `<div class="kpi"><div class="k-big">${i.big}</div><div class="k-lbl">${i.lbl}</div></div>`)
    .join("")}</div>`;
}

function barChart(bars) {
  return `<div class="bars">${bars
    .map(
      (b) =>
        `<div class="bar-row"><div class="b-lbl">${b.label}</div><div class="bar-track"><div class="bar-fill ${b.accent ? "accent" : ""}" style="width:${b.pct}">${b.display}</div></div></div>`,
    )
    .join("")}</div>`;
}

// Local engines diagram (generalised network wording; keeps the shared
// memorandum helper — which names HLP — untouched).
function peEnginesDiagram() {
  return `<div class="diagram"><div class="diagram-title">The Three Engines of Growth</div>
  <div class="engines">
    <div class="engine"><h4>Engine One — Distribution</h4><p>The regulated mortgage &amp; protection business.</p><ul>
      <li>Customer acquisition</li><li>Introducer relationships</li><li>Adviser productivity</li><li>Commercial growth</li></ul></div>
    <div class="engine"><h4>Engine Two — Talent</h4><p>Mortgage Academy — a proprietary, standalone talent engine, profitable from Year 3.</p><ul>
      <li>Recruitment &amp; CAS preparation</li><li>Coaching, CPD &amp; sales excellence</li><li>Leadership development</li><li>Standalone business + network pipeline</li></ul></div>
    <div class="engine"><h4>Engine Three — Technology</h4><p>Proprietary AI-enabled operating platform.</p><ul>
      <li>Susan AI</li><li>CRM &amp; customer portal</li><li>Telephony &amp; automation</li><li>Business intelligence</li></ul></div>
  </div></div>`;
}

function coverPagePE() {
  return `<div class="page pe-cover" style="${NAVY_BG} color:#fff;">
    <div class="cover-accent-bar"></div>
    <div class="cover-top">
      <div class="conf">Strictly Private &amp; Confidential</div>
      <div class="eyebrow">Private Equity Investment Opportunity</div>
      <h1>Mortgage Hub</h1>
      <p class="sub">The technology-enabled mortgage distribution platform — an equity partnership to build one of the UK's most progressive advice businesses.</p>
    </div>
    <div class="cover-metrics">
      <div class="cm"><div class="n">66,500</div><div class="l">Addressable partners</div></div>
      <div class="cm"><div class="n">~&pound;4m</div><div class="l">Y10 recurring revenue</div></div>
      <div class="cm"><div class="n">~&pound;2.3m</div><div class="l">Y10 EBITDA</div></div>
      <div class="cm"><div class="n">Susan AI</div><div class="l">Live platform</div></div>
    </div>
  </div>`;
}

function confidentialityPage() {
  return pePage(
    "Notice",
    `<div class="eyebrow">Important Notice</div>
    <h1>Confidentiality &amp; Disclaimer</h1>
    <p class="lead">This document has been prepared solely to facilitate discussions regarding a potential strategic development partnership and equity investment in Mortgage Hub.</p>
    <p>The information contained within is commercially sensitive and confidential. It should not be copied, distributed or disclosed to any third party without the prior written consent of the author.</p>
    <p>The financial projections, strategic plans and operational assumptions are management forecasts prepared using reasonable commercial assumptions and are intended to illustrate the proposed growth strategy. They are not guarantees of future performance. Year 5–10 figures are management projections extending the base forecast; renewal figures are drawn from the recurring-revenue model.</p>
    <hr class="divider" />
    <p>The names <b>Mortgage Hub</b>, <b>Mortgage Academy</b> and <b>Mortgage Hub Group</b> are temporary working titles; the intended customer-facing brands remain subject to trademark registration. The investment proposition is independent of the final branding.</p>
    <div class="callout ai"><p><b>Technology philosophy:</b> Technology within Mortgage Hub is designed to augment professional advice, not replace it. Any future expansion of AI capability will be implemented in line with applicable regulation, customer expectations and appropriate human oversight.</p></div>`,
    "",
  );
}

function highlightsPage() {
  return pePage(
    "Investment Highlights",
    `<div class="eyebrow">Investment Highlights</div>
    <h1>A scalable, technology-enabled mortgage platform — not just another brokerage</h1>
    <div class="stat-grid four">
      ${statTile("66,500", "Addressable partners", "UK professional firms across estate agency, legal, accountancy &amp; property")}
      ${statTile("~&pound;4m", "Y10 recurring revenue", "Compounding renewal-income portfolio from retained customers")}
      ${statTile("~&pound;2.3m", "Y10 total EBITDA", "New mortgage income + renewals + Mortgage Academy")}
      ${statTile("&pound;104k&rarr;&pound;600k", "Mortgage Academy revenue", "Standalone talent engine — profitable from Year 3 (Y3&rarr;Y10)")}
    </div>
    <h2>Three pillars, each a distinct value driver</h2>
    <ul class="hl">
      <li><b>Distribution.</b> A scalable self-employed mortgage &amp; protection business, with advisers earning <b>£36k&rarr;£73k</b> (incl. retained self-introduced 20%) — a compelling recruitment proposition.</li>
      <li><b>Mortgage Academy — the talent engine.</b> A proprietary, <b>standalone and profitable</b> academy (£104k Y3 → £600k Y10) that de-risks recruitment and supplies trained advisers to Mortgage Hub <b>and the wider network ecosystem</b>.</li>
      <li><b>Technology.</b> Susan, the AI digital colleague, is <b>already live</b> for booking, fact-find and customer engagement, driving a low cost-to-serve.</li>
    </ul>
    <h2>Why invest</h2>
    <ul class="hl">
      <li><b>Capital-efficient launch</b> — initially an Appointed Representative of a network selected for the best commercial terms and technology alignment, on a journey to direct authorisation.</li>
      <li><b>Compounding recurring revenue</b> — a renewal-income portfolio that builds long-term enterprise value beyond new business.</li>
      <li><b>Experienced founder</b> — 28+ years leading, transforming and scaling mortgage advice businesses.</li>
    </ul>`,
    "1",
  );
}

function totalRevenuePage() {
  return pePage(
    "Total Revenue Forecast",
    `<div class="eyebrow">The Headline Numbers</div>
    <h1>Total revenue compounds to ~&pound;10m by Year 10</h1>
    <p class="lead">Total revenue combines <b>new mortgage income</b>, <b>renewal / recurring income</b> and <b>Mortgage Academy</b> revenue. Recurring income is negligible in Years 1–2 and becomes the dominant driver by Year 10.</p>
    ${table(
      ["Year", "New mortgage income", "Renewal / recurring", "Mortgage Academy", "Total revenue"],
      [
        ["Year 1", "£60,000", "—", "—", "£60,000"],
        ["Year 2", "£480,000", "—", "—", "£480,000"],
        ["Year 3", "£1,200,000", "£14,400", "£104,000", "£1,318,400"],
        ["Year 4", "£2,100,000", "£129,600", "£200,000", "£2,429,600"],
        ["Year 5", "£2,700,000", "£417,600", "£300,000", "£3,417,600"],
        ["Year 10", "£5,700,000", "£3,945,600", "£600,000", "£10,245,600"],
      ],
      { right: ["New mortgage income", "Renewal / recurring", "Mortgage Academy", "Total revenue"] },
    )}
    ${barChart([
      { label: "Year 1", display: "£0.06m", pct: "6%" },
      { label: "Year 2", display: "£0.48m", pct: "9%" },
      { label: "Year 3", display: "£1.3m", pct: "16%" },
      { label: "Year 4", display: "£2.4m", pct: "26%" },
      { label: "Year 5", display: "£3.4m", pct: "36%" },
      { label: "Year 10", display: "£10.2m", pct: "100%", accent: true },
    ])}
    <div class="callout"><p><b>Mortgage Academy becomes a material revenue stream from Year 3</b> — a standalone, profitable talent business scaling from £104k (Y3) to £600k (Y10), on top of new mortgage and recurring income.</p></div>
    <p class="note">New mortgage income: from the management forecast (Y10 = 95 advisers &times; ~£60k net). Renewal / recurring income: from the recurring-revenue model. Mortgage Academy: Y3–Y4 forecast, Y5 &amp; Y10 management projections. Year 5–10 are management projections extending the base forecast.</p>`,
    "2",
  );
}

function opportunityPage() {
  return pePage(
    "The Opportunity",
    `<div class="eyebrow">Market &amp; Timing</div>
    <h1>A large, fragmented market ready for a technology-led operator</h1>
    <p class="lead">Mortgage distribution remains heavily intermediated and relationship-driven, yet under-served by modern technology and structured talent development.</p>
    ${kpiStrip([
      { big: "66,500", lbl: "Target UK firms" },
      { big: "~20,000", lbl: "No mortgage referral partner" },
      { big: "~46,500", lbl: "Conversion opportunities" },
      { big: "60", lbl: "Completions / adviser / yr" },
    ])}
    <h2>Why now</h2>
    <ul class="hl">
      <li><b>Technology inflection.</b> AI and automation now make it possible to remove administrative drag from advisers and materially improve customer experience.</li>
      <li><b>Talent gap.</b> The industry faces a structural shortage of qualified advisers — the Mortgage Academy turns this constraint into a proprietary supply engine.</li>
      <li><b>Partnership white space.</b> Roughly 30% of target firms have no established mortgage referral relationship — an immediate acquisition opportunity.</li>
      <li><b>Capital-light entry.</b> The Appointed Representative model lets the business launch quickly under an established compliance framework while scaling.</li>
    </ul>
    <div class="callout"><p><b>The thesis:</b> combine experienced advisers, an always-on AI operating platform and a structured talent pipeline to build a scalable advice business with a compounding recurring-revenue base.</p></div>`,
    "2",
  );
}

function companyPage() {
  return pePage(
    "The Business",
    `<div class="eyebrow">What We Are</div>
    <h1>Three engines of growth, one integrated platform</h1>
    <p class="lead">Mortgage Hub is designed from inception as an operating platform — integrating people, process and technology to scale without proportional increases in management overhead.</p>
    ${peEnginesDiagram()}
    <h2>The operating model</h2>
    <p>The business launches as an <b>Appointed Representative of a network selected for the best commercial terms and technology alignment</b>, leveraging that network's established compliance and governance infrastructure during the early growth phase. This keeps the model capital-efficient and de-risks the regulatory pathway while the adviser base and technology scale. Over the journey to Year 10 the business will transition to becoming <b>directly authorised</b> (see Regulatory Journey).</p>
    <span class="pill-note">HLP is the leading intended network partner, subject to final commercial terms.</span>`,
    "3",
  );
}

function businessModelPage() {
  return pePage(
    "Business Model",
    `<div class="eyebrow">How We Make Money</div>
    <h1>Diversified income today, compounding recurring income tomorrow</h1>
    <h2>Revenue streams</h2>
    <div class="three-col">
      <div class="engine"><h4>New mortgage income</h4><p>Procuration fees, broker fees and protection &amp; general insurance — net income received from the chosen network.</p></div>
      <div class="engine"><h4>Recurring / renewal income</h4><p>Renewals, product transfers and remortgages from retained customers — a compounding enterprise-value driver.</p></div>
      <div class="engine"><h4>Mortgage Academy</h4><p>Structured recruitment, training and development — a talent pipeline and a standalone income stream from Year 3.</p></div>
    </div>
    <h2>Per-adviser economics (illustrative, at scale)</h2>
    <p>Each fully trading adviser is expected to complete approximately <b>60 customer acquisitions annually</b>, generating average annual <b>new mortgage income</b> (net from the network) of:</p>
    ${table(
      ["Revenue source", "Annual new income"],
      [
        ["Procuration fees", "£33,000"],
        ["Broker fees", "£8,000"],
        ["Protection &amp; general insurance", "£19,000"],
        ["Total new mortgage income", "£60,000"],
      ],
      { right: ["Annual new income"] },
    )}
    <p class="note">Figures reflect new mortgage income only and exclude renewal / recurring income, which is shown separately to avoid double-counting.</p>`,
    "4",
  );
}

function technologyPage() {
  return pePage(
    "Technology",
    `<div class="eyebrow">Proprietary Platform</div>
    <h1>Susan — the AI digital colleague already working today</h1>
    <p class="lead">Susan improves customer experience and adviser productivity by undertaking structured administrative activities under human oversight. She is not used to provide regulated advice.</p>
    ${susanRoadmap()}
    <h2>Why it matters commercially</h2>
    <ul class="hl">
      <li><b>Lower cost-to-serve.</b> Automation removes administrative load, letting advisers spend more time advising.</li>
      <li><b>Scalability.</b> Technology absorbs growth that would otherwise require proportional headcount.</li>
      <li><b>Competitive moat.</b> Progressive AI capability, built in line with regulation, compounds into a durable advantage.</li>
    </ul>`,
    "5",
  );
}

function academyPage() {
  return pePage(
    "The Talent Engine",
    `<div class="eyebrow">Mortgage Academy · The Talent Engine</div>
    <h1>A proprietary talent engine — strategic capability, not just training</h1>
    <p class="lead">The Mortgage Academy turns the industry's structural adviser shortage into a proprietary supply engine — a <b>standalone, profitable business</b> that develops talent for Mortgage Hub <b>and the wider network ecosystem</b>.</p>
    ${kpiStrip([
      { big: "£104k", lbl: "Y3 · standalone" },
      { big: "£200k", lbl: "Y4 revenue" },
      { big: "£300k", lbl: "Y5 revenue" },
      { big: "£600k", lbl: "Y10 revenue" },
    ])}
    ${funnelDiagram("Adviser Development Pipeline", [
      { label: "Recruit", cls: "soft", width: "100%" },
      { label: "Onboard", cls: "soft", width: "84%" },
      { label: "CAS competency", width: "68%" },
      { label: "Coach &amp; develop", width: "54%" },
      { label: "Lead &amp; mentor", cls: "accent", width: "42%" },
    ])}
    <div class="two-col">
      <div>
        <h3>Programme scope</h3>
        <ul>
          <li>Recruitment &amp; CAS preparation</li>
          <li>CPD, coaching &amp; sales excellence</li>
          <li>Leadership &amp; management development</li>
          <li>AI adoption &amp; platform training</li>
          <li>Business growth coaching</li>
          <li>Network / platform standards training</li>
        </ul>
      </div>
      <div>
        <h3>Career pathway</h3>
        <ul>
          <li>Trainee &amp; new adviser</li>
          <li>Fully competent adviser (CAS)</li>
          <li>Senior adviser &amp; coach</li>
          <li>Sales &amp; leadership roles</li>
          <li>Wider network opportunities</li>
        </ul>
        <p class="note">Profitable as a standalone business — EBITDAR £34k (Y3) rising to £70k (Y4).</p>
      </div>
    </div>
    <div class="callout"><p><b>Strategic value:</b> a sustainable talent pipeline that improves adviser retention, materially <b>reduces recruitment risk</b>, and supports the direct-authorisation journey by ensuring advisers are trained on the firm's own systems, standards and compliance culture.</p></div>`,
    "6",
  );
}

function gtmPage() {
  return pePage(
    "Go-To-Market",
    `<div class="eyebrow">Customer Acquisition</div>
    <h1>A predictable, partnership-led acquisition engine</h1>
    <p class="lead">Rather than relying on purchased leads, Mortgage Hub builds an ecosystem of professional partners who benefit from introducing customers.</p>
    ${table(
      ["Sector", "Estimated UK businesses"],
      [
        ["Independent estate agencies", "11,000"],
        ["Residential property developers", "9,000"],
        ["Solicitors &amp; conveyancing firms", "9,500"],
        ["Accountancy &amp; tax advisory firms", "37,000"],
        ["Total addressable market", "66,500"],
      ],
      { right: ["Estimated UK businesses"] },
    )}
    ${funnelDiagram("Acquisition Framework", [
      { label: "66,500 professional businesses", cls: "soft", width: "100%" },
      { label: "20,000 new-partnership + 46,500 conversion opportunities", width: "88%" },
      { label: "Strategic partnership network", width: "72%" },
      { label: "180 introductions / adviser / year", cls: "accent", width: "58%" },
      { label: "60 completions / adviser", width: "46%" },
    ])}
    <p class="note">Acquisition is diversified across strategic partnerships, refer-a-friend, existing-customer referrals, self-generated business, digital marketing and corporate partnerships.</p>`,
    "7",
  );
}

function adviserIncomePage() {
  return pePage(
    "Unit Economics",
    `<div class="eyebrow">Adviser Projected Income</div>
    <h1>Advisers who self-generate keep the full economics of their customers</h1>
    <p class="lead">Standard split: 50% adviser, 20% introducer. Of annual acquisitions, 30 are <b>self-introduced</b> (no external introducer) — so on those the 20% is retained by the adviser, on top of their 50%.</p>
    ${table(
      [
        "Year",
        "Case size",
        "Acq.",
        "Self-intro",
        "Adviser 50%",
        "Retained 20%",
        "Renewal",
        "Total adviser income",
      ],
      [
        ["Year 1", "£1,000", "60", "30", "£30,000", "£6,000", "—", "£36,000"],
        ["Year 2", "£1,200", "70", "30", "£42,000", "£7,200", "—", "£49,200"],
        ["Year 3", "£1,500", "80", "30", "£60,000", "£9,000", "£4,000", "£73,000"],
      ],
      {
        right: ["Case size", "Acq.", "Self-intro", "Adviser 50%", "Retained 20%", "Renewal", "Total adviser income"],
      },
    )}
    <p class="note">Total = adviser 50% commission + retained 20% on self-introduced customers + renewal commission. External introducer payments (£6,000 / £9,600 / £15,000) apply only to introducer-sourced customers and are not deducted from adviser income.</p>
    <h2>The growth story</h2>
    <ul class="hl">
      <li><b>Retained self-introduced 20%</b> adds £6,000–£9,000 of income annually for an adviser building their own client base.</li>
      <li><b>Rising case values</b> (£1,000&rarr;£1,500) as protection and GI attachment deepens.</li>
      <li><b>Emerging renewal income</b> from Year 3 — a compounding personal income stream earned on relationships already won.</li>
    </ul>`,
    "8",
  );
}

function financialsPage() {
  return pePage(
    "Financials",
    `<div class="eyebrow">Management Forecast</div>
    <h1>Planned investment phase, then rapid operating leverage</h1>
    <p class="lead">Figures reflect <b>new mortgage income only</b> (net from the chosen network) and exclude renewal / recurring income, which is forecast separately.</p>
    ${table(
      ["", "Year 1", "Year 2", "Year 3", "Year 4", "Year 5"],
      [
        ["Advisers (trading)", "1", "8", "20", "35", "45"],
        ["Revenue (new mortgage income)", "£60,000", "£480,000", "£1,200,000", "£2,100,000", "£2,700,000"],
        ["Adviser commission", "(£30,000)", "(£240,000)", "(£600,000)", "(£1,050,000)", "(£1,350,000)"],
        ["Introducer commission", "—", "(£96,000)", "(£240,000)", "(£400,000)", "(£500,000)"],
        ["Gross profit", "£30,000", "£144,000", "£360,000", "£650,000", "£850,000"],
        ["Salaries &amp; costs", "(£90,000)", "(£160,000)", "(£110,000)", "(£200,000)", "(£265,000)"],
        ["Training investment", "—", "—", "(£40,000)", "(£50,000)", "(£60,000)"],
        ["EBITDAR", "(£60,000)", "(£16,000)", "£210,000", "£400,000", "£525,000"],
      ],
      {
        right: ["Year 1", "Year 2", "Year 3", "Year 4", "Year 5"],
        neg: [
          "(£30,000)", "(£240,000)", "(£600,000)", "(£1,050,000)", "(£1,350,000)",
          "(£96,000)", "(£240,000)", "(£400,000)", "(£500,000)",
          "(£90,000)", "(£160,000)", "(£110,000)", "(£200,000)", "(£265,000)",
          "(£40,000)", "(£50,000)", "(£60,000)", "(£60,000)", "(£16,000)",
        ],
      },
    )}
    <p class="note">New mortgage income scales at ~£60,000 net per fully trading adviser (Y4 = 35 advisers; +10/yr &rarr; Y5 = 45). Adviser commission ~50%; introducer commission ~20%, moderated as self-introduced business grows. The business operates at a planned loss during the initial development phase while investing in technology, recruitment, the Mortgage Academy and organisational capability.</p>`,
    "10",
  );
}

function recurringPage() {
  return pePage(
    "Recurring Revenue",
    `<div class="eyebrow">Enterprise Value</div>
    <h1>A compounding renewal-income portfolio drives long-term value</h1>
    <p class="lead">Assumptions: 60 completions / adviser / year · 60% retention · £400 average renewal income · +10 advisers annually from Year 5.</p>
    ${table(
      ["Year", "Renewal income", "Adviser (50%)", "Introducer (20%)", "Forecast EBITDAR"],
      [
        ["3", "£14,400", "£7,200", "£2,880", "£2,880"],
        ["4", "£129,600", "£64,800", "£25,920", "£25,920"],
        ["5", "£417,600", "£208,800", "£83,520", "£83,520"],
        ["6", "£921,600", "£460,800", "£184,320", "£221,184"],
        ["7", "£1,569,600", "£784,800", "£313,920", "£376,704"],
        ["8", "£2,217,600", "£1,108,800", "£443,520", "£532,224"],
        ["9", "£3,009,600", "£1,504,800", "£601,920", "£722,304"],
        ["10", "£3,945,600", "£1,972,800", "£789,120", "£946,944"],
      ],
      { right: ["Renewal income", "Adviser (50%)", "Introducer (20%)", "Forecast EBITDAR"] },
    )}
    <p>By Year 10 the recurring-income portfolio is projected to generate almost <b>£4 million</b> of annual recurring revenue, producing forecast EBITDAR approaching <b>£1 million</b> from this stream alone.</p>`,
    "11",
  );
}

function askPage() {
  return pePage(
    "The Ask",
    `<div class="eyebrow">The Ask &amp; Use of Funds</div>
    <h1>Strategic investment to accelerate the establishment phase</h1>
    <div class="ask-box">
      <div class="amt">Equity partnership</div>
      <div class="amt-lbl">Strategic partner sought — not a passive investor</div>
    </div>
    <p>Investment supports development during the establishment phase — not to prop up an unsustainable model. It funds the build-out of technology, talent and distribution ahead of the recurring-revenue inflection.</p>
    <h2>Use of funds</h2>
    <div class="three-col">
      <div class="engine"><h4>Technology</h4><p>Susan AI, customer portal, workflow automation, telephony &amp; network integration.</p></div>
      <div class="engine"><h4>Working capital</h4><p>Planned operating losses during Years 1–2 while the adviser base scales.</p></div>
      <div class="engine"><h4>Mortgage Academy</h4><p>Recruitment, structured onboarding and leadership capability.</p></div>
      <div class="engine"><h4>Recruitment</h4><p>Attraction and onboarding of experienced self-employed advisers.</p></div>
      <div class="engine"><h4>Marketing</h4><p>Brand development, digital marketing and customer acquisition.</p></div>
      <div class="engine"><h4>Infrastructure</h4><p>Systems, licences, professional services and business support.</p></div>
    </div>`,
    "12",
  );
}

function returnsPage() {
  return pePage(
    "Returns",
    `<div class="eyebrow">EBITDA Trajectory &amp; Value Creation</div>
    <h1>From planned investment to a ~£2.3m EBITDA business</h1>
    <p class="lead">Total EBITDA builds from new mortgage income, a compounding renewal portfolio and Mortgage Academy.</p>
    ${barChart([
      { label: "Year 1", display: "(£0.06m)", pct: "8%" },
      { label: "Year 4", display: "£0.4m", pct: "20%" },
      { label: "Year 5", display: "~£0.7m", pct: "32%" },
      { label: "Year 10", display: "~£2.3m", pct: "100%", accent: true },
    ])}
    <p class="note">Year 5–10 are management projections extending the base forecast; renewal figures are drawn from the recurring-revenue model. Bars indicative for illustration.</p>
    <h2>Value creation plan</h2>
    ${table(
      ["Value driver", "Mechanism", "Timeline"],
      [
        ["Adviser distribution", "Scalable self-employed model with technology leverage", "Years 1–4"],
        ["Technology platform", "Susan AI, CRM, telephony &amp; automation reducing cost-to-serve", "Ongoing"],
        ["Mortgage Academy", "Standalone talent business + network-ecosystem expansion", "Year 3+ (standalone Y3)"],
        ["Partnership network", "66,500-addressable-market acquisition engine", "Years 2–5"],
        ["Recurring revenue", "Compounding renewal-income portfolio", "Years 3–10"],
        ["AI capability", "Progressive Susan phases creating a competitive moat", "Years 1–5+"],
        ["Direct authorisation", "AR &rarr; DA transition — margin expansion + compliance/sourcing moat", "By Year 10"],
      ],
    )}`,
    "13",
  );
}

function daJourneyPage() {
  return pePage(
    "Regulatory Journey",
    `<div class="eyebrow">Governance Evolution &amp; Margin Expansion</div>
    <h1>From Appointed Representative to Directly Authorised by Year 10</h1>
    <p class="lead">The firm launches capital-efficiently under a network, then earns its way to direct authorisation — converting network charges into owned capability, margin and moat.</p>
    <div class="reg-track">
      <div class="reg-step"><div class="tag">Now · Phase 1</div><h4>Appointed Representative</h4><p>Operate as an AR of a network selected for the best commercial terms and technology alignment, leveraging established compliance and governance during early growth.</p></div>
      <div class="reg-step"><div class="tag">Transition · Phases 2–3</div><h4>Building DA readiness</h4><p>Scale advisers, systems and oversight; invest in proprietary compliance and product-sourcing capability. Transition cost is <b>absorbed by network charges no longer paid away</b> — not an additional attributed cost.</p></div>
      <div class="reg-step da"><div class="tag">By Year 10 · Target</div><h4>Directly Authorised</h4><p>Full regulatory control. Network charges are redirected into backend AI for compliance and product sourcing — capabilities that supersede what networks provide.</p></div>
    </div>
    <h2>Why this is a powerful value driver</h2>
    <ul class="hl">
      <li><b>Margin expansion, self-funded.</b> The cost of becoming DA is absorbed by network fees that are no longer paid away — so it is funded from existing economics rather than added as new cost.</li>
      <li><b>A compliance &amp; sourcing moat.</b> Direct authorisation unlocks investment in backend AI focused on compliance and product sourcing — proprietary capability that supersedes standard network provision.</li>
      <li><b>Attracts customers and advisers.</b> Better compliance, better product sourcing and superior technology make the platform more compelling to both customers and the advisers the firm recruits.</li>
      <li><b>Compounding advantage.</b> Owning the regulatory and sourcing stack strengthens every other engine — distribution, talent and recurring revenue.</li>
    </ul>`,
    "14",
  );
}

function roadmapRiskPage() {
  return pePage(
    "Roadmap &amp; Risk",
    `<div class="eyebrow">Execution</div>
    <h1>A clear, phased path — with risks actively managed</h1>
    <div class="roadmap">
      <div class="roadmap-phase"><div class="phase-tag">Phase 1 · Yrs 1–2</div><h4>Foundation</h4><ul>
        <li>Launch as network AR</li><li>Deploy Susan Phase 1</li><li>First adviser cohort</li><li>Establish Academy</li><li>Build introducer network</li></ul></div>
      <div class="roadmap-phase"><div class="phase-tag">Phase 2 · Yrs 3–4</div><h4>Operational scale</h4><ul>
        <li>Academy standalone</li><li>First Sales Manager</li><li>Susan Phase 2 &amp; telephony</li><li>Positive profitability</li><li>Deepen integration</li></ul></div>
      <div class="roadmap-phase"><div class="phase-tag">Phase 3 · Yr 5+</div><h4>Strategic growth</h4><ul>
        <li>Academy across network</li><li>Enhanced AI</li><li>Technology licensing</li><li>Selective acquisitions</li><li>National platform</li></ul></div>
    </div>
    <h2>Risk management</h2>
    ${table(
      ["Risk", "Mitigation"],
      [
        ["Adviser recruitment", "Mortgage Academy creates a structured recruitment &amp; development pipeline"],
        ["Regulatory change", "Operate within the network's governance framework; adapt as requirements evolve"],
        ["Technology delivery", "Phased implementation with testing before wider deployment"],
        ["Customer acquisition", "Diversified lead generation across partnerships, digital and adviser-led BD"],
        ["Scalability", "Technology and automation reduce reliance on rising management overhead"],
      ],
    )}`,
    "15",
  );
}

function platformPage1() {
  return pePage(
    "Live Platform · I",
    `<div class="eyebrow">Live Platform — Not a Concept</div>
    <h1>A comprehensive, operational platform today</h1>
    <p class="lead">The full customer, introducer and adviser experience is already live in production — the same depth of functionality set out in detail in the memorandum, delivered end to end.</p>
    <div class="feat-grid">
      <div class="feat"><h4>Susan — AI digital colleague <span class="badge-live">Live</span></h4><ul>
        <li>Spoken (voice) fact-find and typed chat alternative</li>
        <li>Structured welcome &amp; data capture under human oversight</li>
        <li>AI conversation summaries on the customer timeline</li>
        <li>Progress updates &amp; customer prompts</li></ul></div>
      <div class="feat"><h4>Customer portal &amp; hub <span class="badge-live">Live</span></h4><ul>
        <li>Digital onboarding &amp; self-serve appointment booking</li>
        <li>SMS + email confirmations; attend-only or full fact-find</li>
        <li>View cases, update contact details &amp; address</li>
        <li>Refer-a-friend with admin-configurable limits</li></ul></div>
      <div class="feat"><h4>Introducer portal <span class="badge-live">Live</span></h4><ul>
        <li>Shareable referral links with automatic attribution</li>
        <li>Portal booking (email + SMS) and manual lead logging</li>
        <li>Referral dashboard — stage, adviser, days at stage, last contact</li>
        <li>Commission statement with payout dates; company code for teams</li></ul></div>
      <div class="feat"><h4>Adviser workspace <span class="badge-live">Live</span></h4><ul>
        <li>Tabbed customer profile — contact, notes &amp; history, fact-find, journey, CRM</li>
        <li>Needs-attention highlights for call-backs &amp; ready-to-review</li>
        <li>Journey milestones with automatic customer SMS</li>
        <li>Personal commission statement</li></ul></div>
    </div>
    <h2>Integrated telephony <span class="badge-live">Live</span></h2>
    <div class="feat-grid">
      <div class="feat"><h4>Softphone</h4><ul>
        <li>Outbound &amp; inbound calls in-app with call recording</li>
        <li>Click-to-call from customer records</li></ul></div>
      <div class="feat"><h4>AI call intelligence</h4><ul>
        <li>Automatic call transcription &amp; conversation summaries</li>
        <li>Voicemail capture and transcription on the timeline</li></ul></div>
    </div>`,
    "16",
  );
}

function platformPage2() {
  return pePage(
    "Live Platform · II",
    `<div class="eyebrow">Owner, Finance &amp; Roadmap</div>
    <h1>Enterprise-grade finance, controls and a clear roadmap</h1>
    <div class="feat-grid">
      <div class="feat"><h4>Commission &amp; finance <span class="badge-live">Live</span></h4><ul>
        <li>Finance ledger enriched with customer, case ref, receiver &amp; reference</li>
        <li>Commission management, audit history &amp; current arrangements</li>
        <li>Previous-rate browse by date range and fee type</li>
        <li>Excel &amp; PDF exports (finance, commission, audit, customers)</li></ul></div>
      <div class="feat"><h4>Admin &amp; access control <span class="badge-live">Live</span></h4><ul>
        <li>Admin hierarchy — owner, supervisor, general admin</li>
        <li>Granular per-permission control across the platform</li>
        <li>Admin invite flow and advisor-view impersonation</li>
        <li>Manage advisers, introducers, RAF limits &amp; test accounts</li></ul></div>
    </div>
    <h2>Roadmap</h2>
    <div class="feat-grid three">
      <div class="feat soon"><h4>Document &amp; identity <span class="badge-soon">Soon</span></h4><ul>
        <li>Document upload &amp; AI scanning</li>
        <li>Integrated ID verification</li></ul></div>
      <div class="feat soon"><h4>Data &amp; payments <span class="badge-soon">Soon</span></h4><ul>
        <li>Open Banking integration</li>
        <li>Payment links &amp; smarter document workflows</li></ul></div>
      <div class="feat soon"><h4>Intelligence <span class="badge-soon">Soon</span></h4><ul>
        <li>Network / DA system integration</li>
        <li>Data warehouse &amp; BI dashboards</li></ul></div>
    </div>
    <div class="kpi-strip three">
      <div class="kpi"><div class="k-big">End-to-end</div><div class="k-lbl">Customer &rarr; completion</div></div>
      <div class="kpi"><div class="k-big">AI-native</div><div class="k-lbl">Susan + call intelligence</div></div>
      <div class="kpi"><div class="k-big">Audit-ready</div><div class="k-lbl">Finance &amp; permissions</div></div>
    </div>
    <hr class="divider" />
    <h2>Why partner now</h2>
    <p>Mortgage Hub is seeking a strategic partner to help build one of the UK's most progressive, technology-enabled mortgage distribution platforms — a long-term relationship founded on shared values, aligned incentives and a common ambition.</p>
    <p style="font-size:9px;font-weight:700;margin-top:3mm;">Peter Mabbott · Founder &amp; Managing Director</p>`,
    "17",
  );
}

function buildPePitchHtml() {
  const pages = [
    coverPagePE(),
    confidentialityPage(),
    highlightsPage(),
    totalRevenuePage(),
    dividerPage("01", "The Opportunity", "A large, fragmented market at a technology and talent inflection point."),
    opportunityPage(),
    dividerPage("02", "The Business", "Three engines of growth on one integrated, AI-enabled operating platform."),
    companyPage(),
    businessModelPage(),
    technologyPage(),
    academyPage(),
    gtmPage(),
    adviserIncomePage(),
    dividerPage("03", "The Numbers", "Planned investment phase, then operating leverage and compounding recurring revenue."),
    financialsPage(),
    recurringPage(),
    dividerPage("04", "The Ask &amp; Returns", "Strategic equity partnership to accelerate the establishment phase."),
    askPage(),
    returnsPage(),
    daJourneyPage(),
    roadmapRiskPage(),
    platformPage1(),
    platformPage2(),
  ].join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Mortgage Hub — Private Equity Investment Pitch</title>
<style>${MEMO_CSS}
${PE_CSS}
</style>
</head>
<body class="pack">${pages}</body>
</html>`;
}

const htmlPath = resolve(__dirname, "mortgage-hub-pe-pitch.html");
const html = buildPePitchHtml();
await writeFile(htmlPath, html, "utf8");
console.log(`HTML written: ${htmlPath}`);

const browser = await launchBrowser();
try {
  const pdfPath = resolve(__dirname, "mortgage-hub-pe-pitch.pdf");
  await renderHtmlToPdf(browser, htmlPath, pdfPath);
  console.log(`PDF written:  ${pdfPath}`);
} finally {
  await browser.close();
}
