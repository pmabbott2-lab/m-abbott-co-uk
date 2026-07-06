// Builds Mortgage Hub instruction manual (multi-page A4 PDF).
// Run: node marketing/build-manual.mjs

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { CONTACT, FLYER_CSS } from "./flyer-shared.mjs";
import { launchBrowser, renderHtmlToPdf } from "./pdf-render.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MANUAL_CSS = `
  ${FLYER_CSS}
  .manual .page { min-height: 297mm; padding-bottom: 14mm; }
  .manual .page-num {
    position: absolute; bottom: 6mm; right: 12mm;
    font-size: 8px; color: var(--muted);
  }
  .cover {
    flex: 1; display: flex; flex-direction: column; justify-content: center;
    padding: 20mm 16mm; text-align: center;
  }
  .cover .mark-lg {
    width: 56px; height: 56px; border-radius: 50%; margin: 0 auto 12px;
    background: linear-gradient(145deg, var(--accent), var(--accent-deep));
    display: flex; align-items: center; justify-content: center;
    color: var(--navy-deep); font-weight: 800; font-size: 28px;
    box-shadow: inset 0 0 0 4px rgba(255,255,255,0.12);
  }
  .cover h1 { font-size: 32px; color: var(--navy); font-weight: 800; line-height: 1.15; }
  .cover .sub { margin-top: 10px; font-size: 14px; color: var(--muted); line-height: 1.5; }
  .cover .meta { margin-top: 24px; font-size: 10px; color: var(--muted); }
  .body { padding: 8mm 14mm 4mm; flex: 1; }
  .body h2 {
    font-size: 16px; color: var(--navy); font-weight: 800;
    margin: 0 0 6px; padding-bottom: 4px; border-bottom: 2px solid var(--accent);
  }
  .body h3 { font-size: 11.5px; color: var(--navy); font-weight: 700; margin: 8px 0 4px; }
  .body p, .body li { font-size: 9.5px; line-height: 1.55; color: var(--primary); }
  .body ul, .body ol { margin: 4px 0 8px 16px; }
  .body li { margin-bottom: 3px; }
  .body .lead { font-size: 10.5px; color: var(--muted); margin-bottom: 8px; }
  .toc { columns: 2; column-gap: 10mm; margin-top: 6px; }
  .toc-item {
    break-inside: avoid; font-size: 9.5px; padding: 4px 0;
    border-bottom: 1px dotted var(--line); display: flex; justify-content: space-between;
  }
  .toc-item span { color: var(--muted); }
  .callout {
    background: var(--accent-soft); border-left: 3px solid var(--accent);
    padding: 8px 10px; border-radius: 0 8px 8px 0; margin: 8px 0;
  }
  .callout p { font-size: 9px; color: var(--primary); margin: 0; }
  .callout b { color: var(--navy); }
  table.data {
    width: 100%; border-collapse: collapse; margin: 6px 0 10px; font-size: 9px;
  }
  table.data th, table.data td {
    border: 1px solid var(--line); padding: 5px 7px; text-align: left; vertical-align: top;
  }
  table.data th { background: var(--navy); color: #fff; font-weight: 700; }
  table.data tr:nth-child(even) td { background: #fff; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
  .role-badge {
    display: inline-block; font-size: 8px; font-weight: 700; letter-spacing: 1px;
    text-transform: uppercase; color: var(--accent-deep);
    background: var(--accent-soft); padding: 2px 8px; border-radius: 999px; margin-bottom: 4px;
  }
  .pack .page { page-break-after: always; break-after: page; }
  .pack .page:last-child { page-break-after: auto; break-after: auto; }
`;

function page(title, tag, content, pageNum) {
  return `<div class="page">
    <div class="header">
      <div class="brand"><div class="mark">M</div><div class="name">Mortgage&nbsp;Hub</div></div>
      <div class="tag">${tag}</div>
    </div>
    <div class="body">${content}</div>
    <div class="page-num">${pageNum}</div>
  </div>`;
}

function coverPage() {
  return `<div class="page">
    <div class="header">
      <div class="brand"><div class="mark">M</div><div class="name">Mortgage&nbsp;Hub</div></div>
      <div class="tag">Instruction manual</div>
    </div>
    <div class="cover">
      <div class="mark-lg">M</div>
      <h1>Instruction Manual</h1>
      <p class="sub">Complete guide for customers, introducers, advisors and firm owners.<br/>Covers sign-in, booking, CRM, diary, commission and admin tools.</p>
      <p class="meta">${CONTACT.web} · ${CONTACT.email} · Version 2026</p>
    </div>
  </div>`;
}

function buildManualHtml() {
  const pages = [
    coverPage(),
    page(
      "Contents",
      "Overview",
      `<h2>Contents</h2>
      <div class="toc">
        <div class="toc-item"><b>1. Overview &amp; roles</b> <span>3</span></div>
        <div class="toc-item"><b>2. Signing in</b> <span>3</span></div>
        <div class="toc-item"><b>3. Customer portal</b> <span>3</span></div>
        <div class="toc-item"><b>4. Introducer portal</b> <span>4</span></div>
        <div class="toc-item"><b>5. Advisor workspace</b> <span>5</span></div>
        <div class="toc-item"><b>6. CRM, diary &amp; appointments</b> <span>6</span></div>
        <div class="toc-item"><b>7. Commission &amp; finance</b> <span>7</span></div>
        <div class="toc-item"><b>8. Owner &amp; admin tools</b> <span>8</span></div>
        <div class="toc-item"><b>9. Quick reference</b> <span>9</span></div>
      </div>
      <h2>1. Overview &amp; roles</h2>
      <p class="lead">Mortgage Hub is a multi-role platform that prepares customers before their first advisor meeting, tracks introducer referrals, and gives advisors and owners a single workspace for cases, commission and reporting.</p>
      <table class="data">
        <tr><th>Role</th><th>Who</th><th>Main purpose</th></tr>
        <tr><td><b>Customer</b></td><td>Homebuyers &amp; remortgagers</td><td>Complete fact-find (voice or type), book appointments, manage contact details, refer friends.</td></tr>
        <tr><td><b>Introducer</b></td><td>Estate agents, solicitors, planners</td><td>Share referral link, book customers, track journey stage, view commission.</td></tr>
        <tr><td><b>Advisor</b></td><td>Mortgage advisors</td><td>Manage customers, CRM, diary, fact-finds, milestones and personal commission.</td></tr>
        <tr><td><b>Owner / Admin</b></td><td>Firm owner, supervisor</td><td>Finance ledger, commission management, exports, advisor view, team management.</td></tr>
      </table>
      <h2>2. Signing in</h2>
      <p>All users sign in at <b>${CONTACT.web}</b>. Available methods depend on role:</p>
      <ul>
        <li><b>Email &amp; password</b> — standard for advisors, introducers and customers.</li>
        <li><b>Google sign-in</b> — available where configured for customers.</li>
        <li><b>SMS one-time code</b> — customers can sign in with their mobile number.</li>
        <li><b>Authenticator app</b> — advisors and admin staff use two-factor authentication.</li>
      </ul>
      <div class="callout"><p><b>Test accounts:</b> Firm owners can provision test accounts (Manage → Test accounts) for training. Test emails bypass SMS verification when configured.</p></div>`,
      "2",
    ),
    page(
      "Customer portal",
      "Customers",
      `<span class="role-badge">Customer</span>
      <h2>3. Customer portal</h2>
      <p class="lead">After sign-in, customers choose how to start: spoken fact-find with Susan, typed chat, or book an appointment immediately.</p>
      <h3>Three ways to get started</h3>
      <ol>
        <li><b>Spoken fact-find</b> — Susan (AI voice guide) asks each question aloud and listens to answers.</li>
        <li><b>Typed fact-find</b> — Same questions in a quiet chat; pause and resume any time.</li>
        <li><b>Book an appointment</b> — Pick an available advisor slot from the diary.</li>
      </ol>
      <h3>After booking</h3>
      <p>When a customer books (or is booked by staff/introducer), they receive <b>SMS and email</b> confirmation. They can then:</p>
      <ul>
        <li>Complete the spoken fact-find</li>
        <li>Complete the typed fact-find</li>
        <li><b>Confirm attendance only</b> — skip fact-find and just confirm they will attend</li>
      </ul>
      <h3>Customer hub</h3>
      <p>Customers can view their cases and update contact details including name, email, phone and address. Changes sync to the advisor CRM automatically.</p>
      <h3>Refer a friend</h3>
      <p>Customers receive a personal Refer-a-Friend link. When friends sign up through that link, the referrer is credited. Admin can configure RAF limits in Manage.</p>
      <div class="callout"><p><b>Tip:</b> Completing the fact-find before the meeting means the advisor already has an AI summary — the first call starts with context, not basic questions.</p></div>`,
      "3",
    ),
    page(
      "Introducer portal",
      "Introducers",
      `<span class="role-badge">Introducer</span>
      <h2>4. Introducer portal</h2>
      <p class="lead">Introducers refer customers, book appointments on their behalf, and track progress without seeing sensitive fact-find answers.</p>
      <h3>Referral link</h3>
      <p>Every introducer has a unique shareable link. Customers who sign up through it are automatically attributed to that introducer.</p>
      <h3>Book a customer (portal booking)</h3>
      <ol>
        <li>Open the <b>Book customer</b> card on your dashboard.</li>
        <li>Enter customer name, <b>email</b> (required) and phone number.</li>
        <li>Select an advisor and available appointment slot.</li>
        <li>Submit — the customer receives SMS and email with a link to confirm and choose next steps.</li>
      </ol>
      <h3>Other introducer tools</h3>
      <ul>
        <li><b>SMS booking link</b> — send a personalised link for the customer to pick their own time.</li>
        <li><b>Manual lead logging</b> — record name, phone and notes for telephone enquiries.</li>
        <li><b>Company code</b> — 4-digit code so colleagues join the same introducer company.</li>
        <li><b>Referral dashboard</b> — see name, journey stage, lead source, allocated advisor, days at stage and last contact date.</li>
        <li><b>My commission</b> — view introducer commission entries and payout dates.</li>
      </ul>
      <div class="callout"><p><b>Privacy:</b> Introducers see journey stage and contact metadata — not full fact-find answers or financial detail.</p></div>`,
      "4",
    ),
    page(
      "Advisor workspace",
      "Advisors",
      `<span class="role-badge">Advisor</span>
      <h2>5. Advisor workspace</h2>
      <p class="lead">Advisors manage their customer caseload from a tabbed dashboard with needs-attention highlights on the home screen.</p>
      <h3>Home screen</h3>
      <ul>
        <li><b>Needs attention</b> — customers with pending call-backs or fact-finds ready for review.</li>
        <li><b>Customer booking card</b> — book a new customer or send SMS + email booking link (same as staff/introducer flow).</li>
        <li><b>Diary summary</b> — upcoming appointments at a glance.</li>
      </ul>
      <h3>Customer profile (tabs)</h3>
      <table class="data">
        <tr><th>Tab</th><th>Contents</th></tr>
        <tr><td><b>Contact</b></td><td>Name, email, phone, address — editable; syncs with customer hub.</td></tr>
        <tr><td><b>Notes &amp; history</b></td><td>Advisor notes and full audit timeline (SMS, appointments, milestones).</td></tr>
        <tr><td><b>Fact find</b></td><td>Structured answers and AI-generated summary.</td></tr>
        <tr><td><b>Customer journey</b></td><td>Milestone tracker: appointment seen, ID confirmed, AIP completed.</td></tr>
        <tr><td><b>CRM</b></td><td>Contact card on cases — quick view of customer details linked to the case.</td></tr>
      </table>
      <h3>My commission</h3>
      <p>Advisors view their personal commission statement. Commission is credited when fees are submitted on a case (see Finance section).</p>`,
      "5",
    ),
    page(
      "CRM, diary & appointments",
      "Operations",
      `<h2>6. CRM, diary &amp; appointments</h2>
      <h3>Diary</h3>
      <p>The advisor diary shows booked appointments and available slots. Advisors and admin can:</p>
      <ul>
        <li>View upcoming and past appointments</li>
        <li><b>Amend appointments</b> — change date/time for an existing booking</li>
        <li>Book customers directly from the booking card</li>
      </ul>
      <h3>Appointments &amp; confirmations</h3>
      <p>Every booking triggers SMS and email to the customer. Customers can confirm attendance or continue their fact-find from the link provided.</p>
      <h3>CRM contact sync</h3>
      <p>Customer contact details (name, email, phone, address) are stored centrally. When a customer updates their hub, advisors see changes on the Contact tab and CRM card immediately.</p>
      <h3>Journey milestones</h3>
      <p>Advisors mark milestones as customers progress:</p>
      <ol>
        <li><b>Appointment seen</b> — customer attended or spoke with advisor</li>
        <li><b>ID confirmed</b> — identity documents verified</li>
        <li><b>AIP completed</b> — agreement in principle obtained</li>
      </ol>
      <p>Confirming milestones can trigger customer SMS notifications.</p>
      <h3>Call-back management</h3>
      <p>Log contact attempts, set next-contact dates, and use needs-attention alerts so no customer is forgotten.</p>`,
      "6",
    ),
    page(
      "Commission & finance",
      "Finance",
      `<h2>7. Commission &amp; finance</h2>
      <div class="two-col">
        <div>
          <h3>How commission works</h3>
          <ul>
            <li>When an advisor submits a fee on a case, commission is calculated automatically.</li>
            <li><b>Advisor commission</b> is credited to the advisor's statement.</li>
            <li><b>Introducer commission</b> is credited based on the percentage set on the advisor table.</li>
            <li>Payout dates appear on My commission (advisor/introducer) and Commission mgmt (owner).</li>
          </ul>
        </div>
        <div>
          <h3>Owner finance tabs</h3>
          <ul>
            <li><b>Finance</b> — firm-wide fee ledger with scrollable history.</li>
            <li><b>Commission mgmt</b> — all commission entries across advisors and introducers.</li>
            <li><b>My commission</b> — owner's own advisor commission (if applicable).</li>
          </ul>
        </div>
      </div>
      <h3>Report exports</h3>
      <p>On Finance, Commission mgmt, My commission and the owner Customers tab, use the export box (bottom-left) to download:</p>
      <ul>
        <li><b>Excel (.xlsx)</b> — spreadsheet for further analysis</li>
        <li><b>PDF</b> — formatted report for printing or filing</li>
      </ul>
      <div class="callout"><p><b>Note:</b> Finance tables show the most recent 10 rows with scroll for older entries. Exports include the full dataset.</p></div>`,
      "7",
    ),
    page(
      "Owner & admin tools",
      "Administration",
      `<span class="role-badge">Owner / Admin</span>
      <h2>8. Owner &amp; admin tools</h2>
      <h3>Advisor view tab</h3>
      <p>Owners and supervisors open the <b>Advisor view</b> tab to impersonate any advisor's dashboard — see their customers, diary and workload exactly as they do. Exit advisor view to return to the owner dashboard.</p>
      <h3>Manage tab</h3>
      <ul>
        <li><b>Advisors</b> — invite, suspend, reinstate and delete advisors.</li>
        <li><b>Introducers</b> — manage introducer companies and access.</li>
        <li><b>Refer-a-friend limits</b> — configure RAF bonus rules.</li>
        <li><b>Test accounts</b> — provision or revoke test customer/advisor accounts for training.</li>
      </ul>
      <h3>Customers tab (owner)</h3>
      <p>Firm-wide customer list with export to Excel/PDF. Search and review all cases across advisors.</p>
      <h3>Introducer percentages</h3>
      <p>Set introducer commission percentage per advisor on the advisor management table. This percentage applies when fees are submitted on attributed cases.</p>
      <h3>Security</h3>
      <p>Admin and advisor accounts require authenticator-app two-factor authentication. Customer accounts support email, Google or SMS sign-in.</p>`,
      "8",
    ),
    page(
      "Quick reference",
      "Reference",
      `<h2>9. Quick reference</h2>
      <table class="data">
        <tr><th>Task</th><th>Where to go</th><th>Role</th></tr>
        <tr><td>Start spoken fact-find</td><td>Customer home → Talk to Susan</td><td>Customer</td></tr>
        <tr><td>Book appointment</td><td>Customer home → Book a call</td><td>Customer</td></tr>
        <tr><td>Confirm attendance only</td><td>Link in booking SMS/email</td><td>Customer</td></tr>
        <tr><td>Book customer for someone</td><td>Book customer card</td><td>Introducer / Advisor</td></tr>
        <tr><td>Send SMS booking link</td><td>Book customer card → Send link</td><td>Introducer / Advisor</td></tr>
        <tr><td>Amend appointment</td><td>Diary → select appointment → Amend</td><td>Advisor</td></tr>
        <tr><td>View AI fact-find summary</td><td>Customer profile → Fact find tab</td><td>Advisor</td></tr>
        <tr><td>Mark journey milestone</td><td>Customer profile → Customer journey</td><td>Advisor</td></tr>
        <tr><td>Check my commission</td><td>My commission tab</td><td>Advisor / Introducer</td></tr>
        <tr><td>Export finance report</td><td>Finance tab → Export box (bottom-left)</td><td>Owner</td></tr>
        <tr><td>View as advisor</td><td>Advisor view tab → select advisor</td><td>Owner</td></tr>
        <tr><td>Provision test account</td><td>Manage → Test accounts</td><td>Owner</td></tr>
      </table>
      <h3>Support</h3>
      <p>For access issues, booking problems or commission queries, contact:</p>
      <ul>
        <li><b>Web:</b> ${CONTACT.web}</li>
        <li><b>Email:</b> ${CONTACT.email}</li>
        <li><b>Phone:</b> ${CONTACT.phone}</li>
      </ul>
      <div class="callout"><p><b>Printing tip:</b> Marketing flyers and this manual are generated as high-resolution A4 PDFs from the <code>marketing/</code> folder. Rebuild with <code>npm run build:marketing</code>.</p></div>`,
      "9",
    ),
  ];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Mortgage Hub — Instruction Manual</title>
<style>${MANUAL_CSS}</style>
</head>
<body class="manual pack">${pages.join("")}</body>
</html>`;
}

const htmlPath = resolve(__dirname, "mortgage-hub-instruction-manual.html");
const html = buildManualHtml();
await writeFile(htmlPath, html, "utf8");
console.log(`HTML written: ${htmlPath}`);

const browser = await launchBrowser();

try {
  const pdfPath = resolve(__dirname, "mortgage-hub-instruction-manual.pdf");
  await renderHtmlToPdf(browser, htmlPath, pdfPath);
  console.log(`PDF written:  ${pdfPath}`);
} finally {
  await browser.close();
}
