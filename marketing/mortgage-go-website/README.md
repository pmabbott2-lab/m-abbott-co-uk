# Mortgage Go — brokerage website mockup

Static HTML mockup for **Mortgage Go** (customer-facing brokerage brand), separate from the **Mortgage Hub** app.

## Open locally

```bash
open marketing/mortgage-go-website/index.html
```

Or serve with any static server:

```bash
npx serve marketing/mortgage-go-website
```

## Pages

| Page | File | Audience |
|------|------|----------|
| Home | `index.html` | Customers — fact-find, voice/chat, booking |
| Partnerships | `partnerships.html` | Introducers — referral links, portal, tracking |
| Careers | `careers.html` | Advisor recruitment |
| Disclosures | `disclosures.html` | FCA initial disclosure structure (template) |

## Brand

- Logo: `assets/mortgage-go-logo.png`
- Colours: navy `#1a2f4f`, green `#3d9e47` (from logo)
- Tagline: *Get ready. Get set. Mortgage Go.*

## FCA compliance — important

**This mockup is a design structure, not approved regulated copy.**

Before go-live you must (with your compliance consultant):

1. **MCOB 4.4A** — Publish initial disclosure: service type, product range (whole of market vs limited panel), fees/commission, regulatory status, repossession warning.
2. **On-screen disclosure** — Required information must appear clearly on the customer journey screens, not only behind a PDF link.
3. **FRN & legal entity** — Replace all `[bracketed]` placeholders (FRN, company name, registered office).
4. **IDD / KFI** — Issue firm-approved Initial Disclosure Document in a durable medium before recommendation.
5. **Consumer Duty** — Fair, clear, not misleading; balance claims with risks.
6. **Complaints** — Published procedure + Financial Ombudsman details.
7. **GDPR** — Privacy policy, cookie consent, data retention for fact-finds.
8. **Introducer agreements** — Written terms for referral fees (partnerships page is marketing only).
9. **Record-keeping** — Archive website versions (FCA may request evidence of what customers saw).

## Linking to Mortgage Hub app

"Get started" buttons point to `../../auth` (relative to repo). Update to your production URL when deployed.

## Next steps

- Replace hero placeholder with Susan screenshot or product capture
- Add real contact details and FRN
- Integrate into main TanStack site or host as static pages on mortgagego.co.uk (or your domain)
- Compliance sign-off on `disclosures.html` content
