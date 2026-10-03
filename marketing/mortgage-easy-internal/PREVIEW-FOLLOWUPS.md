# Mortgage Easy — follow-ups recorded at Cloudflare Pages preview stage

Internal only. Not part of the published site (`marketing/mortgage-hub-website`).

The Cloudflare Pages deployment at this stage is a PREVIEW only. It is not approval to
publish the website on mortgageeasy.uk.

## 1. Mortgage Hub tenant routing (separate Hub work — not implemented in `mortgageeasy-site`)

Intended permanent architecture:

Mortgage Easy → explicit Mortgage Easy tenant route → Mortgage Hub → Tenant 001 context
retained throughout authentication, journey and booking.

Canonical customer entry route: `https://mymortgagehub.uk/mortgageeasy/login`

Links used by the Mortgage Easy site (introducer `?ref=` is appended when present):

| Purpose | URL |
| --- | --- |
| Sign in | `https://mymortgagehub.uk/mortgageeasy/login` |
| Sign up | `https://mymortgagehub.uk/mortgageeasy/login?join=1` |
| Start journey / Susan | `https://mymortgagehub.uk/mortgageeasy/login?join=1&start=voice` |
| Book | `https://mymortgagehub.uk/mortgageeasy/login?join=1&start=book` |

Hub defects to resolve before these flows work end to end:

- **A.** `/mortgageeasy/login` must preserve tenant context, query parameters, `?ref=`,
  broker/introducer attribution and join/start intent when forwarding into authentication.
  Today it forwards to `/auth?tenant=<slug>&join=1&start=…` and drops `ref` and broker branding.
- **B.** New customers entering through the Mortgage Easy tenant route must acquire the
  appropriate Tenant 001 customer context/membership. Today self-signup creates a profile and
  `customer` role only, so tenant-scoped journeys (e.g. Susan session creation) fail.
- **C.** Direct Mortgage Easy booking must retain Tenant 001 context even when there is no
  introducer `?ref=`. Today appointment-first booking does not pass the tenant and fails closed.
- **D.** After authentication, `start=voice` and `start=book` must continue into the correct
  Tenant 001 journey.

Do not work around these by switching the site back to generic `/auth` URLs.

## 2. Hub CORS

The site calls `https://mymortgagehub.uk/api/calculator/market-rates`,
`/api/calculator/estimate-rate` and `/api/introducer/calculator-lead`. These will be blocked by
CORS from the preview origin until the Hub allows it. Local calculator maths works without them.

## 3. Video hosting

Cloudflare Pages ignores HTTP Range requests (always `200`, never `206`), so seeking fails and
Safari/iOS may refuse to play MP4s served from Pages. The four homepage videos are therefore
served from R2 bucket `mortgageeasy-media` (objects under `video/`) via the bucket's custom
domain `https://media.mortgageeasy.uk` (public, not behind Cloudflare Access; range requests
return `206`). Captions (`.vtt`) stay on Pages.

Still to do: disable the bucket's `r2.dev` public development URL once the custom domain is
confirmed in the browser. The MP4 copies under `assets/video/` are no longer referenced and can
be removed from the published folder.

## 4. Introducer and careers forms → Mortgage Hub (Hub side to be delivered later)

The site now has two simple fill-out forms. The website templates are complete; the Hub side is
not built yet, so both forms run in preview mode (`data-live="false"`): they validate and show a
"not connected yet — nothing has been sent" message, and post nothing.

| Form | Page | Planned Hub endpoint | Destination in Hub |
| --- | --- | --- | --- |
| Introducer enquiry | `partnerships.html#introducer-enquiry` | `POST /api/mortgageeasy/introducer-enquiry` | Owner contact point (partnerships) |
| Careers application | `careers.html#apply` | `POST /api/mortgageeasy/careers-application` | Owner contact point (recruitment) |

JSON payload (posted by `site-forms.js`; every payload also carries `form`, `tenant: "mortgageeasy"`
and `introducerRef`):

- Introducer enquiry: `name`, `company`, `businessType`, `phone`, `email`, `message`, `consent`
- Careers application: `role` (`self-employed-mortgage-protection` or `new-mortgage-advisor`),
  `name`, `phone`, `email`, `cemapQualified` (true/false), `consent`, plus an optional `cv` file

When a CV is attached, the careers form posts `multipart/form-data` instead of JSON: the same fields
as text parts (booleans as `"true"`/`"false"`) and the file in a `cv` part. The site only accepts
PDF, DOC or DOCX up to 5MB; the Hub should enforce the same limits server-side.

Hub work required:

- Create both endpoints for Tenant 001, store the submission, and notify the Owner contact point.
- Careers endpoint: accept both JSON and multipart, store the CV securely (private storage, not a
  public URL) and attach or link it in the Owner notification.
- Return `{ ok: true, message }` on success or `{ ok: false, error }` on failure.
- Allow the Mortgage Easy site origin in CORS for these endpoints (see section 2).
- Then set `data-live="true"` on each form to switch it on.

Careers roles are also listed on the page: Self-employed Mortgage & Protection Advisor (minimum two
years' standard residential mortgage advice) and New Mortgage Advisor (CeMAP qualified, new to role).

## 5. Pre-live compliance/content review (required before mortgageeasy.uk)

Legal entity: Mortgage Easy is a trading name of Mortgage Easy Group Limited, registered in
England and Wales, company number 17490711. FCA Firm Reference Number: pending.

Information still to be supplied:

- Registered office address
- Complaints email
- Complaints postal address
- FCA Firm Reference Number
- Service, product range and fee disclosure details
- Replacement of placeholder/mockup adviser content
- Partnerships email in the `partnerships.html` footer (currently `partnerships@mortgageeasy.example`)

Existing wording flagged for review (left unchanged):

- `calculator.html` — "MortgageEasy offers regulated mortgage advice"
- `index.html` — "leaving regulated advice to your advisor" / "She leaves regulated advice to your advisor"
- `partnerships.html` — FCA callout
- `disclosures.html` — "FCA MCOB disclosures" meta description, "Template disclosures — not approved
  regulated copy", `complaints@mortgageeasy.example`, "[postal address]", template service/product/fee text
- "Mockup"/"Placeholder" footers and notes in careers, about, partnerships and calculator
- Placeholder adviser profiles in `about.html`
