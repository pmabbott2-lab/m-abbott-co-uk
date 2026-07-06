export const FLYER_CSS = String.raw`
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
    width: 210mm; min-height: 297mm; margin: 0 auto;
    background: var(--cream); position: relative; overflow: hidden;
    display: flex; flex-direction: column;
  }
  .header {
    background: var(--navy); color: #fff;
    padding: 8mm 12mm 7mm;
    display: flex; align-items: center; justify-content: space-between;
    position: relative;
  }
  .header::after {
    content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 3px;
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
    font-size: 10px; letter-spacing: 2px; text-transform: uppercase;
    color: rgba(255,255,255,0.7); text-align: right; line-height: 1.5;
  }
  .hero {
    padding: 8mm 12mm 5mm;
    display: grid; grid-template-columns: 1fr 44mm; gap: 8mm; align-items: center;
  }
  .hero.solo { grid-template-columns: 1fr; }
  .eyebrow {
    display: inline-block; font-size: 9px; font-weight: 700; letter-spacing: 2px;
    text-transform: uppercase; color: var(--accent-deep);
    background: var(--accent-soft); padding: 4px 10px; border-radius: 999px; margin-bottom: 8px;
  }
  .hero h1 {
    font-size: 26px; line-height: 1.12; letter-spacing: -0.4px;
    color: var(--navy); font-weight: 800;
  }
  .hero h1.sm { font-size: 24px; }
  .hero h1 .hl { color: var(--accent-deep); }
  .hero p.lead {
    margin-top: 8px; font-size: 11.5px; line-height: 1.5; color: var(--muted); max-width: 108mm;
  }
  .chips { margin-top: 9px; display: flex; flex-wrap: wrap; gap: 5px; }
  .chip {
    font-size: 9.5px; font-weight: 600; color: var(--navy);
    background: #fff; border: 1px solid var(--line);
    padding: 4px 9px; border-radius: 999px;
  }
  .chip b { color: var(--accent-deep); }
  .avatar-card {
    background: #fff; border: 1px solid var(--line); border-radius: 16px;
    padding: 9px; text-align: center;
    box-shadow: 0 10px 24px rgba(35,44,76,0.10);
  }
  .avatar-card .photo {
    width: 100%; aspect-ratio: 1 / 1; border-radius: 12px;
    object-fit: cover; object-position: 50% 18%; display: block;
  }
  .avatar-card .cap {
    margin-top: 7px; font-size: 9px; color: var(--muted); line-height: 1.4;
  }
  .avatar-card .cap b { color: var(--navy); }
  .section { padding: 0 12mm; }
  .section + .section { margin-top: 5mm; }
  .section.tight + .section { margin-top: 4mm; }
  .section-title {
    font-size: 13px; font-weight: 800; color: var(--navy);
    display: flex; align-items: center; gap: 8px; margin-bottom: 6px;
  }
  .section-title.sm { font-size: 12px; margin-bottom: 5px; }
  .section-title .bar {
    width: 16px; height: 3px; border-radius: 2px; background: var(--accent);
  }
  .section-sub {
    font-size: 9.5px; color: var(--muted); margin: -4px 0 6px 24px; line-height: 1.45;
  }
  .ways { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .way {
    background: #fff; border: 1px solid var(--line); border-radius: 12px;
    padding: 9px 10px;
  }
  .way .ico {
    width: 26px; height: 26px; border-radius: 8px;
    background: var(--navy); color: #fff;
    display: flex; align-items: center; justify-content: center; margin-bottom: 6px;
  }
  .way .ico svg { width: 14px; height: 14px; }
  .way h3 { font-size: 11px; color: var(--navy); font-weight: 700; }
  .way p { font-size: 9px; line-height: 1.45; color: var(--muted); margin-top: 2px; }
  .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .step {
    background: var(--navy); color: #fff; border-radius: 12px; padding: 9px 10px;
  }
  .step .num {
    font-size: 20px; font-weight: 800; color: var(--accent); line-height: 1; margin-bottom: 4px;
  }
  .step h4 { font-size: 10.5px; font-weight: 700; }
  .step p { font-size: 9px; line-height: 1.45; color: rgba(255,255,255,0.78); margin-top: 2px; }
  .benefits { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
  .benefits.three { grid-template-columns: repeat(3, 1fr); }
  .benefit {
    background: #fff; border: 1px solid var(--line); border-radius: 11px;
    padding: 8px 9px; display: flex; gap: 8px; align-items: flex-start;
  }
  .benefit .ico {
    flex: 0 0 auto; width: 22px; height: 22px; border-radius: 6px;
    background: var(--accent-soft); color: var(--accent-deep);
    display: flex; align-items: center; justify-content: center;
  }
  .benefit .ico.navy { background: var(--navy); color: #fff; }
  .benefit .ico svg { width: 13px; height: 13px; }
  .benefit h4 { font-size: 10.5px; color: var(--navy); font-weight: 700; }
  .benefit p { font-size: 9px; line-height: 1.4; color: var(--muted); margin-top: 2px; }
  .highlight {
    margin: 4mm 12mm 0;
    background: linear-gradient(120deg, var(--accent-soft), #fff);
    border: 1px solid var(--accent); border-radius: 14px;
    padding: 10px 14px; display: flex; align-items: center; gap: 12px;
  }
  .highlight .ico {
    flex: 0 0 auto; width: 36px; height: 36px; border-radius: 10px;
    background: var(--accent); color: #fff;
    display: flex; align-items: center; justify-content: center;
  }
  .highlight .ico svg { width: 20px; height: 20px; }
  .highlight h3 { font-size: 12px; color: var(--navy); font-weight: 800; }
  .highlight p { font-size: 9.5px; color: var(--primary); line-height: 1.45; margin-top: 2px; }
  .pill-row { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 4px; }
  .pill {
    font-size: 8.5px; font-weight: 600; color: var(--navy);
    background: #fff; border: 1px solid var(--line); padding: 3px 8px; border-radius: 999px;
  }
  .footer {
    margin-top: auto; background: var(--navy-deep); color: #fff;
    padding: 9mm 12mm 8mm; position: relative;
  }
  .footer::before {
    content: ""; position: absolute; top: 0; left: 0; right: 0; height: 3px;
    background: linear-gradient(90deg, var(--accent-deep), var(--accent));
  }
  .cta-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .cta-row h2 { font-size: 17px; font-weight: 800; line-height: 1.2; }
  .cta-row h2 span { color: var(--accent); }
  .cta-btn {
    flex: 0 0 auto;
    background: linear-gradient(145deg, var(--accent), var(--accent-deep));
    color: var(--navy-deep); font-weight: 800; font-size: 11px;
    padding: 10px 16px; border-radius: 10px; white-space: nowrap;
  }
  .contact {
    margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.14);
    display: flex; flex-wrap: wrap; gap: 5px 18px;
    font-size: 9px; color: rgba(255,255,255,0.78);
  }
  .contact b { color: #fff; font-weight: 700; }
  .roles { font-size: 8.5px; color: rgba(255,255,255,0.55); margin-top: 6px; line-height: 1.45; }
  .coming-hero {
    padding: 10mm 12mm 4mm; text-align: center;
  }
  .coming-hero h1 { font-size: 28px; color: var(--navy); font-weight: 800; line-height: 1.1; }
  .coming-hero h1 .hl { color: var(--accent-deep); }
  .coming-hero p { margin-top: 8px; font-size: 11px; color: var(--muted); line-height: 1.5; max-width: 150mm; margin-left: auto; margin-right: auto; }
  .soon-badge {
    display: inline-block; font-size: 9px; font-weight: 800; letter-spacing: 2px;
    text-transform: uppercase; color: var(--navy-deep);
    background: linear-gradient(145deg, var(--accent), var(--accent-deep));
    padding: 5px 14px; border-radius: 999px; margin-bottom: 10px;
  }
  .roadmap { display: grid; grid-template-columns: repeat(2, 1fr); gap: 7px; padding: 0 12mm; }
  .roadmap-item {
    background: #fff; border: 1px dashed var(--accent); border-radius: 14px;
    padding: 10px 11px; position: relative;
  }
  .roadmap-item .tag {
    position: absolute; top: 8px; right: 8px;
    font-size: 7px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;
    color: var(--accent-deep); background: var(--accent-soft);
    padding: 2px 7px; border-radius: 999px;
  }
  .roadmap-item .ico {
    width: 30px; height: 30px; border-radius: 9px;
    background: var(--navy); color: #fff;
    display: flex; align-items: center; justify-content: center; margin-bottom: 7px;
  }
  .roadmap-item .ico svg { width: 16px; height: 16px; }
  .roadmap-item h3 { font-size: 11.5px; color: var(--navy); font-weight: 800; padding-right: 42px; }
  .roadmap-item p { font-size: 9px; line-height: 1.45; color: var(--muted); margin-top: 3px; }
  .roadmap-wide { grid-column: 1 / -1; }
`;

export const ICONS = {
  mic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`,
  chat: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="m9 16 2 2 4-4"/></svg>`,
  doc: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>`,
  sms: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>`,
  gift: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7Z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7Z"/></svg>`,
  link: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  users: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  chart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>`,
  phone: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
  star: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  clipboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>`,
  bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
  pound: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12"/><path d="M6 8h12"/><path d="M11 3v18"/><path d="M9 13h4a3 3 0 0 0 0-6H9"/></svg>`,
  mail: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`,
  eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`,
  upload: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  idcard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="12" r="2"/><path d="M14 10h4"/><path d="M14 14h4"/></svg>`,
  headset: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5a9 9 0 0 1 18 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/></svg>`,
  card: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`,
};

export const CONTACT = {
  web: "m-abbott.co.uk",
  email: "hello@m-abbott.co.uk",
  phone: "01234 567 890",
};

export function flyerShell(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>${FLYER_CSS}</style>
</head>
<body>${body}</body>
</html>`;
}

export function header(tag) {
  return `<div class="header">
    <div class="brand">
      <div class="mark">M</div>
      <div class="name">Mortgage&nbsp;Hub</div>
    </div>
    <div class="tag">${tag}</div>
  </div>`;
}

export function footer({ ctaHtml, ctaBtn, note }) {
  return `<div class="footer">
    <div class="cta-row">
      <h2>${ctaHtml}</h2>
      <div class="cta-btn">${ctaBtn}</div>
    </div>
    <div class="contact">
      <span><b>Web:</b> ${CONTACT.web}</span>
      <span><b>Email:</b> ${CONTACT.email}</span>
      <span><b>Phone:</b> ${CONTACT.phone}</span>
    </div>
    ${note ? `<div class="roles">${note}</div>` : ""}
  </div>`;
}

export function customerWays() {
  const { mic, chat, calendar } = ICONS;
  return `<div class="ways">
    <div class="way"><div class="ico">${mic}</div><h3>Spoken fact-find</h3><p>Susan, our avatar-led voice assistant, guides customers question by question.</p></div>
    <div class="way"><div class="ico">${chat}</div><h3>Type fact-find</h3><p>Same guided journey in a quiet typed chat — pause and resume any time.</p></div>
    <div class="way"><div class="ico">${calendar}</div><h3>Book or confirm</h3><p>Pick an advisor slot — then complete the fact-find, or confirm attendance only.</p></div>
  </div>`;
}

export function customerSteps() {
  return `<div class="steps">
    <div class="step"><div class="num">1</div><h4>Sign in &amp; choose</h4><p>Spoken interview, typed chat, or book an appointment straight away.</p></div>
    <div class="step"><div class="num">2</div><h4>Confirm by text &amp; email</h4><p>Booking confirmations arrive by SMS and email with clear next steps.</p></div>
    <div class="step"><div class="num">3</div><h4>Meet prepared</h4><p>Advisor receives an AI summary — the first meeting starts with context.</p></div>
  </div>`;
}

export function avatarCard(avatarDataUri) {
  return `<div class="avatar-card">
    <img class="photo" src="${avatarDataUri}" alt="Susan, your Mortgage Hub guide" />
    <div class="cap"><b>Meet Susan</b><br/>AI voice &amp; chat guide for every customer.</div>
  </div>`;
}

export function benefit(icon, title, text, navy = false) {
  return `<div class="benefit">
    <div class="ico${navy ? " navy" : ""}">${icon}</div>
    <div><h4>${title}</h4><p>${text}</p></div>
  </div>`;
}

export function roadmapItem(icon, title, text, wide = false) {
  return `<div class="roadmap-item${wide ? " roadmap-wide" : ""}">
    <span class="tag">Coming soon</span>
    <div class="ico">${icon}</div>
    <h3>${title}</h3>
    <p>${text}</p>
  </div>`;
}
