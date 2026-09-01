# MortgageEasy — brokerage website mockup

Static HTML mockup for **MortgageEasy** (customer-facing brokerage brand). The platform behind the scenes is **Mortgage Hub**.

## Open locally

```bash
open marketing/mortgage-hub-website/index.html
```

Or serve with the stable site script (starts mock-up on port **8081**, Hub on **8080**, ngrok on public URL):

```bash
bash scripts/mortgage-hub-stable.sh start
open http://127.0.0.1:8081
```

## Pages

| Page | File | Audience |
|------|------|----------|
| Home | `index.html` | Customers — your journey (voice / chat / book), advisor-led messaging |
| Calculator | `calculator.html` | Introducer embed — LTV rate estimate, callback + broker journeys |
| Partnerships | `partnerships.html` | Introducers |
| Careers | `careers.html` | Advisor recruitment |
| Disclosures | `disclosures.html` | FCA initial disclosure structure (template) |

## Brand

- Logo: `assets/logo.svg` (MortgageEasy wordmark)
- Colours: navy `#1a2f4f`, green `#3d9e47`
- Tagline: *Advisor-led · technology-supported*

## Linking to Mortgage Hub app

`site-config.js` rewrites all `[data-hub-auth]` links to the live Hub:

| Where mockup runs | Hub origin used |
|-------------------|-----------------|
| `127.0.0.1:8081` (local) | `http://127.0.0.1:8080` |
| `127.0.0.1:8081?hub=public` | ngrok public URL (broker parity testing) |
| ngrok mockup host | `https://another-selector-ranged.ngrok-free.dev` |

Broker journey links always include full params:

```
/auth?from=broker&join=1&start=voice|chat|book
```

- `from=broker` — broker channel branding (works without `join` for sign-in branding)
- `join=1` — opens Create account tab
- `start=` — post-auth journey (voice / chat / book; book uses appointment-first signup)

Global helpers set by `site-config.js`:

- `window.MORTGAGE_HUB_API_URL` — Hub origin for API calls
- `window.MORTGAGE_HUB_PATH(path)` — build full Hub URLs

Override Hub origin before loading `site-config.js`:

```html
<script>window.MORTGAGE_HUB_APP_URL = "https://another-selector-ranged.ngrok-free.dev";</script>
```

## Calculator

### Features

1. **Inputs** — property value, loan amount, term → LTV + monthly payment
2. **Dynamic rate** — `POST /api/calculator/estimate-rate` on Hub (OpenAI when `OPENAI_API_KEY` set; static LTV bands otherwise)
3. **Callback lead** — name, email, telephone (required) + GDPR consent → `POST /api/introducer/calculator-lead`
4. **Journey cards** — voice / chat / book via broker auth URLs (`site-config` `hubPath`)

### Introducer link format

```
http://127.0.0.1:8081/calculator.html?ref=INTRODUCER-SLUG
```

Both `ref` and `introducer` query params are accepted. Callback attribution requires a valid slug; calculator and journey links work without one.

| Provider CTA | URL |
|--------------|-----|
| "Calculate your payments" | `calculator.html?ref=slug` |
| "Speak to an advisor" | `calculator.html?ref=slug#callback` |

Leads are stored in Mortgage Hub `introducer_leads` with `lead_source=web`. No customer account is created for callbacks.

### Hub API (server-only OpenAI)

| Endpoint | Purpose |
|----------|---------|
| `POST /api/calculator/estimate-rate` | `{ ltv, loanAmount, termYears }` → `{ ratePct, disclaimer, source }` |
| `POST /api/introducer/calculator-lead` | Callback lead capture with calculator snapshot |

Env: `OPENAI_API_KEY` in Hub `.env` (never exposed to browser). Without it, static LTV bands are used.

## FCA compliance — important

**This mockup is a design structure, not approved regulated copy.** See index footer and `disclosures.html` for checklist.
