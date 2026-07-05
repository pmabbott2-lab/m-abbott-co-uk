// Builds Mortgage Hub marketing flyers (customer, introducer, advisor).
// Run: node marketing/build-flyers.mjs

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import puppeteer from "puppeteer";
import {
  ICONS,
  avatarCard,
  benefit,
  customerSteps,
  customerWays,
  flyerShell,
  footer,
  header,
} from "./flyer-shared.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const avatarDataUri = `data:image/png;base64,${(await readFile(resolve(repoRoot, "src/assets/susan.png"))).toString("base64")}`;

function customerFlyer() {
  const { doc, sms, lock, shield, gift } = ICONS;
  return flyerShell(
    "Mortgage Hub — Customer Flyer",
    `<div class="page">
      ${header("AI-guided mortgage fact-find<br/>&amp; appointment booking")}
      <div class="hero">
        <div>
          <span class="eyebrow">Your mortgage journey, made simple</span>
          <h1>Get your mortgage advisor up to speed — <span class="hl">before you even meet.</span></h1>
          <p class="lead">Mortgage Hub guides customers through the questions a mortgage advisor needs — their way, at their own pace. Talk to Susan, type answers in a quiet chat, or book a call. We hand advisors a clean summary so the first conversation is faster and easier.</p>
          <div class="chips">
            <span class="chip"><b>Spoken</b> voice interview</span>
            <span class="chip"><b>Typed</b> chat assistant</span>
            <span class="chip"><b>Book</b> a call instantly</span>
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
          ${benefit(sms, "SMS confirmations", "Text when the interview is complete and when an appointment is booked.")}
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
  const { link, users, calendar, sms, chart, phone, clipboard, doc } = ICONS;
  return flyerShell(
    "Mortgage Hub — Introducer Partner Flyer",
    `<div class="page">
      ${header("Introducer partner programme<br/>refer · book · track")}
      <div class="hero">
        <div>
          <span class="eyebrow">Partner with Mortgage Hub</span>
          <h1>Refer customers with confidence — <span class="hl">they get the full experience, you get visibility.</span></h1>
          <p class="lead">Share your personal introducer link or book on a customer's behalf. Every referral is attributed to you, and you can track journey stage, advisor allocation and last contact — without seeing sensitive fact-find detail.</p>
          <div class="chips">
            <span class="chip"><b>Shareable</b> referral link</span>
            <span class="chip"><b>Book</b> for customers</span>
            <span class="chip"><b>Track</b> every referral</span>
          </div>
        </div>
        ${avatarCard(avatarDataUri)}
      </div>
      <div class="section tight">
        <div class="section-title sm"><span class="bar"></span>What your customers get</div>
        <p class="section-sub">The same guided Mortgage Hub experience — voice interview with Susan, typed chat, or instant booking.</p>
        ${customerWays()}
      </div>
      <div class="section tight">
        <div class="section-title sm"><span class="bar"></span>Your introducer portal</div>
        <div class="benefits three">
          ${benefit(link, "Shareable referral link", "A unique link credits every self-serve customer to you automatically.", true)}
          ${benefit(users, "Company code", "4-digit code lets colleagues join the same introducer company.", true)}
          ${benefit(calendar, "Book for customers", "Log a lead and open the advisor diary — referral recorded instantly.", true)}
          ${benefit(sms, "Text booking links", "SMS a customer a personalised link to pick a time.", true)}
          ${benefit(chart, "Referral dashboard", "See name, journey stage, lead source, advisor, days at stage &amp; last contact.", true)}
          ${benefit(phone, "Manual lead logging", "Capture name, phone and notes when you speak to someone directly.", true)}
        </div>
      </div>
      <div class="section tight">
        <div class="section-title sm"><span class="bar"></span>How it works for you</div>
        <div class="steps">
          <div class="step"><div class="num">1</div><h4>Get your portal</h4><p>We set you up with a company profile, shareable link and optional company code.</p></div>
          <div class="step"><div class="num">2</div><h4>Share or book</h4><p>Send your link, text a booking invite, or book an appointment yourself.</p></div>
          <div class="step"><div class="num">3</div><h4>Track progress</h4><p>Watch each referral move from not started to appointment, ID and AIP milestones.</p></div>
        </div>
      </div>
      <div class="highlight">
        <div class="ico">${clipboard}</div>
        <div>
          <h3>Professional, privacy-conscious reporting</h3>
          <p>Introducers see journey stage and contact dates — not full fact-find answers. Customers still get Susan, SMS confirmations and a polished first impression that reflects well on your brand.</p>
          <div class="pill-row">
            <span class="pill">Self-serve referrals</span>
            <span class="pill">Telephone leads</span>
            <span class="pill">Portal bookings</span>
            <span class="pill">Attributed to you</span>
          </div>
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
  const { mic, chat, calendar, doc, sms, bell, clipboard, chart, users, star, link, shield, phone } = ICONS;
  return flyerShell(
    "Mortgage Hub — Advisor Recruitment Flyer",
    `<div class="page">
      ${header("Advisor recruitment<br/>why join mortgage hub")}
      <div class="hero solo">
        <span class="eyebrow">Why join us</span>
        <h1 class="sm">Warmer first meetings. <span class="hl">Less admin.</span> A modern toolkit built for mortgage advisors.</h1>
        <p class="lead">Mortgage Hub prepares customers before you meet them, routes introducer referrals fairly, and gives you a single place to manage contact, fact-finds, notes and journey milestones — so you spend time advising, not chasing information.</p>
        <div class="chips">
          <span class="chip"><b>AI fact-finds</b> before you call</span>
          <span class="chip"><b>Introducer</b> leads tracked</span>
          <span class="chip"><b>Full</b> customer workspace</span>
        </div>
      </div>
      <div class="section tight">
        <div class="section-title sm"><span class="bar"></span>What your customers experience</div>
        <div class="benefits">
          ${benefit(mic, "Voice interview with Susan", "Avatar-led spoken fact-find — natural, friendly and thorough.")}
          ${benefit(chat, "Typed chat option", "Quiet alternative for customers who prefer not to speak aloud.")}
          ${benefit(calendar, "Instant booking", "Self-serve diary with SMS confirmation and call-back slots.")}
          ${benefit(sms, "SMS through the journey", "Completion texts, appointment confirmations and pick-up links.")}
        </div>
      </div>
      <div class="section tight">
        <div class="section-title sm"><span class="bar"></span>What introducers bring you</div>
        <p class="section-sub">Qualified referrals arrive with source attribution, journey tracking and optional portal booking — already guided through Mortgage Hub.</p>
        <div class="benefits">
          ${benefit(link, "Attributed referrals", "Every introducer link and portal booking credits the referrer.")}
          ${benefit(users, "Company introducer teams", "Shared company codes for multi-adviser introducer firms.")}
        </div>
      </div>
      <div class="section tight">
        <div class="section-title sm"><span class="bar"></span>Your advisor toolkit</div>
        <div class="benefits three">
          ${benefit(clipboard, "Tabbed customer profile", "Contact, Notes &amp; history, Fact find and Customer journey in one place.", true)}
          ${benefit(doc, "Pre-meeting summaries", "AI-written fact-find summaries and structured answers before the first call.", true)}
          ${benefit(calendar, "Appointments &amp; call-backs", "See booked slots, call-back windows and log contact attempts.", true)}
          ${benefit(bell, "Needs-attention highlights", "Call-backs and ready-to-review customers surface on your home screen.", true)}
          ${benefit(chart, "Journey milestones", "Track appointment seen, ID confirmed and AIP completed — with customer SMS on confirm.", true)}
          ${benefit(shield, "Full audit history", "Fact-find events, SMS, appointments, callbacks, notes and milestones in one timeline.", true)}
        </div>
      </div>
      <div class="section tight">
        <div class="section-title sm"><span class="bar"></span>Why advisors join Mortgage Hub</div>
        <div class="benefits">
          ${benefit(star, "Better-prepared customers", "First conversations start with context, not basic fact-finding.")}
          ${benefit(phone, "Less chasing, more advising", "Contact tracking, next-contact dates and call-back management built in.")}
          ${benefit(users, "Fair allocation", "Advisor codes and admin allocation — up to three advisors per case.")}
          ${benefit(link, "Refer-a-friend programme", "Customers can refer friends; admin tracks bonuses and uptake.")}
        </div>
      </div>
      ${footer({
        ctaHtml: `Join a team that puts<br/><span>advisors first</span>`,
        ctaBtn: "Apply to join our advisor team",
        note: "Recruitment flyer · Full platform access for advisors &amp; admin · Secure sign-in with authenticator app.",
      })}
    </div>`,
  );
}

const FLYERS = [
  { name: "mortgage-hub-flyer", build: customerFlyer },
  { name: "mortgage-hub-introducer-flyer", build: introducerFlyer },
  { name: "mortgage-hub-advisor-flyer", build: advisorFlyer },
];

async function renderPdf(browser, htmlPath) {
  const page = await browser.newPage();
  await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle0" });
  const pdfPath = htmlPath.replace(/\.html$/, ".pdf");
  await page.pdf({
    path: pdfPath,
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
  });
  await page.close();
  return pdfPath;
}

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

try {
  for (const { name, build } of FLYERS) {
    const htmlPath = resolve(__dirname, `${name}.html`);
    const html = build();
    await writeFile(htmlPath, html, "utf8");
    console.log(`HTML written: ${htmlPath}`);
    const pdfPath = await renderPdf(browser, htmlPath);
    console.log(`PDF written:  ${pdfPath}`);
  }
} finally {
  await browser.close();
}
