// Builds Mortgage Hub marketing flyers (customer, introducer, advisor) + 3-page print pack.
// Run: node marketing/build-flyers.mjs

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  ICONS,
  FLYER_CSS,
  avatarCard,
  benefit,
  customerSteps,
  customerWays,
  flyerShell,
  footer,
  header,
  roadmapItem,
} from "./flyer-shared.mjs";
import { launchBrowser, renderHtmlToPdf } from "./pdf-render.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const avatarDataUri = `data:image/png;base64,${(await readFile(resolve(repoRoot, "src/assets/susan.png"))).toString("base64")}`;

const PACK_CSS = `
  .pack .page { page-break-after: always; break-after: page; }
  .pack .page:last-child { page-break-after: auto; break-after: auto; }
`;

function customerFlyer() {
  const { doc, sms, lock, shield, gift, mail, users } = ICONS;
  return flyerShell(
    "Mortgage Hub — Customer Flyer",
    `<div class="page">
      ${header("AI-guided mortgage fact-find<br/>&amp; appointment booking")}
      <div class="hero">
        <div>
          <span class="eyebrow">Your mortgage journey, made simple</span>
          <h1>Get your mortgage advisor up to speed — <span class="hl">before you even meet.</span></h1>
          <p class="lead">Mortgage Hub guides customers through the questions a mortgage advisor needs — their way, at their own pace. Talk to Susan, type answers in a quiet chat, or book a call. After booking, choose to complete the fact-find or simply confirm attendance.</p>
          <div class="chips">
            <span class="chip"><b>Spoken</b> voice interview</span>
            <span class="chip"><b>Typed</b> chat assistant</span>
            <span class="chip"><b>Book</b> &amp; confirm by SMS + email</span>
          </div>
        </div>
        ${avatarCard(avatarDataUri)}
      </div>
      <div class="section"><div class="section-title"><span class="bar"></span>Three ways to get started</div>${customerWays()}</div>
      <div class="section"><div class="section-title"><span class="bar"></span>How it works</div>${customerSteps()}</div>
      <div class="section">
        <div class="section-title"><span class="bar"></span>Why customers love it</div>
        <div class="benefits">
          ${benefit(doc, "Automatic fact-find summary", "An AI-written summary goes straight to the advisor — no repeating yourself.")}
          ${benefit(sms, "SMS &amp; email confirmations", "Text and email when the interview completes and when appointments are booked.")}
          ${benefit(mail, "Flexible post-booking options", "After booking: complete spoken or typed fact-find, or confirm attendance only.")}
          ${benefit(users, "Your customer hub", "View cases, update contact details and address, and track your journey.")}
          ${benefit(lock, "Flexible, secure sign-in", "Email &amp; password, Google, or a one-time SMS code.")}
          ${benefit(shield, "Free to start &amp; private", "Begin in minutes. Details stay private until they're ready to share.")}
        </div>
      </div>
      <div class="highlight">
        <div class="ico">${gift}</div>
        <div>
          <h3>Refer a friend</h3>
          <p>Customers can share a personal Refer-a-Friend link. Friends get the same friendly guided start — and referrers are credited every time someone they invite joins.</p>
        </div>
      </div>
      ${footer({
        ctaHtml: `Ready to make your mortgage<br/>journey <span>simpler?</span>`,
        ctaBtn: "Get started — sign in &amp; choose your way",
        note: "For customers, advisors &amp; introducers · Partner programmes available.",
      })}
    </div>`,
  );
}

function introducerFlyer() {
  const { link, users, calendar, sms, chart, mail, pound, doc, clipboard } = ICONS;
  return flyerShell(
    "Mortgage Hub — Introducer Partner Flyer",
    `<div class="page">
      ${header("Introducer partner programme<br/>refer · book · track · earn")}
      <div class="hero">
        <div>
          <span class="eyebrow">Partner with Mortgage Hub</span>
          <h1>Refer customers with confidence — <span class="hl">full booking, full visibility, commission tracked.</span></h1>
          <p class="lead">Share your personal introducer link or book customers directly from your portal — with email and SMS confirmation. Every referral is attributed to you, commission is tracked, and you see journey stage without sensitive fact-find detail.</p>
          <div class="chips">
            <span class="chip"><b>Book</b> customers in-portal</span>
            <span class="chip"><b>SMS + email</b> confirmations</span>
            <span class="chip"><b>Commission</b> statement</span>
          </div>
        </div>
        ${avatarCard(avatarDataUri)}
      </div>
      <div class="section tight">
        <div class="section-title sm"><span class="bar"></span>What your customers get</div>
        <p class="section-sub">The same guided Mortgage Hub experience — voice interview with Susan, typed chat, instant booking, or confirm attendance only.</p>
        ${customerWays()}
      </div>
      <div class="section tight">
        <div class="section-title sm"><span class="bar"></span>Your introducer portal</div>
        <div class="benefits three">
          ${benefit(link, "Shareable referral link", "A unique link credits every self-serve customer to you automatically.", true)}
          ${benefit(calendar, "Book customers directly", "Enter name, email &amp; phone — pick an advisor slot and send SMS + email link.", true)}
          ${benefit(sms, "SMS booking links", "Text a customer a personalised link to pick a time or continue their journey.", true)}
          ${benefit(mail, "Email required on booking", "Professional confirmation emails alongside SMS for every portal booking.", true)}
          ${benefit(chart, "Referral dashboard", "Name, journey stage, lead source, advisor, days at stage &amp; last contact.", true)}
          ${benefit(pound, "My commission", "View introducer commission, payout dates and history in your portal.", true)}
          ${benefit(users, "Company code", "4-digit code lets colleagues join the same introducer company.", true)}
          ${benefit(doc, "Manual lead logging", "Capture name, phone and notes when you speak to someone directly.", true)}
          ${benefit(clipboard, "Privacy-conscious reporting", "Journey stage and contact dates — not full fact-find answers.", true)}
        </div>
      </div>
      <div class="section tight">
        <div class="section-title sm"><span class="bar"></span>How it works for you</div>
        <div class="steps">
          <div class="step"><div class="num">1</div><h4>Get your portal</h4><p>We set you up with a company profile, shareable link and optional company code.</p></div>
          <div class="step"><div class="num">2</div><h4>Share or book</h4><p>Send your link, book in-portal with email + SMS, or text a booking invite.</p></div>
          <div class="step"><div class="num">3</div><h4>Track &amp; earn</h4><p>Watch referrals progress and view commission credited when cases complete.</p></div>
        </div>
      </div>
      ${footer({
        ctaHtml: `Ready to partner<br/>with <span>Mortgage Hub?</span>`,
        ctaBtn: "Ask about introducer access",
        note: "Ideal for estate agents, financial planners, solicitors &amp; professional referrers · Company codes for teams.",
      })}
    </div>`,
  );
}

function advisorFlyer() {
  const {
    mic,
    chat,
    calendar,
    doc,
    sms,
    bell,
    clipboard,
    chart,
    users,
    link,
    shield,
    phone,
    pound,
    mail,
    eye,
  } = ICONS;
  return flyerShell(
    "Mortgage Hub — Advisor &amp; Admin Platform Flyer",
    `<div class="page">
      ${header("Advisor &amp; admin platform<br/>prepare · manage · commission")}
      <div class="hero solo">
        <span class="eyebrow">Built for mortgage advisors &amp; firm owners</span>
        <h1 class="sm">Warmer first meetings. <span class="hl">Less admin.</span> Commission, CRM &amp; exports in one hub.</h1>
        <p class="lead">Mortgage Hub prepares customers before you meet them, lets staff and introducers book on customers' behalf, and gives advisors a single workspace for contact, fact-finds, diary, CRM and commission — with owner-level finance reports and Excel/PDF exports.</p>
        <div class="chips">
          <span class="chip"><b>Book</b> customers for others</span>
          <span class="chip"><b>CRM</b> contact on every case</span>
          <span class="chip"><b>Commission</b> on fee submit</span>
        </div>
      </div>
      <div class="section tight">
        <div class="section-title sm"><span class="bar"></span>What your customers experience</div>
        <div class="benefits">
          ${benefit(mic, "Voice interview with Susan", "Avatar-led spoken fact-find — natural, friendly and thorough.")}
          ${benefit(chat, "Typed chat option", "Quiet alternative for customers who prefer not to speak aloud.")}
          ${benefit(calendar, "Instant booking + amend", "Self-serve diary with SMS &amp; email confirmation; advisors can amend slots.")}
          ${benefit(mail, "Post-booking choice", "Complete fact-find by voice or type, or confirm attendance only.")}
        </div>
      </div>
      <div class="section tight">
        <div class="section-title sm"><span class="bar"></span>Advisor toolkit</div>
        <div class="benefits three">
          ${benefit(phone, "Customer booking card", "Book or send SMS + email link — same flow as staff &amp; introducers.", true)}
          ${benefit(clipboard, "Tabbed customer profile", "Contact, Notes, Fact find, Journey &amp; CRM in one place.", true)}
          ${benefit(doc, "Pre-meeting summaries", "AI-written fact-find summaries before the first call.", true)}
          ${benefit(users, "Editable customer hub", "Customers update name, email, phone &amp; address — synced to CRM.", true)}
          ${benefit(bell, "Needs-attention highlights", "Call-backs and ready-to-review customers on your home screen.", true)}
          ${benefit(chart, "Journey milestones", "Appointment, ID confirmed and AIP — with customer SMS on confirm.", true)}
          ${benefit(pound, "My commission", "Personal commission statement with payout dates when fees are posted.", true)}
          ${benefit(shield, "Full audit history", "Fact-find events, SMS, appointments, notes and milestones in one timeline.", true)}
          ${benefit(link, "Introducer attribution", "Every referral link and portal booking credits the introducer.", true)}
        </div>
      </div>
      <div class="section tight">
        <div class="section-title sm"><span class="bar"></span>Owner &amp; admin controls</div>
        <div class="benefits">
          ${benefit(eye, "Advisor view tab", "Owner/supervisor opens any advisor's dashboard to see their workload.")}
          ${benefit(chart, "Finance &amp; commission mgmt", "Firm-wide ledger, commission history and introducer percentages.")}
          ${benefit(doc, "Excel &amp; PDF exports", "Download finance, commission and customer reports for your records.")}
          ${benefit(users, "Manage advisors &amp; introducers", "Invite, suspend, reinstate and configure RAF limits &amp; test accounts.")}
        </div>
      </div>
      ${footer({
        ctaHtml: `Modern mortgage tech<br/>for <span>advisors &amp; firms</span>`,
        ctaBtn: "Request a demo or join our team",
        note: "Live today: fact-find, booking, CRM, commission &amp; exports · See our advisor roadmap flyer for coming soon features.",
      })}
    </div>`,
  );
}

function advisorComingSoonFlyer() {
  const { upload, idcard, headset, card, doc, shield } = ICONS;
  return flyerShell(
    "Mortgage Hub — Advisor Roadmap (Coming Soon)",
    `<div class="page">
      ${header("Advisor roadmap<br/>coming soon")}
      <div class="coming-hero">
        <span class="soon-badge">Coming soon</span>
        <h1>More power for <span class="hl">advisors</span> — on the way.</h1>
        <p>We're building the next wave of Mortgage Hub tools to cut admin, speed up compliance, and keep every customer conversation in one place. Here's what's next for your firm.</p>
      </div>
      <div class="section tight">
        <div class="section-title sm"><span class="bar"></span>On the roadmap</div>
        <div class="roadmap">
          ${roadmapItem(
            upload,
            "Document upload &amp; AI scanning",
            "Customers upload payslips and bank statements. AI reads and extracts key figures — income, employer, balances — ready for your file, with less manual keying.",
          )}
          ${roadmapItem(
            idcard,
            "Integrated ID checks",
            "Built-in identity verification in the customer journey. Confirm ID digitally, track status on the case, and reduce back-and-forth before application.",
          )}
          ${roadmapItem(
            headset,
            "Integrated telephony",
            "Call customers from Mortgage Hub. Calls are recorded, transcribed by AI, and summarised on the customer timeline — so nothing gets lost between meetings.",
          )}
          ${roadmapItem(
            card,
            "Payment links",
            "Send secure payment links for fees and disbursements. Customers pay online; payments are tracked against the case and flow into your finance ledger.",
          )}
          ${roadmapItem(
            doc,
            "Smarter document workflows",
            "Auto-categorise uploads, flag missing items, and surface what the advisor still needs — all linked to journey milestones.",
            true,
          )}
          ${roadmapItem(
            shield,
            "Compliance-ready audit trail",
            "Every upload, ID check, call summary and payment logged in one timeline — ready for file reviews and regulator-ready records.",
            true,
          )}
        </div>
      </div>
      <div class="highlight">
        <div class="ico">${shield}</div>
        <div>
          <h3>Available today</h3>
          <p>AI fact-finds, customer booking, CRM, diary, commission, introducer portals and Excel/PDF exports are live now. The features above are in active development — register your interest to get early access.</p>
          <div class="pill-row">
            <span class="pill">Voice &amp; typed fact-find</span>
            <span class="pill">Booking &amp; CRM</span>
            <span class="pill">Commission mgmt</span>
            <span class="pill">Report exports</span>
          </div>
        </div>
      </div>
      ${footer({
        ctaHtml: `Want early access<br/>to <span>what's next?</span>`,
        ctaBtn: "Register your interest",
        note: "Advisor roadmap · Features subject to development schedule · Contact us for a demo of what's live today.",
      })}
    </div>`,
  );
}

function stripFlyerBody(html) {
  return html.replace(/<!doctype html>[\s\S]*?<body>/i, "").replace(/<\/body>[\s\S]*$/i, "");
}

function combinedPackHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Mortgage Hub — Marketing Pack (4 pages)</title>
<style>${FLYER_CSS}${PACK_CSS}</style>
</head>
<body class="pack">${stripFlyerBody(customerFlyer())}${stripFlyerBody(introducerFlyer())}${stripFlyerBody(advisorFlyer())}${stripFlyerBody(advisorComingSoonFlyer())}</body>
</html>`;
}

const FLYERS = [
  { name: "mortgage-hub-flyer", build: customerFlyer },
  { name: "mortgage-hub-introducer-flyer", build: introducerFlyer },
  { name: "mortgage-hub-advisor-flyer", build: advisorFlyer },
  { name: "mortgage-hub-advisor-coming-soon", build: advisorComingSoonFlyer },
];

async function renderPdf(browser, htmlPath) {
  const pdfPath = htmlPath.replace(/\.html$/, ".pdf");
  return renderHtmlToPdf(browser, htmlPath, pdfPath);
}

const browser = await launchBrowser();

try {
  for (const { name, build } of FLYERS) {
    const htmlPath = resolve(__dirname, `${name}.html`);
    const html = build();
    await writeFile(htmlPath, html, "utf8");
    console.log(`HTML written: ${htmlPath}`);
    const pdfPath = await renderPdf(browser, htmlPath);
    console.log(`PDF written:  ${pdfPath}`);
  }

  const packHtmlPath = resolve(__dirname, "mortgage-hub-marketing-pack.html");
  const packHtml = combinedPackHtml();
  await writeFile(packHtmlPath, packHtml, "utf8");
  console.log(`HTML written: ${packHtmlPath}`);
  const packPdfPath = await renderPdf(browser, packHtmlPath);
  console.log(`PDF written:  ${packPdfPath} (4-page marketing pack)`);
} finally {
  await browser.close();
}
