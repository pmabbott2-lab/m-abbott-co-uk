// Builds the Mortgage Hub marketing flyer.
//
// 1. Reads the brand avatar (src/assets/susan.png), embeds it as a base64 data
//    URI so the HTML is fully self-contained.
// 2. Writes marketing/mortgage-hub-flyer.html (the editable source).
// 3. Renders it to marketing/mortgage-hub-flyer.pdf (A4, print backgrounds) via
//    Puppeteer's headless Chromium.
//
// Run:  node marketing/build-flyer.mjs

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import puppeteer from "puppeteer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const avatarPath = resolve(repoRoot, "src/assets/susan.png");
const htmlOut = resolve(__dirname, "mortgage-hub-flyer.html");
const pdfOut = resolve(__dirname, "mortgage-hub-flyer.pdf");

const avatarB64 = (await readFile(avatarPath)).toString("base64");
const avatarDataUri = `data:image/png;base64,${avatarB64}`;

const html = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Mortgage Hub — Marketing Flyer</title>
<style>
  /* ---- Brand palette (derived from the app's theme tokens in src/styles.css) ----
     navy   = primary  oklch(0.28 0.06 260)
     amber  = accent   oklch(0.78 0.16 55)
     cream  = bg        oklch(0.985 0.013 85) */
  :root {
    --navy: #232c4c;
    --navy-deep: #1a2238;
    --primary: #2b3658;
    --accent: #e09a3b;
    --accent-deep: #c47e26;
    --accent-soft: #f7ead2;
    --cream: #fbfaf4;
    --ink: #1f2540;
    --muted: #6a7184;
    --line: #e7e3d8;
    --white: #ffffff;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  html, body {
    font-family: "Helvetica Neue", Helvetica, Arial, "Segoe UI", sans-serif;
    color: var(--ink);
    background: #d9d7cf;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }

  @page { size: A4; margin: 0; }

  .page {
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto;
    background: var(--cream);
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  /* ---------------- Header ---------------- */
  .header {
    background: var(--navy);
    color: #fff;
    padding: 9mm 12mm 8mm;
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: relative;
  }
  .header::after {
    content: "";
    position: absolute;
    left: 0; right: 0; bottom: 0;
    height: 3px;
    background: linear-gradient(90deg, var(--accent), var(--accent-deep));
  }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand .mark {
    width: 34px; height: 34px; border-radius: 50%;
    background: linear-gradient(145deg, var(--accent), var(--accent-deep));
    display: flex; align-items: center; justify-content: center;
    color: var(--navy-deep); font-weight: 800; font-size: 17px;
    box-shadow: inset 0 0 0 3px rgba(255,255,255,0.12);
  }
  .brand .name { font-size: 21px; font-weight: 700; letter-spacing: 0.2px; }
  .header .tag {
    font-size: 10.5px; letter-spacing: 2.2px; text-transform: uppercase;
    color: rgba(255,255,255,0.7); text-align: right; line-height: 1.5;
  }

  /* ---------------- Hero ---------------- */
  .hero {
    padding: 9mm 12mm 6mm;
    display: grid;
    grid-template-columns: 1fr 47mm;
    gap: 9mm;
    align-items: center;
  }
  .eyebrow {
    display: inline-block;
    font-size: 9.5px; font-weight: 700; letter-spacing: 2px;
    text-transform: uppercase; color: var(--accent-deep);
    background: var(--accent-soft);
    padding: 4px 10px; border-radius: 999px; margin-bottom: 10px;
  }
  .hero h1 {
    font-size: 29px; line-height: 1.12; letter-spacing: -0.4px;
    color: var(--navy); font-weight: 800;
  }
  .hero h1 .hl { color: var(--accent-deep); }
  .hero p.lead {
    margin-top: 9px; font-size: 12px; line-height: 1.55; color: var(--muted);
    max-width: 105mm;
  }
  .chips { margin-top: 11px; display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    font-size: 10px; font-weight: 600; color: var(--navy);
    background: #fff; border: 1px solid var(--line);
    padding: 5px 10px; border-radius: 999px;
  }
  .chip b { color: var(--accent-deep); }

  .avatar-card {
    background: #fff; border: 1px solid var(--line); border-radius: 18px;
    padding: 10px; text-align: center;
    box-shadow: 0 10px 24px rgba(35,44,76,0.10);
  }
  .avatar-card .photo {
    width: 100%; aspect-ratio: 1 / 1; border-radius: 14px;
    object-fit: cover; object-position: 50% 18%; display: block;
  }
  .avatar-card .cap {
    margin-top: 8px; font-size: 9.5px; color: var(--muted); line-height: 1.4;
  }
  .avatar-card .cap b { color: var(--navy); }

  /* ---------------- Section scaffolding ---------------- */
  .section { padding: 0 12mm; }
  .section + .section { margin-top: 6mm; }
  .section-title {
    font-size: 14px; font-weight: 800; color: var(--navy);
    display: flex; align-items: center; gap: 8px; margin-bottom: 7px;
  }
  .section-title .bar {
    width: 18px; height: 3px; border-radius: 2px; background: var(--accent);
  }

  /* ---------------- Three ways ---------------- */
  .ways { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }
  .way {
    background: #fff; border: 1px solid var(--line); border-radius: 14px;
    padding: 11px 11px 12px;
  }
  .way .ico {
    width: 30px; height: 30px; border-radius: 9px;
    background: var(--navy); color: #fff;
    display: flex; align-items: center; justify-content: center;
    margin-bottom: 8px;
  }
  .way .ico svg { width: 16px; height: 16px; }
  .way h3 { font-size: 12px; color: var(--navy); font-weight: 700; }
  .way p { font-size: 10px; line-height: 1.5; color: var(--muted); margin-top: 3px; }

  /* ---------------- How it works ---------------- */
  .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }
  .step {
    background: var(--navy); color: #fff; border-radius: 14px;
    padding: 11px 12px; position: relative; overflow: hidden;
  }
  .step .num {
    font-size: 22px; font-weight: 800; color: var(--accent);
    line-height: 1; margin-bottom: 5px;
  }
  .step h4 { font-size: 11.5px; font-weight: 700; }
  .step p { font-size: 9.5px; line-height: 1.5; color: rgba(255,255,255,0.78); margin-top: 3px; }

  /* ---------------- Benefits ---------------- */
  .benefits { display: grid; grid-template-columns: repeat(2, 1fr); gap: 7px; }
  .benefit {
    background: #fff; border: 1px solid var(--line); border-radius: 12px;
    padding: 10px 11px; display: flex; gap: 9px; align-items: flex-start;
  }
  .benefit .ico {
    flex: 0 0 auto; width: 24px; height: 24px; border-radius: 7px;
    background: var(--accent-soft); color: var(--accent-deep);
    display: flex; align-items: center; justify-content: center;
  }
  .benefit .ico svg { width: 14px; height: 14px; }
  .benefit h4 { font-size: 11px; color: var(--navy); font-weight: 700; }
  .benefit p { font-size: 9.5px; line-height: 1.45; color: var(--muted); margin-top: 2px; }

  /* ---------------- Refer a friend ---------------- */
  .raf {
    margin: 6mm 12mm 0;
    background: linear-gradient(120deg, var(--accent-soft), #fff);
    border: 1px solid var(--accent); border-radius: 16px;
    padding: 12px 16px; display: flex; align-items: center; gap: 14px;
  }
  .raf .gift {
    flex: 0 0 auto; width: 40px; height: 40px; border-radius: 11px;
    background: var(--accent); color: #fff;
    display: flex; align-items: center; justify-content: center;
  }
  .raf .gift svg { width: 22px; height: 22px; }
  .raf h3 { font-size: 13px; color: var(--navy); font-weight: 800; }
  .raf p { font-size: 10px; color: var(--primary); line-height: 1.5; margin-top: 2px; }

  /* ---------------- Footer / CTA ---------------- */
  .footer {
    margin-top: auto;
    background: var(--navy-deep); color: #fff;
    padding: 10mm 12mm 9mm; position: relative;
  }
  .footer::before {
    content: ""; position: absolute; top: 0; left: 0; right: 0; height: 3px;
    background: linear-gradient(90deg, var(--accent-deep), var(--accent));
  }
  .cta-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
  .cta-row h2 { font-size: 18px; font-weight: 800; line-height: 1.2; }
  .cta-row h2 span { color: var(--accent); }
  .cta-btn {
    flex: 0 0 auto;
    background: linear-gradient(145deg, var(--accent), var(--accent-deep));
    color: var(--navy-deep); font-weight: 800; font-size: 12px;
    padding: 11px 18px; border-radius: 10px; white-space: nowrap;
  }
  .contact {
    margin-top: 9px; padding-top: 9px; border-top: 1px solid rgba(255,255,255,0.14);
    display: flex; flex-wrap: wrap; gap: 5px 20px;
    font-size: 9.5px; color: rgba(255,255,255,0.78);
  }
  .contact b { color: #fff; font-weight: 700; }
  .roles { font-size: 9px; color: rgba(255,255,255,0.55); margin-top: 7px; }
</style>
</head>
<body>
  <div class="page">

    <!-- Header -->
    <div class="header">
      <div class="brand">
        <div class="mark">M</div>
        <div class="name">Mortgage&nbsp;Hub</div>
      </div>
      <div class="tag">AI-guided mortgage fact-find<br/>&amp; appointment booking</div>
    </div>

    <!-- Hero -->
    <div class="hero">
      <div>
        <span class="eyebrow">Your mortgage journey, made simple</span>
        <h1>Get your mortgage advisor up to speed — <span class="hl">before you even meet.</span></h1>
        <p class="lead">
          Mortgage Hub guides you through the questions a mortgage advisor needs — your way, at your own pace.
          Talk to Susan, our friendly AI voice assistant, type your answers in a quiet chat, or jump straight to
          booking a call. We hand your advisor a clean summary, so your first conversation is faster and easier.
        </p>
        <div class="chips">
          <span class="chip"><b>Spoken</b> voice interview</span>
          <span class="chip"><b>Typed</b> chat assistant</span>
          <span class="chip"><b>Book</b> a call instantly</span>
        </div>
      </div>
      <div class="avatar-card">
        <img class="photo" src="${avatarDataUri}" alt="Susan, your Mortgage Hub interview guide" />
        <div class="cap"><b>Meet Susan</b><br/>Your AI guide — she speaks each question aloud, or chats by text.</div>
      </div>
    </div>

    <!-- Three ways to start -->
    <div class="section">
      <div class="section-title"><span class="bar"></span>Three ways to get started</div>
      <div class="ways">
        <div class="way">
          <div class="ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
          </div>
          <h3>Spoken interview</h3>
          <p>Talk it through with Susan, our avatar-led voice assistant. She speaks each question aloud and listens to your replies.</p>
        </div>
        <div class="way">
          <div class="ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/></svg>
          </div>
          <h3>Text &amp; chat assistant</h3>
          <p>Prefer to type? Answer the same questions in a quiet, typed chat — no microphone needed, pick up any time.</p>
        </div>
        <div class="way">
          <div class="ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="m9 16 2 2 4-4"/></svg>
          </div>
          <h3>Book an appointment</h3>
          <p>Short on time? Skip ahead and pick a slot to speak with a mortgage advisor — booking confirmed by text.</p>
        </div>
      </div>
    </div>

    <!-- How it works -->
    <div class="section">
      <div class="section-title"><span class="bar"></span>How it works</div>
      <div class="steps">
        <div class="step">
          <div class="num">1</div>
          <h4>Start your guided interview</h4>
          <p>Sign in and answer simple questions about you, your job and the property — spoken or typed.</p>
        </div>
        <div class="step">
          <div class="num">2</div>
          <h4>Get your fact-find summary</h4>
          <p>We automatically generate a clean summary and text you a link the moment you finish.</p>
        </div>
        <div class="step">
          <div class="num">3</div>
          <h4>Book &amp; meet your advisor</h4>
          <p>Choose a time that suits you. Your advisor arrives already up to speed on your situation.</p>
        </div>
      </div>
    </div>

    <!-- Benefits -->
    <div class="section">
      <div class="section-title"><span class="bar"></span>Why customers love it</div>
      <div class="benefits">
        <div class="benefit">
          <div class="ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>
          </div>
          <div>
            <h4>Automatic fact-find summary</h4>
            <p>An AI-written summary goes straight to your advisor — no repeating yourself.</p>
          </div>
        </div>
        <div class="benefit">
          <div class="ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/></svg>
          </div>
          <div>
            <h4>SMS confirmations</h4>
            <p>Get a text when your interview is complete and when your appointment is booked.</p>
          </div>
        </div>
        <div class="benefit">
          <div class="ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          </div>
          <div>
            <h4>Flexible, secure sign-in</h4>
            <p>Sign in with email &amp; password, Google, or a one-time SMS code — your choice.</p>
          </div>
        </div>
        <div class="benefit">
          <div class="ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>
          </div>
          <div>
            <h4>Free to start &amp; private</h4>
            <p>Begin in minutes. Your details stay private until you're ready to share them.</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Refer a friend -->
    <div class="raf">
      <div class="gift">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7Z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7Z"/></svg>
      </div>
      <div>
        <h3>Refer a friend</h3>
        <p>Love your experience? Share your personal Refer-a-Friend link. Your friend gets the same friendly,
           guided start — and you're credited every time someone you invite joins.</p>
      </div>
    </div>

    <!-- Footer / CTA -->
    <div class="footer">
      <div class="cta-row">
        <h2>Ready to make your mortgage<br/>journey <span>simpler?</span></h2>
        <div class="cta-btn">Get started — sign in &amp; choose your way</div>
      </div>
      <div class="contact">
        <span><b>Web:</b> www.mortgagehub.example</span>
        <span><b>Email:</b> hello@mortgagehub.example</span>
        <span><b>Phone:</b> 01234 567 890</span>
      </div>
      <div class="roles">
        For customers, advisors &amp; introducers · Introducer &amp; advisor partner programmes available — ask us about referral links and team access.
      </div>
    </div>

  </div>
</body>
</html>`;

await writeFile(htmlOut, html, "utf8");
console.log(`HTML written: ${htmlOut}`);

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
try {
  const page = await browser.newPage();
  await page.goto(`file://${htmlOut}`, { waitUntil: "networkidle0" });
  await page.pdf({
    path: pdfOut,
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
  });
  console.log(`PDF written:  ${pdfOut}`);
} finally {
  await browser.close();
}
