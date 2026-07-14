// Builds Mortgage Hub instruction manual (multi-page A4 PDF).
// Also exports MANUAL_CSS + manualSections so the investment memorandum
// can embed the same user guide as an appendix.
// Run: node marketing/build-manual.mjs

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { CONTACT, FLYER_CSS } from "./flyer-shared.mjs";
import { launchBrowser, renderHtmlToPdf } from "./pdf-render.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const MANUAL_CSS = `
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

function manualPage(tag, content, pageNum) {
  return `<div class="page">
    <div class="header">
      <div class="brand"><div class="mark">M</div><div class="name">Mortgage&nbsp;Hub</div></div>
      <div class="tag">${tag}</div>
    </div>
    <div class="body">${content}</div>
    ${pageNum ? `<div class="page-num">${pageNum}</div>` : ""}
  </div>`;
}

// Body content for each user-guide section (excluding cover + contents).
// Exported so the investment memorandum can render them as an appendix.
export const manualSections = [
  {
    tag: "Overview",
    content: `<h2>1. Overview &amp; roles</h2>
      <p class="lead">Mortgage Hub is a multi-role platform that prepares customers before their first advisor meeting, tracks introducer referrals, and gives advisors and owners a single workspace for cases, commission, telephony and reporting.</p>
      <table class="data">
        <tr><th>Role</th><th>Who</th><th>Main purpose</th></tr>
        <tr><td><b>Customer</b></td><td>Homebuyers &amp; remortgagers</td><td>Complete fact-find (voice or type), book appointments, manage contact details, refer friends.</td></tr>
        <tr><td><b>Introducer</b></td><td>Estate agents, solicitors, planners</td><td>Share referral link, book customers, track journey stage, view commission.</td></tr>
        <tr><td><b>Advisor</b></td><td>Mortgage advisors</td><td>Manage customers, CRM, diary, fact-finds, calls, milestones and personal commission.</td></tr>
        <tr><td><b>General admin</b></td><td>Support staff</td><td>Operational tasks and reporting within permissions granted by the owner.</td></tr>
        <tr><td><b>Supervisor</b></td><td>Senior admin</td><td>Elevated admin able to manage permissions and team, as delegated by the owner.</td></tr>
        <tr><td><b>Owner</b></td><td>Firm principal</td><td>Full finance, commission, audit, admin and team management across the firm.</td></tr>
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
  },
  {
    tag: "Customers",
    content: `<span class="role-badge">Customer</span>
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
  },
  {
    tag: "Introducers",
    content: `<span class="role-badge">Introducer</span>
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
  },
  {
    tag: "Advisors",
    content: `<span class="role-badge">Advisor</span>
      <h2>5. Advisor workspace</h2>
      <p class="lead">Advisors manage their customer caseload from a tabbed dashboard with needs-attention highlights on the home screen.</p>
      <h3>Home screen</h3>
      <ul>
        <li><b>Needs attention</b> — customers with pending call-backs or fact-finds ready for review.</li>
        <li><b>Customer booking card</b> — book a new customer or send SMS + email booking link (same as staff/introducer flow).</li>
        <li><b>Diary summary</b> — upcoming appointments at a glance.</li>
      </ul>
      <h3>Contacts tab</h3>
      <ul>
        <li><b>Appointments &amp; call-backs</b> to work through, with lead source and last-contact detail.</li>
        <li><b>Mark contacted</b> — once a contact is actioned the button greys out and disables, so nobody is called twice.</li>
        <li><b>Introducer box</b> — shows the customer's introducer code and company, with an <b>Amend</b> option (permission-controlled) and, for owners, <b>Refresh commission</b> to recalculate attribution.</li>
      </ul>
      <h3>Customer profile (tabs)</h3>
      <table class="data">
        <tr><th>Tab</th><th>Contents</th></tr>
        <tr><td><b>Contact</b></td><td>Name, email, phone, address — editable; syncs with customer hub.</td></tr>
        <tr><td><b>Notes &amp; history</b></td><td>Advisor notes and full audit timeline (calls, SMS, appointments, milestones).</td></tr>
        <tr><td><b>Fact find</b></td><td>Structured answers and AI-generated summary.</td></tr>
        <tr><td><b>Customer journey</b></td><td>Milestone tracker: appointment seen, ID confirmed, AIP completed.</td></tr>
        <tr><td><b>CRM</b></td><td>Contact card on cases — quick view of customer details linked to the case.</td></tr>
      </table>
      <h3>My commission</h3>
      <p>Advisors view their personal commission statement. Commission is credited when fees are submitted on a case (see Finance section).</p>`,
  },
  {
    tag: "Telephony",
    content: `<h2>6. Calls &amp; telephony</h2>
      <p class="lead">Mortgage Hub includes integrated telephony so advisors can call customers from within the platform, with recordings and AI summaries logged to the customer timeline.</p>
      <h3>Making &amp; receiving calls</h3>
      <ul>
        <li><b>Softphone</b> — advisors call customers directly from the browser; outbound calls are linked to the customer record.</li>
        <li><b>Inbound handling</b> — incoming calls are routed and, when unanswered, captured as voicemail.</li>
      </ul>
      <h3>Recording, transcription &amp; summaries</h3>
      <ul>
        <li>Calls are <b>recorded</b> and attached to the phone-call record for the customer.</li>
        <li><b>AI transcription</b> converts the recording to text.</li>
        <li>An <b>AI summary</b> of the conversation is written to the customer's Notes &amp; history timeline.</li>
        <li><b>Voicemail</b> messages are transcribed and surfaced for follow-up.</li>
      </ul>
      <div class="callout"><p><b>Audit:</b> Every call, recording, transcript and summary is retained on the customer timeline alongside SMS, appointments and milestones — a single, reviewable record.</p></div>
      <h2>7. Diary &amp; appointments</h2>
      <h3>Diary</h3>
      <ul>
        <li>View upcoming and past appointments and available slots.</li>
        <li><b>Amend appointments</b> — change date/time for an existing booking.</li>
        <li>Book customers directly from the booking card.</li>
      </ul>
      <h3>Journey milestones</h3>
      <ol>
        <li><b>Appointment seen</b> — customer attended or spoke with advisor.</li>
        <li><b>ID confirmed</b> — identity documents verified.</li>
        <li><b>AIP completed</b> — agreement in principle obtained.</li>
      </ol>
      <p>Confirming milestones can trigger customer SMS notifications. Log contact attempts and next-contact dates so no customer is forgotten.</p>`,
  },
  {
    tag: "Finance",
    content: `<h2>8. Commission &amp; finance</h2>
      <div class="two-col">
        <div>
          <h3>How commission works</h3>
          <ul>
            <li>When an advisor submits a fee on a case, commission is calculated automatically.</li>
            <li><b>Advisor commission</b> is credited to the advisor's statement.</li>
            <li><b>Introducer commission</b> is credited using the introducer effective at the fee date.</li>
            <li>Payout dates appear on My commission and Commission mgmt.</li>
          </ul>
        </div>
        <div>
          <h3>Owner finance tabs</h3>
          <ul>
            <li><b>Finance</b> — firm-wide fee ledger, enriched with customer, case ref, receiver and reference.</li>
            <li><b>Commission mgmt</b> — all commission entries across advisors and introducers.</li>
            <li><b>My commission</b> — owner's own advisor commission (if applicable).</li>
          </ul>
        </div>
      </div>
      <h3>Commission audit &amp; arrangements</h3>
      <ul>
        <li><b>Commission audit history</b> — a combined log of rate changes and introducer amendments, with who/when.</li>
        <li><b>Current commission arrangements</b> — the live rates in force per advisor / introducer role.</li>
        <li><b>Previous rates by date range</b> — browse historic rates filtered by fee type and date range.</li>
      </ul>
      <h3>Report exports</h3>
      <p>On Finance, Commission mgmt, My commission and the owner Customers tab, use the export box (bottom-left) to download:</p>
      <ul>
        <li><b>Excel (.xlsx)</b> — including finance audit and rate-history sheets.</li>
        <li><b>PDF</b> — formatted report for printing or filing.</li>
      </ul>
      <div class="callout"><p><b>Note:</b> Finance tables show the most recent rows with scroll for older entries. Exports include the full dataset.</p></div>`,
  },
  {
    tag: "Administration",
    content: `<span class="role-badge">Owner / Admin</span>
      <h2>9. Owner &amp; admin tools</h2>
      <h3>Admin hierarchy</h3>
      <table class="data">
        <tr><th>Level</th><th>Can do</th></tr>
        <tr><td><b>Owner</b></td><td>Everything: finance, commission, audit, grant admin levels, edit all permissions, manage team.</td></tr>
        <tr><td><b>Supervisor</b></td><td>Elevated admin; can edit general-admin permissions and manage team as delegated.</td></tr>
        <tr><td><b>General admin</b></td><td>Operational access limited to the specific permissions granted by the owner/supervisor.</td></tr>
      </table>
      <h3>Inviting &amp; managing admins</h3>
      <ul>
        <li><b>Invite an admin</b> from the Manage tab — the invitee registers, then the owner assigns supervisor or general-admin access.</li>
        <li><b>Admin access panel</b> — select a registered admin and set their level and granular permissions (e.g. introducer amend, finance, exports).</li>
        <li>"Make supervisor" and "Permissions" controls appear only for those authorised to grant them.</li>
      </ul>
      <h3>Advisor view tab</h3>
      <p>Owners and supervisors open the <b>Advisor view</b> tab to see any advisor's dashboard — their customers, diary and workload. Exit advisor view to return.</p>
      <h3>Manage tab</h3>
      <ul>
        <li><b>Advisors</b> — invite, suspend, reinstate and delete advisors.</li>
        <li><b>Introducers</b> — manage introducer companies and access.</li>
        <li><b>Refer-a-friend limits</b> — configure RAF bonus rules (compact, scrollable list).</li>
        <li><b>Test accounts</b> — provision or revoke test accounts for training.</li>
      </ul>
      <h3>Security</h3>
      <p>Admin and advisor accounts require authenticator-app two-factor authentication. Customer accounts support email, Google or SMS sign-in.</p>`,
  },
  {
    tag: "Reference",
    content: `<h2>10. Quick reference</h2>
      <table class="data">
        <tr><th>Task</th><th>Where to go</th><th>Role</th></tr>
        <tr><td>Start spoken fact-find</td><td>Customer home → Talk to Susan</td><td>Customer</td></tr>
        <tr><td>Book appointment</td><td>Customer home → Book a call</td><td>Customer</td></tr>
        <tr><td>Confirm attendance only</td><td>Link in booking SMS/email</td><td>Customer</td></tr>
        <tr><td>Book customer for someone</td><td>Book customer card</td><td>Introducer / Advisor</td></tr>
        <tr><td>Send SMS booking link</td><td>Book customer card → Send link</td><td>Introducer / Advisor</td></tr>
        <tr><td>Call a customer</td><td>Customer profile → Call</td><td>Advisor</td></tr>
        <tr><td>Read call summary</td><td>Customer profile → Notes &amp; history</td><td>Advisor</td></tr>
        <tr><td>Mark contact as contacted</td><td>Contacts tab → Mark contacted</td><td>Advisor</td></tr>
        <tr><td>Amend introducer</td><td>Contacts → Introducer box → Amend</td><td>Advisor (permitted)</td></tr>
        <tr><td>Amend appointment</td><td>Diary → select appointment → Amend</td><td>Advisor</td></tr>
        <tr><td>Mark journey milestone</td><td>Customer profile → Customer journey</td><td>Advisor</td></tr>
        <tr><td>Check my commission</td><td>My commission tab</td><td>Advisor / Introducer</td></tr>
        <tr><td>View commission audit</td><td>Finance → Commission audit history</td><td>Owner</td></tr>
        <tr><td>Export finance report</td><td>Finance tab → Export box (bottom-left)</td><td>Owner</td></tr>
        <tr><td>Invite an admin</td><td>Manage → Invite admin</td><td>Owner</td></tr>
        <tr><td>Set admin permissions</td><td>Admin access panel</td><td>Owner / Supervisor</td></tr>
        <tr><td>View as advisor</td><td>Advisor view tab → select advisor</td><td>Owner</td></tr>
        <tr><td>Provision test account</td><td>Manage → Test accounts</td><td>Owner</td></tr>
      </table>
      <h3>Support</h3>
      <ul>
        <li><b>Web:</b> ${CONTACT.web}</li>
        <li><b>Email:</b> ${CONTACT.email}</li>
        <li><b>Phone:</b> ${CONTACT.phone}</li>
      </ul>`,
  },
];

function contentsSection() {
  return `<h2>Contents</h2>
    <div class="toc">
      <div class="toc-item"><b>1. Overview &amp; roles</b> <span>3</span></div>
      <div class="toc-item"><b>2. Signing in</b> <span>3</span></div>
      <div class="toc-item"><b>3. Customer portal</b> <span>4</span></div>
      <div class="toc-item"><b>4. Introducer portal</b> <span>5</span></div>
      <div class="toc-item"><b>5. Advisor workspace</b> <span>6</span></div>
      <div class="toc-item"><b>6. Calls &amp; telephony</b> <span>7</span></div>
      <div class="toc-item"><b>7. Diary &amp; appointments</b> <span>7</span></div>
      <div class="toc-item"><b>8. Commission &amp; finance</b> <span>8</span></div>
      <div class="toc-item"><b>9. Owner &amp; admin tools</b> <span>9</span></div>
      <div class="toc-item"><b>10. Quick reference</b> <span>10</span></div>
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
      <p class="sub">Complete guide for customers, introducers, advisors, admin staff and firm owners.<br/>Covers sign-in, booking, CRM, telephony, diary, commission, audit and admin tools.</p>
      <p class="meta">${CONTACT.web} · ${CONTACT.email} · Version 2026</p>
    </div>
  </div>`;
}

// Renders the manual sections as pages. `startNum` sets the first page number
// (the memorandum appendix continues numbering from the memorandum body).
export function renderManualSectionPages(startNum = 3) {
  return manualSections
    .map((s, i) => manualPage(s.tag, s.content, startNum + i))
    .join("");
}

function buildManualHtml() {
  const pages = [
    coverPage(),
    manualPage("Overview", contentsSection() + manualSections[0].content, "2"),
    ...manualSections.slice(1).map((s, i) => manualPage(s.tag, s.content, `${i + 3}`)),
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

// Only render when run directly (not when imported by the memorandum builder).
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
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
}
