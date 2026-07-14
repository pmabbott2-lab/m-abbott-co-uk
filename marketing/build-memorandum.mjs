// Builds Project Atlas — Confidential Investment Memorandum (multi-page A4 PDF).
// Run: node marketing/build-memorandum.mjs

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  MEMO_CSS,
  coverPage,
  memoPage,
  table,
  funnelDiagram,
  enginesDiagram,
  susanRoadmap,
  governanceRoadmap,
} from "./memo-shared.mjs";
import { MANUAL_CSS, manualSections, renderManualSectionPages } from "./build-manual.mjs";
import { launchBrowser, renderHtmlToPdf } from "./pdf-render.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function confidentialityPage() {
  return memoPage(
    "Notice",
    `<h1>Confidentiality Notice</h1>
    <p class="lead">This Investment Memorandum has been prepared solely for the purpose of facilitating discussions with HLP regarding a potential strategic development partnership and equity investment.</p>
    <p>The information contained within this document is commercially sensitive and confidential. It should not be copied, distributed or disclosed to any third party without the prior written consent of the author.</p>
    <p>The financial projections, strategic plans and operational assumptions contained within this memorandum are management forecasts prepared using reasonable commercial assumptions and are intended to illustrate the proposed growth strategy. They should not be interpreted as guarantees of future performance.</p>
    <hr class="divider" />
    <p>Throughout this document the names <b>Mortgage Hub</b>, <b>Mortgage Academy</b> and <b>Mortgage Hub Group</b> are used as temporary working titles only. The intended customer-facing brands remain subject to intellectual property protection and trademark registration. The investment proposition described within this document is independent of the final branding.</p>
    <div class="callout ai"><p><b>Technology philosophy:</b> Technology within Mortgage Hub is designed to augment professional advice, not replace it. Any future expansion of AI capability will be implemented in line with applicable regulation, customer expectations and appropriate human oversight.</p></div>`,
    "ii",
  );
}

function contentsPage() {
  return memoPage(
    "Contents",
    `<h1>Contents</h1>
    <div class="toc">
      <div class="toc-part">Part 1 — Strategic Overview</div>
      <div class="toc-item"><span>Executive Summary</span><span>1</span></div>
      <div class="toc-item"><span>A Different Approach to Mortgage Advice</span><span>1</span></div>
      <div class="toc-item"><span>Artificial Intelligence &amp; Technology Strategy</span><span>2</span></div>
      <div class="toc-item"><span>Strategic Partnership with HLP</span><span>3</span></div>
      <div class="toc-item"><span>Founder</span><span>3</span></div>
      <div class="toc-part">Part 2 — Operating Model</div>
      <div class="toc-item"><span>The Three Engines of Growth</span><span>4</span></div>
      <div class="toc-item"><span>Adviser &amp; Customer Proposition</span><span>5</span></div>
      <div class="toc-item"><span>Susan — AI Digital Colleague</span><span>5</span></div>
      <div class="toc-item"><span>Mortgage Academy</span><span>6</span></div>
      <div class="toc-item"><span>Integration with HLP</span><span>6</span></div>
      <div class="toc-part">Part 3 — Commercial Strategy</div>
      <div class="toc-item"><span>Financial Strategy &amp; Forecasts</span><span>7</span></div>
      <div class="toc-item"><span>Adviser Projected Income</span><span>9</span></div>
      <div class="toc-item"><span>Strategic Partnerships &amp; Customer Acquisition</span><span>10</span></div>
      <div class="toc-item"><span>Recurring Revenue &amp; Enterprise Value</span><span>11</span></div>
      <div class="toc-item"><span>Funding Requirement &amp; Use of Funds</span><span>12</span></div>
      <div class="toc-item"><span>Value Creation Plan</span><span>12</span></div>
      <div class="toc-part">Part 4 — Strategic Roadmap</div>
      <div class="toc-item"><span>Development Phases</span><span>13</span></div>
      <div class="toc-item"><span>Risk Management</span><span>14</span></div>
      <div class="toc-item"><span>Investment Proposition &amp; Conclusion</span><span>14</span></div>
      <div class="toc-part">Platform</div>
      <div class="toc-item"><span>Live Platform Capabilities</span><span>15</span></div>
      <div class="toc-part">Appendix</div>
      <div class="toc-item"><span>Appendix A — Mortgage Hub User Guide</span><span>A-1</span></div>
    </div>`,
    "iii",
  );
}

function part1Pages() {
  return [
    memoPage(
      "Part 1 · Overview",
      `<h1>Executive Summary</h1>
      <p class="lead">Building the Next Generation Mortgage Distribution Platform</p>
      <p>Mortgage Hub has been established to create a modern, technology-enabled mortgage distribution platform designed around adviser productivity, customer experience and sustainable long-term growth.</p>
      <p>The proposition combines three complementary capabilities:</p>
      <ul>
        <li>A scalable self-employed mortgage and protection business.</li>
        <li><b>Mortgage Academy</b>, providing structured adviser recruitment, development and leadership capability.</li>
        <li>A proprietary technology platform integrating artificial intelligence, workflow automation and digital customer engagement.</li>
      </ul>
      <p>Unlike many traditional mortgage businesses, Mortgage Hub has been designed from inception as an <b>operating platform</b> rather than simply another brokerage. Technology, people and process have been integrated to improve adviser productivity, reduce administration and create a business capable of significant scale without proportional increases in management overhead.</p>
      <p>The initial operating model has been intentionally structured to operate as an <b>Appointed Representative within the HLP network</b>, leveraging HLP's established compliance framework and governance infrastructure during the early stages of growth.</p>
      <p>Combining new mortgage income, a compounding renewal-income portfolio and Mortgage Academy, management projects total EBITDA of approximately <b>£700,000 by Year 5</b>, rising to approximately <b>£2.3 million by Year 10</b> as the recurring-revenue portfolio matures and operating leverage increases. <span style="font-size:8px;color:var(--muted);">(Year 5–10 figures are management projections extending the base forecast; renewal figures are drawn directly from the recurring-revenue model.)</span></p>
      <hr class="divider" />
      <h2>A Different Approach to Mortgage Advice</h2>
      <p>The mortgage advice market is evolving rapidly. Customers increasingly expect digital engagement, faster communication and greater transparency while continuing to value trusted professional advice for one of the most important financial decisions they will make.</p>
      <p>At the same time, advisers face growing administrative demands, fragmented technology and increasing regulatory expectations that reduce the time available to advise customers.</p>
      <p>Mortgage Hub has been designed to address these challenges by combining experienced advisers with intelligent technology, structured development and operational excellence. <b>The objective is not to replace advisers with technology — it is to enable advisers to spend more time advising customers</b> by removing unnecessary administrative activity.</p>
      <div class="callout"><p><b>Strategic intent:</b> Mortgage Hub is not seeking to change HLP — it is seeking to become an innovation partner that strengthens HLP's future capability.</p></div>`,
      "1",
    ),
    memoPage(
      "Part 1 · Technology",
      `<h1>Artificial Intelligence &amp; Technology Strategy</h1>
      <p class="lead">A key differentiator within the Mortgage Hub proposition is <b>Susan</b>, an AI-powered digital colleague designed to support customers and advisers throughout the mortgage journey.</p>
      <p>Susan initially operates as an intelligent administrative assistant, undertaking activities that traditionally consume significant adviser time:</p>
      <ul>
        <li>Welcoming new customers and conducting the initial fact-find (voice or typed chat).</li>
        <li>Gathering customer information and scheduling appointments.</li>
        <li>Responding to routine customer enquiries and providing application progress updates.</li>
        <li>Integrated telephony with call recording, transcription and AI summaries <span class="badge-live">Live</span></li>
      </ul>
      ${susanRoadmap()}
      <h2>Technology Architecture</h2>
      <p>The platform has been built as a single operating architecture integrating the following capabilities:</p>
      ${table(
        ["Capability", "Status", "Description"],
        [
          ["Customer Relationship Management", '<span class="badge-live">Live</span>', "Tabbed customer profiles, contact sync, journey milestones, audit timeline"],
          ["Customer Portal", '<span class="badge-live">Live</span>', "Digital onboarding, fact-find, booking, hub and refer-a-friend"],
          ["Susan AI", '<span class="badge-live">Live</span>', "Voice &amp; typed fact-find, AI summaries, administrative engagement"],
          ["Introducer Portal", '<span class="badge-live">Live</span>', "Referral links, portal booking, commission tracking, journey visibility"],
          ["Workflow Automation", '<span class="badge-live">Live</span>', "SMS/email confirmations, milestone notifications, needs-attention alerts"],
          ["Telephony Integration", '<span class="badge-live">Live</span>', "Browser softphone, recording, transcription, voicemail"],
          ["Commission &amp; Finance", '<span class="badge-live">Live</span>', "Fee ledger, commission mgmt, audit history, Excel/PDF exports"],
          ["Admin &amp; Permissions", '<span class="badge-live">Live</span>', "Owner/supervisor/general hierarchy, granular permissions, admin invites"],
          ["Open Banking", '<span class="badge-soon">Roadmap</span>', "Automated income and affordability data collection"],
          ["Identity Verification", '<span class="badge-soon">Roadmap</span>', "Built-in digital ID checks linked to journey milestones"],
          ["Document Intelligence", '<span class="badge-soon">Roadmap</span>', "AI scanning of payslips, bank statements and uploads"],
          ["Payment Links", '<span class="badge-soon">Roadmap</span>', "Secure online fee collection tracked against cases"],
          ["HLP System Integration", '<span class="badge-soon">Planned</span>', "Aligned case coding, reporting structures and case transfer"],
          ["Data Warehouse &amp; BI", '<span class="badge-soon">Roadmap</span>', "Management information, performance dashboards, KPI scorecard"],
        ],
      )}`,
      "2",
    ),
    memoPage(
      "Part 1 · Partnership",
      `<h1>Strategic Partnership with HLP</h1>
      <p class="lead">This proposal is not simply seeking a network appointment. It is an invitation for HLP to become a <b>strategic development partner and equity investor</b> in a business designed to create long-term enterprise value.</p>
      <p>Mortgage Hub has been intentionally designed to complement HLP's existing strengths rather than replicate them. The technology platform will integrate with HLP's operational environment through aligned case coding, compatible reporting structures and consistent financial data architecture.</p>
      <h2>Phased Governance Model</h2>
      ${governanceRoadmap()}
      <h2>Responsibility Separation</h2>
      <div class="two-col">
        <div>
          <h3>Mortgage Hub</h3>
          <ul>
            <li>Recruitment &amp; customer acquisition</li>
            <li>Technology &amp; marketing</li>
            <li>Adviser productivity &amp; Academy</li>
            <li>Commercial performance &amp; customer experience</li>
          </ul>
        </div>
        <div>
          <h3>HLP</h3>
          <ul>
            <li>Regulatory oversight &amp; compliance supervision</li>
            <li>Governance &amp; approved advice framework</li>
            <li>Network standards &amp; regulatory assurance</li>
          </ul>
        </div>
      </div>
      <hr class="divider" />
      <h1>Founder</h1>
      <h2>Peter Mabbott — Founder &amp; Managing Director</h2>
      <p>Peter Mabbott brings more than <b>28 years' financial services experience</b> spanning retail banking, mortgage distribution, intermediary services and executive leadership.</p>
      <p>Having held senior leadership positions within one of the UK's largest banking groups and one of the UK's largest mortgage distribution businesses, Peter has built extensive expertise in commercial leadership, business transformation, adviser development, technology innovation and operational excellence.</p>
      <p>Mortgage Hub represents the culmination of this experience, bringing together technology, adviser development and scalable operating practices to create a next-generation mortgage distribution platform.</p>`,
      "3",
    ),
  ].join("");
}

function part2Pages() {
  return [
    memoPage(
      "Part 2 · Operating Model",
      `<h1>The Mortgage Hub Operating Model</h1>
      <p class="lead">A business designed for scale — maximising the time advisers spend advising customers while technology undertakes administrative activity wherever possible.</p>
      ${enginesDiagram()}
      <h2>Business Structure</h2>
      <p>The initial structure is intentionally lean:</p>
      ${funnelDiagram("Organisational Structure", [
        { label: "Managing Director", cls: "accent", width: "55%" },
        { label: "Mortgage Academy", width: "65%" },
        { label: "Self-employed Advisers", width: "80%" },
        { label: "Technology Platform", width: "90%" },
        { label: "HLP Regulatory Framework", width: "100%" },
      ])}
      <p>Operational support functions will only be introduced as adviser numbers justify additional investment, maximising operational leverage during the early stages of growth.</p>`,
      "4",
    ),
    memoPage(
      "Part 2 · Propositions",
      `<h1>Adviser &amp; Customer Proposition</h1>
      <div class="two-col">
        <div>
          <h2>The Adviser Proposition</h2>
          <p>Designed for ambitious self-employed advisers who want to build successful long-term businesses:</p>
          <ul>
            <li>Competitive commercial arrangements</li>
            <li>Modern technology &amp; AI-enabled administration</li>
            <li>Structured coaching &amp; Mortgage Academy</li>
            <li>Digital customer engagement</li>
            <li>Clear career progression &amp; leadership opportunities</li>
          </ul>
        </div>
        <div>
          <h2>The Customer Proposition</h2>
          <p>Digital convenience without sacrificing professional advice:</p>
          <ul>
            <li>Digital onboarding &amp; AI-supported engagement</li>
            <li>Voice or typed fact-find with Susan</li>
            <li>Fast document collection &amp; transparent communication</li>
            <li>Human advisers throughout the advice journey</li>
            <li>Secure customer portal &amp; progress updates</li>
          </ul>
        </div>
      </div>
      <h2>Adviser Development Journey</h2>
      ${funnelDiagram("Adviser Journey", [
        { label: "Stage 1 — Recruitment · Business planning · Onboarding · Compliance", cls: "soft", width: "100%" },
        { label: "Stage 2 — Supported launch · Customer acquisition · Coaching", cls: "soft", width: "85%" },
        { label: "Stage 3 — High performer · Mentoring · Leadership · Academy", cls: "accent", width: "70%" },
      ])}
      <hr class="divider" />
      <h1>Susan — AI Digital Colleague</h1>
      <p>Susan has not been developed to provide regulated mortgage advice. She improves customer experience and adviser productivity by undertaking structured administrative activities under appropriate human oversight.</p>
      ${susanRoadmap()}`,
      "5",
    ),
    memoPage(
      "Part 2 · Academy & Integration",
      `<h1>Mortgage Academy</h1>
      <p class="lead">The long-term talent engine supporting both Mortgage Hub and, over time, the wider HLP ecosystem.</p>
      <p>Unlike traditional training functions, Mortgage Academy combines technical knowledge with practical business development, technology adoption and commercial capability:</p>
      <ul>
        <li>Adviser recruitment &amp; structured onboarding</li>
        <li>Competent Adviser Status preparation</li>
        <li>Sales excellence &amp; customer relationship management</li>
        <li>Leadership development &amp; AI adoption</li>
        <li>Business growth coaching &amp; HLP platform training</li>
      </ul>
      <p>As careers develop, advisers may continue growing within Mortgage Hub, become senior advisers, move into coaching, join leadership roles, or progress into wider opportunities within HLP.</p>
      <hr class="divider" />
      <h1>Integration with HLP</h1>
      <p>Mortgage Hub has been designed from inception to complement HLP rather than operate independently. The technology platform will align with HLP's operational environment through:</p>
      <ul>
        <li>Standardised case coding &amp; automated case transfer</li>
        <li>Common financial reporting structures &amp; reconciliation</li>
        <li>Shared compliance data &amp; management reporting</li>
        <li>Performance dashboards &amp; operational insight</li>
      </ul>
      <h2>Value Created for HLP</h2>
      ${table(
        ["Dimension", "Strategic Value"],
        [
          ["Distribution", "A scalable, technology-enabled advice business capable of sustainable growth"],
          ["Talent", "Structured adviser recruitment and development supporting the HLP ecosystem"],
          ["Technology", "A modern AI-enabled operating platform creating wider innovation opportunities"],
          ["Enterprise Value", "Participation in long-term shareholder value through strategic equity investment"],
        ],
      )}`,
      "6",
    ),
  ].join("");
}

function part3Pages() {
  return [
    memoPage(
      "Part 3 · Financials",
      `<h1>Commercial Strategy &amp; Financial Proposition</h1>
      <p class="lead">A scalable, technology-enabled operating platform capable of delivering long-term shareholder value while maintaining excellent customer outcomes.</p>
      <p>All revenue shown represents <b>new net income received from the network (HLP)</b>, after the network has deducted applicable charges and fees. These forecasts reflect <b>new mortgage income only</b> and exclude renewal / recurring income, which is shown separately in the Recurring Revenue section to avoid double-counting. The business is expected to operate at a planned loss during the initial development phase while investment is made in technology, recruitment, Mortgage Academy and organisational capability.</p>
      <h2>New Mortgage Income — Revenue Assumptions</h2>
      <p>Each fully trading adviser is expected to complete approximately <b>60 customer acquisitions annually</b>, producing average annual <b>new mortgage income</b> (net from the network, HLP) of:</p>
      ${table(
        ["Revenue Source", "Annual New Income"],
        [
          ["Procuration Fees", "£33,000"],
          ["Broker Fees", "£8,000"],
          ["Protection & General Insurance", "£19,000"],
          ["Total New Mortgage Income", "£60,000"],
        ],
        { right: ["Annual New Income"] },
      )}
      <h2>Adviser Commercial Model</h2>
      ${table(
        ["Commercial Arrangement", "Typical Range"],
        [
          ["Adviser Commission", "40–60%"],
          ["Introducer Commission", "10–25%"],
          ["Maximum Combined Pay-away", "85%"],
          ["Technology & Business Services", "£150 per month"],
        ],
      )}
      <h2>Growth Assumptions</h2>
      ${table(
        ["Year", "Founder", "Trading Advisers", "Onboarding", "Academy"],
        [
          ["Year 1", "Trading", "1", "5", "Internal"],
          ["Year 2", "Trading", "8", "5", "Internal"],
          ["Year 3", "Strategic Leadership", "20", "10", "Standalone"],
          ["Year 4", "Strategic Leadership", "35", "10", "Standalone"],
        ],
      )}`,
      "7",
    ),
    memoPage(
      "Part 3 · Forecast",
      `<h1>Management Forecast</h1>
      <h2>Mortgage Hub</h2>
      <p class="lead">Figures below reflect <b>new mortgage income only</b> (net from the network, HLP) and exclude renewal / recurring income, which is forecast separately in the Recurring Revenue section.</p>
      ${table(
        ["", "Year 1", "Year 2", "Year 3", "Year 4"],
        [
          ["Revenue (new mortgage income, net from network HLP)", "£60,000", "£480,000", "£1,200,000", "£2,100,000"],
          ["Adviser Commission", "(£30,000)", "(£240,000)", "(£600,000)", "(£1,050,000)"],
          ["Introducer Commission", "—", "(£96,000)", "(£240,000)", "(£400,000)"],
          ["Gross Profit", "£30,000", "£144,000", "£360,000", "£650,000"],
          ["Salaries", "(£140,000)", "(£160,000)", "(£110,000)", "(£200,000)"],
          ["Training Investment", "—", "—", "(£40,000)", "(£50,000)"],
          ["EBITDAR", "(£110,000)", "(£16,000)", "£210,000", "£400,000"],
        ],
        { right: ["Year 1", "Year 2", "Year 3", "Year 4"], neg: ["(£30,000)", "(£240,000)", "(£600,000)", "(£1,050,000)", "(£96,000)", "(£240,000)", "(£400,000)", "(£140,000)", "(£160,000)", "(£110,000)", "(£200,000)", "(£40,000)", "(£50,000)", "(£110,000)", "(£16,000)"] },
      )}
      <h2>Mortgage Academy</h2>
      ${table(
        ["", "Year 3", "Year 4"],
        [
          ["Revenue", "£104,000", "£200,000"],
          ["Salaries", "(£50,000)", "(£90,000)"],
          ["Operating Costs", "(£20,000)", "(£40,000)"],
          ["EBITDAR", "£34,000", "£70,000"],
        ],
        { right: ["Year 3", "Year 4"], neg: ["(£50,000)", "(£90,000)", "(£20,000)", "(£40,000)"] },
      )}
      <h2>Organisational Growth</h2>
      ${table(
        ["Stage", "Structure"],
        [
          ["Launch", "Founder, Trainer, Technology Platform"],
          ["8 advisers", "Lean central team"],
          ["20 advisers", "Mortgage Academy operating independently"],
          ["25 advisers", "First Sales Manager"],
          ["35 advisers", "Sales Manager and Administrator"],
          ["£2m+ turnover", "Business Development Manager"],
          ["Every +25 advisers", "Additional Sales Manager"],
        ],
      )}`,
      "8",
    ),
    memoPage(
      "Part 3 · Adviser Income",
      `<h1>Adviser Projected Income</h1>
      <p class="lead">An illustrative earnings journey for a single adviser — showing how rising case sizes, growing customer acquisition and the emergence of renewal income build a compounding personal income stream.</p>
      <p>The illustration assumes the standard commercial split of <b>50% to the adviser</b> and a <b>20% introducer share</b>. Of the annual acquisitions, <b>30 are self-introduced</b> (the adviser's own customers, with no external introducer) — so on those cases the 20% is <b>not paid away and is retained by the adviser</b>, on top of their 50%. The external introducer payment therefore applies only to genuinely introducer-sourced customers. Renewal commission is the adviser's 50% share of £400 renewal income on retained customers.</p>
      ${table(
        [
          "Year",
          "Case size",
          "Acq.",
          "Self-intro",
          "Adviser 50%",
          "Retained 20% (self-intro)",
          "Renewal comm.",
          "Total adviser income",
          "External introducer paid",
        ],
        [
          ["Year 1", "£1,000", "60", "30", "£30,000", "£6,000", "—", "£36,000", "£6,000"],
          ["Year 2", "£1,200", "70", "30", "£42,000", "£7,200", "—", "£49,200", "£9,600"],
          ["Year 3", "£1,500", "80", "30", "£60,000", "£9,000", "£4,000", "£73,000", "£15,000"],
        ],
        {
          right: [
            "Case size",
            "Acq.",
            "Self-intro",
            "Adviser 50%",
            "Retained 20% (self-intro)",
            "Renewal comm.",
            "Total adviser income",
            "External introducer paid",
          ],
        },
      )}
      <p style="font-size:8px;color:var(--muted);">Total adviser income = Adviser 50% commission + retained 20% on self-introduced customers + renewal commission. The final column is paid to external introducers on introducer-sourced customers only and is not deducted from adviser income.</p>
      <h2>A growth story, not a snapshot</h2>
      <p>The value of the Mortgage Hub model to an adviser is not a single year's earnings — it is the trajectory:</p>
      <ul>
        <li><b>Self-introduced economics.</b> When an adviser brings their own customer, there is no external introducer to pay — so the adviser keeps their 50% <i>and</i> the 20% introducer share. For an adviser self-introducing 30 customers a year this adds <b>£6,000–£9,000</b> of retained income annually.</li>
        <li><b>Rising case values.</b> Average case size grows from £1,000 to £1,500 as advisers deepen protection and general insurance attachment alongside each mortgage.</li>
        <li><b>Growing acquisition.</b> Supported by the partnership network, refer-a-friend and Susan-enabled administration, annual acquisitions rise from 60 to 80 while the adviser's own self-introduced business stays a dependable core.</li>
        <li><b>Emerging renewal income.</b> From Year 3 the adviser begins to earn renewal commission (£4,000) on retained customers — income earned on relationships already won, at a fraction of the effort of new business.</li>
      </ul>
      <p>Total adviser income grows from <b>£36,000 in Year 1 to £73,000 by Year 3</b> — materially boosted by the self-introduced 20% the adviser retains — and because renewal income compounds year on year as the customer portfolio matures, the adviser's earnings continue to build well beyond the period shown.</p>
      <div class="callout"><p><b>Why this matters:</b> advisers who self-generate keep the full economics of their own customers — their 50% plus the 20% that would otherwise go to an introducer — creating a powerful incentive to build a personal client base. For the firm and its investors, the same dynamic drives rising revenue per adviser and a compounding renewal-income portfolio at the firm level.</p></div>
      <p style="font-size:8px;color:var(--muted);">Illustrative figures for a single representative adviser; actual earnings vary with productivity, case mix and lead source. Consistent with firm-level assumptions elsewhere in this document.</p>`,
      "9",
    ),
    memoPage(
      "Part 3 · Partnerships",
      `<h1>Strategic Partnerships &amp; Scalable Customer Acquisition</h1>
      <p class="lead">Building a predictable, scalable and diversified customer acquisition engine through long-term strategic partnerships with organisations that regularly advise customers during key property and financial decisions.</p>
      <p>Rather than relying on purchased leads, Mortgage Hub will establish an ecosystem of professional partners who benefit from introducing customers into the platform.</p>
      <h2>Target Partnership Sectors</h2>
      <ul>
        <li>Independent estate agencies · Residential property developers</li>
        <li>Solicitors &amp; conveyancing firms · Accountancy &amp; tax advisory practices</li>
        <li>Independent financial advisers · Wealth management firms</li>
        <li>Employee benefit providers · Property investment specialists</li>
      </ul>
      <h2>Addressable Market</h2>
      ${table(
        ["Sector", "Estimated UK Businesses"],
        [
          ["Independent estate agencies", "11,000"],
          ["Residential property developers", "9,000"],
          ["Solicitors & conveyancing firms", "9,500"],
          ["Accountancy & tax advisory firms", "37,000"],
          ["Total Addressable Market", "66,500"],
        ],
        { right: ["Estimated UK Businesses"] },
      )}
      <p>Approximately <b>30% (~20,000)</b> currently operate without an established mortgage referral relationship — immediate partnership opportunities. The remaining <b>70% (~46,500)</b> represent competitive conversion opportunities where Mortgage Hub differentiates through technology, transparency, renewal income participation and dedicated relationship management.</p>
      ${funnelDiagram("Acquisition Framework", [
        { label: "66,500 Professional businesses", cls: "soft", width: "100%" },
        { label: "20,000 New partnership opportunities + 46,500 Competitive conversions", width: "90%" },
        { label: "Strategic Partnership Network", width: "80%" },
        { label: "180 Introductions per adviser per year", cls: "accent", width: "70%" },
        { label: "60 Mortgage completions per adviser", width: "60%" },
        { label: "Scalable National Growth", cls: "accent", width: "50%" },
      ])}
      <p>Customer acquisition will be diversified across strategic partnerships, refer-a-friend, existing customer referrals, self-generated business, digital marketing, corporate partnerships and local networking.</p>`,
      "10",
    ),
    memoPage(
      "Part 3 · Recurring Revenue",
      `<h1>Recurring Revenue &amp; Enterprise Value</h1>
      <p class="lead">Building long-term shareholder value through predictable recurring revenue from retained customer relationships.</p>
      <p>Whilst new mortgage completions generate immediate income, long-term enterprise value is created by retaining customers through future mortgage events, product transfers and remortgages.</p>
      <h2>Management Assumptions</h2>
      <ul>
        <li>Average mortgage completions per adviser: <b>60 per annum</b></li>
        <li>Customer retention: <b>60%</b></li>
        <li>Average renewal income: <b>£400</b> per retained customer</li>
        <li>Adviser growth increasing by ten advisers annually from Year 5</li>
      </ul>
      <h2>Illustrative Recurring Revenue Forecast</h2>
      ${table(
        ["Year", "Renewal Income", "Adviser (50%)", "Introducer (20%)", "Admin", "Forecast EBITDAR"],
        [
          ["3", "£14,400", "£7,200", "£2,880", "£1,440 (10%)", "£2,880"],
          ["4", "£129,600", "£64,800", "£25,920", "£12,960 (10%)", "£25,920"],
          ["5", "£417,600", "£208,800", "£83,520", "£41,760 (10%)", "£83,520"],
          ["6", "£921,600", "£460,800", "£184,320", "£55,296 (6%)", "£221,184"],
          ["7", "£1,569,600", "£784,800", "£313,920", "£94,176 (6%)", "£376,704"],
          ["8", "£2,217,600", "£1,108,800", "£443,520", "£133,056 (6%)", "£532,224"],
          ["9", "£3,009,600", "£1,504,800", "£601,920", "£180,576 (6%)", "£722,304"],
          ["10", "£3,945,600", "£1,972,800", "£789,120", "£236,736 (6%)", "£946,944"],
        ],
        { right: ["Renewal Income", "Adviser (50%)", "Introducer (20%)", "Admin", "Forecast EBITDAR"] },
      )}
      <p>By Year 10 the recurring income portfolio is projected to generate almost <b>£4 million</b> of annual recurring revenue, producing forecast EBITDAR approaching <b>£1 million</b> from this income stream alone — a significant driver of long-term shareholder value.</p>`,
      "11",
    ),
    memoPage(
      "Part 3 · Investment",
      `<h1>Funding Requirement &amp; Use of Funds</h1>
      <p class="lead">Strategic investment to accelerate development during the establishment phase — not to support an unsustainable business model.</p>
      <h2>Investment will support</h2>
      <div class="three-col">
        <div class="engine"><h4>Technology</h4><p>Susan AI, customer portal, workflow automation, telephony and HLP integration.</p></div>
        <div class="engine"><h4>Working Capital</h4><p>Planned operating losses during Years 1–2 while the adviser population scales.</p></div>
        <div class="engine"><h4>Mortgage Academy</h4><p>Recruitment, structured onboarding and leadership capability.</p></div>
        <div class="engine"><h4>Recruitment</h4><p>Attraction and onboarding of experienced self-employed advisers.</p></div>
        <div class="engine"><h4>Marketing</h4><p>Brand development, digital marketing and customer acquisition.</p></div>
        <div class="engine"><h4>Infrastructure</h4><p>Systems, licences, professional services and business support.</p></div>
      </div>
      <hr class="divider" />
      <h1>Value Creation Plan</h1>
      <p>HLP's equity stake becomes more valuable over time through multiple compounding value drivers:</p>
      ${table(
        ["Value Driver", "Mechanism", "Timeline"],
        [
          ["Adviser distribution", "Scalable self-employed model with technology leverage", "Years 1–4"],
          ["Technology platform", "Susan AI, CRM, telephony and automation reducing cost-to-serve", "Ongoing"],
          ["Mortgage Academy", "Talent pipeline for Mortgage Hub and HLP ecosystem", "Year 3+"],
          ["Partnership network", "66,500-addressable-market acquisition engine", "Years 2–5"],
          ["Recurring revenue", "Compounding renewal income portfolio", "Year 3–10"],
          ["AI capability", "Progressive Susan phases creating competitive moat", "Years 1–5+"],
          ["Adjacent services", "Optional expansion: licensing, acquisitions, network services", "Year 5+"],
        ],
      )}
      <h2>Key Performance Indicators</h2>
      <p>Management success measured through a balanced scorecard: commercial (revenue per adviser, protection penetration), operational (journey times, AI utilisation), people (recruitment, retention, Academy completion) and customer (satisfaction, referral rates, digital engagement).</p>`,
      "12",
    ),
  ].join("");
}

function part4Pages() {
  return [
    memoPage(
      "Part 4 · Roadmap",
      `<h1>Strategic Roadmap</h1>
      <p class="lead">Delivering the vision through clearly defined phases of development.</p>
      <div class="roadmap">
        <div class="roadmap-phase"><div class="phase-tag">Phase 1 · Years 1–2</div><h4>Foundation</h4><ul>
          <li>Launch as HLP Appointed Representative</li>
          <li>Deploy Susan Phase 1</li>
          <li>Recruit first adviser cohort</li>
          <li>Establish Mortgage Academy</li>
          <li>Build introducer relationships</li>
          <li>Validate commercial proposition</li></ul>
          <p><b>Target:</b> 8 advisers trading, 5 onboarding</p></div>
        <div class="roadmap-phase"><div class="phase-tag">Phase 2 · Years 3–4</div><h4>Operational Scale</h4><ul>
          <li>Academy as standalone business</li>
          <li>First Sales Manager appointed</li>
          <li>Susan Phase 2 &amp; telephony</li>
          <li>Positive operating profitability</li>
          <li>Strengthen HLP integration</li></ul>
          <p><b>Target:</b> 35 advisers trading</p></div>
        <div class="roadmap-phase"><div class="phase-tag">Phase 3 · Year 5+</div><h4>Strategic Growth</h4><ul>
          <li>Academy services across HLP</li>
          <li>Enhanced AI &amp; document intelligence</li>
          <li>Additional adviser services</li>
          <li>Technology licensing</li>
          <li>Selective acquisitions</li></ul>
          <p><b>Target:</b> National growth platform</p></div>
      </div>
      <h2>Planned Milestones</h2>
      ${table(
        ["Year", "Key Milestones"],
        [
          ["Year 1", "Launch · Susan Phase 1 · First adviser cohort · Academy established · Platform validated"],
          ["Year 2", "8 advisers trading · Expand introducer network · Refine customer journey · AI investment"],
          ["Year 3", "20 advisers · Academy standalone · Susan Phase 2 · Profitability · HLP integration"],
          ["Year 4", "35 advisers · Sales Manager · Administrator · BDM (subject to turnover) · Academy for HLP"],
        ],
      )}`,
      "13",
    ),
    memoPage(
      "Part 4 · Risk & Conclusion",
      `<h1>Risk Management</h1>
      ${table(
        ["Risk", "Mitigation"],
        [
          ["Adviser recruitment", "Mortgage Academy creates structured recruitment and development pipeline"],
          ["Regulatory change", "Operate within HLP governance framework; adapt processes as requirements evolve"],
          ["Technology delivery", "Phased implementation with testing before wider deployment"],
          ["AI adoption", "Susan initially supports administrative activities only; future capability introduced where compliant"],
          ["Customer acquisition", "Diversified lead generation through partnerships, digital marketing and adviser-led BD"],
          ["Operational scalability", "Technology and automation reduce reliance on increasing management overheads"],
        ],
      )}
      <hr class="divider" />
      <h1>Why HLP? Why Invest Now?</h1>
      <p>Mortgage Hub is at the beginning of its development journey. Investment at this stage provides the opportunity to influence strategy, shape the operating model and participate in future value creation from inception.</p>
      <div class="two-col">
        <div><h3>Benefits to HLP</h3><ul>
          <li>Participate in equity value creation</li>
          <li>Access modern technology platform</li>
          <li>Develop future advisers via Academy</li>
          <li>Improve productivity across network</li>
          <li>Strengthen long-term recruitment</li></ul></div>
        <div><h3>The Proposition</h3><ul>
          <li>Experienced founder (28+ years)</li>
          <li>Clearly defined commercial model</li>
          <li>Scalable technology strategy</li>
          <li>Structured adviser development</li>
          <li>AI roadmap centred on Susan</li>
          <li>Disciplined operating model</li></ul></div>
      </div>
      <hr class="divider" />
      <h1>Conclusion</h1>
      <p>Mortgage Hub has not been conceived as a traditional mortgage brokerage. It has been designed as a scalable operating platform that combines experienced advisers, intelligent technology and structured talent development.</p>
      <p>The partnership proposed with HLP is intended to create mutual value. Mortgage Hub benefits from HLP's governance, regulatory expertise and established market presence. HLP benefits from participation in a business designed around innovation, adviser development and long-term enterprise value.</p>
      <div class="callout"><p><b>The investment proposition:</b> Mortgage Hub is seeking a strategic partner rather than a passive investor — a long-term relationship founded on shared values, aligned incentives and a common ambition to build one of the UK's most progressive technology-enabled mortgage distribution platforms.</p></div>
      <p style="margin-top:4mm;font-size:9.5px;font-style:italic;">For almost three decades I have had the privilege of leading teams, transforming businesses and helping customers achieve their financial goals. Mortgage Hub represents the opportunity to bring together everything I have learned into a business designed for the future. I believe HLP is the right organisation to help bring that vision to life.</p>
      <p style="font-size:9px;font-weight:700;margin-top:3mm;">Peter Mabbott · Founder &amp; Managing Director</p>`,
      "14",
    ),
  ].join("");
}

function platformPages() {
  return memoPage(
    "Live Platform",
    `<h1>Live Platform Capabilities</h1>
    <p class="lead">The Mortgage Hub platform is operational today. The following capabilities are live and demonstrated in the accompanying user guide (Appendix A).</p>
    <h2>Customer Experience <span class="badge-live">Live</span></h2>
    <ul>
      <li><b>Susan AI</b> — spoken fact-find (voice) and typed chat alternative</li>
      <li><b>Appointment booking</b> — self-serve diary with SMS and email confirmation</li>
      <li><b>Post-booking choice</b> — complete fact-find or confirm attendance only</li>
      <li><b>Customer hub</b> — view cases, update contact details and address</li>
      <li><b>Refer-a-friend</b> — personal referral links with admin-configurable limits</li>
    </ul>
    <h2>Introducer Portal <span class="badge-live">Live</span></h2>
    <ul>
      <li>Shareable referral link with automatic attribution</li>
      <li>Portal booking with email + SMS confirmation</li>
      <li>SMS booking links and manual lead logging</li>
      <li>Referral dashboard — journey stage, advisor, days at stage, last contact</li>
      <li>Commission statement with payout dates</li>
      <li>Company code for team onboarding</li>
    </ul>
    <h2>Advisor Workspace <span class="badge-live">Live</span></h2>
    <ul>
      <li>Tabbed customer profile — Contact, Notes &amp; history, Fact find, Journey, CRM</li>
      <li>Needs-attention highlights for call-backs and ready-to-review customers</li>
      <li>Integrated softphone — outbound/inbound calls with recording</li>
      <li>AI call transcription and conversation summaries on customer timeline</li>
      <li>Voicemail capture and transcription</li>
      <li>Contacts tab with mark-contacted workflow (disables once actioned)</li>
      <li>Customer profile introducer attribution — amend/refresh (owner-only)</li>
      <li>Journey milestones with customer SMS on confirmation</li>
      <li>Personal commission statement</li>
    </ul>
    <h2>Owner &amp; Admin <span class="badge-live">Live</span></h2>
    <ul>
      <li>Finance ledger enriched with customer, case ref, receiver and reference</li>
      <li>Commission management, audit history and current arrangements</li>
      <li>Previous rates browse by date range and fee type</li>
      <li>Excel and PDF exports (finance, commission, audit, customers)</li>
      <li>Admin hierarchy — owner, supervisor, general admin with granular permissions</li>
      <li>Admin invite flow and advisor view impersonation</li>
      <li>Manage advisors, introducers, RAF limits and test accounts</li>
    </ul>
    <h2>Coming Soon <span class="badge-soon">Roadmap</span></h2>
    <ul>
      <li>Document upload &amp; AI scanning · Integrated ID checks</li>
      <li>Open Banking · Payment links · Smarter document workflows</li>
      <li>HLP system integration · Data warehouse &amp; BI dashboards</li>
    </ul>`,
    "15",
  );
}

function appendixPages() {
  const appendixCover = `<div class="page">
    <div class="memo-header">
      <div class="brand">Mortgage Hub · Project Atlas</div>
      <div class="part">Appendix A</div>
    </div>
    <div class="appendix-cover">
      <h1>Appendix A</h1>
      <p>Mortgage Hub — User Guide &amp; Instruction Manual</p>
      <p style="font-size:9px;margin-top:10px;color:#888;">Complete guide for customers, introducers, advisors, admin staff and firm owners.<br/>Version 2026</p>
    </div>
    <div class="page-num">A-1</div>
  </div>`;

  // Reuse manual section pages with memorandum header styling
  const manualPages = manualSections
    .map((s, i) => {
      const num = `A-${i + 2}`;
      return `<div class="page">
        <div class="memo-header">
          <div class="brand">Mortgage Hub · Project Atlas</div>
          <div class="part">Appendix A · ${s.tag}</div>
        </div>
        <div class="memo-body" style="font-size:inherit;">${s.content}</div>
        <div class="page-footer">Appendix A — User Guide · Strictly Private &amp; Confidential</div>
        <div class="page-num">${num}</div>
      </div>`;
    })
    .join("");

  return appendixCover + manualPages;
}

function buildMemorandumHtml() {
  const pages = [
    coverPage(),
    confidentialityPage(),
    contentsPage(),
    part1Pages(),
    part2Pages(),
    part3Pages(),
    part4Pages(),
    platformPages(),
    appendixPages(),
  ].join("");

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8" />
<title>Project Atlas — Confidential Investment Memorandum</title>
<style>${MEMO_CSS}
  /* Appendix inherits manual table/callout styles */
  ${MANUAL_CSS.replace(/\.manual \.page[^}]+}/g, "")}
  .memo-body table.data { width:100%; border-collapse:collapse; margin:2.5mm 0 4mm; font-size:8.5px; }
  .memo-body table.data th, .memo-body table.data td { border:1px solid var(--line); padding:4px 7px; }
  .memo-body table.data th { background:var(--navy); color:#fff; }
  .memo-body .role-badge { display:inline-block; font-size:7px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:var(--accent); background:var(--accent-soft); padding:2px 8px; border-radius:999px; margin-bottom:4px; }
  .memo-body .callout { background:var(--accent-soft); border-left:3px solid var(--accent); padding:7px 10px; border-radius:0 6px 6px 0; margin:3mm 0; }
  .memo-body h2 { font-size:13px; font-weight:800; color:var(--navy); margin:4mm 0 2mm; padding-bottom:2px; border-bottom:2px solid var(--accent); }
  .memo-body h3 { font-size:10.5px; font-weight:700; color:var(--navy-soft); margin:3mm 0 2mm; }
  .memo-body .lead { font-size:10px; color:var(--muted); margin-bottom:3mm; }
  .memo-body p, .memo-body li { font-size:9px; line-height:1.55; }
  /* Reassert cover background AFTER manual CSS so FLYER_CSS's base .page (cream) can't override it */
  .page.cover-page { background: linear-gradient(165deg, var(--navy) 0%, var(--navy-mid) 55%, #2a3555 100%) !important; color:#fff !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
</style>
</head>
<body class="pack">${pages}</body>
</html>`;
}

const htmlPath = resolve(__dirname, "mortgage-hub-investment-memorandum.html");
const html = buildMemorandumHtml();
await writeFile(htmlPath, html, "utf8");
console.log(`HTML written: ${htmlPath}`);

const browser = await launchBrowser();
try {
  const pdfPath = resolve(__dirname, "mortgage-hub-investment-memorandum.pdf");
  await renderHtmlToPdf(browser, htmlPath, pdfPath);
  console.log(`PDF written:  ${pdfPath}`);
} finally {
  await browser.close();
}
