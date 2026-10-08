# Earnings and business planning calculator (`/admin`)

Internal only. Owner-only planning tool at `https://mortgageeasy.uk/admin`. It is not part of the
public site and must stay behind its own Cloudflare Access application permanently, including
after public launch.

## What is where

| Part | Location | Contains figures? |
| --- | --- | --- |
| Page, styles, charts, formulas | `marketing/mortgage-hub-website/admin/` | No. Formulas only |
| Server check (Access token) | `functions/_lib/admin-access.js`, `functions/admin/_middleware.js`, `functions/api/admin/_middleware.js` | No |
| Storage API | `functions/api/admin/assumptions.js`, `functions/api/admin/scenarios.js` | No |
| Rates, starting inputs, saved plans | Cloudflare KV namespace bound as `ADMIN_KV` | **Yes. Never in git** |
| Local copy of the defaults | `admin-private.local/defaults.json` (gitignored by `*.local`) | **Yes. Never in git** |
| Tests | `admin-tests/` (made-up round numbers); `admin-private.local/worked-example.test.mjs` (real) | Only the private one |

The GitHub repository is public, so no rate, commission level or saved plan may be committed.
`git check-ignore -v marketing/mortgage-easy-internal/admin-private.local/defaults.json` must
report the `*.local` rule.

## Security layers

1. **Cloudflare Access application "Mortgage Easy – admin (owner only)"** with path destinations
   `mortgageeasy.uk/admin`, `mortgageeasy.uk/api/admin`, and the same two paths on
   `mortgageeasy.pages.dev` and `*.mortgageeasy.pages.dev`. Allow policy: the owner's email only.
   This is separate from the site gate and is never removed at launch.
2. **Pages Functions middleware** on `/admin/*` and `/api/admin/*` verifies the
   `Cf-Access-Jwt-Assertion` token on every request: RS256 signature against the team's
   published keys, issuer, the admin app's AUD tag (so a site-gate token is refused), expiry, and
   the email allow-list. Anything missing or wrong → 403. Missing configuration → 403.
3. **Headers** on every admin response: `no-store`, `noindex`, strict CSP (`'self'` only, no
   inline script or style, `frame-ancestors 'none'`), no referrer.
4. **Writes** need same-origin `Origin` and JSON content type; all input is validated against
   the field ranges in `model.js`.

Pages environment variables (production and preview):

| Name | Value |
| --- | --- |
| `ACCESS_TEAM_DOMAIN` | `<team>.cloudflareaccess.com` |
| `ACCESS_ADMIN_AUD` | AUD tag of the admin Access application (not the site gate) |
| `ADMIN_EMAILS` | owner email (comma-separated if more are approved) |

Plus the KV binding `ADMIN_KV` → the admin KV namespace.

## The model

Per case type (remortgage, purchase), per adviser, per month:

```
Written       = (own seen + introduced seen) × seen-to-written
Completions   = Written × (1 − not completed)
Procuration   = Completions × average mortgage × procuration rate × share received after HLP
Broker fees   = Written × fee-paying % × broker fee                  (month written, no refunds)
Protection    = Written × protection % × (1 − not completed) × (1 − NTU)
                × monthly premium × 12 × protection commission × (1 − cancellations)
GI            = Written × GI % × (1 − not completed) × (1 − NTU)
                × annual premium × GI commission × (1 − cancellations)
Adviser       = adviser % × (procuration + fees)
                + introduction % × (own customers' procuration + fees)
                + protection % × (protection + GI)
Introducer    = introducer % × (introduced customers' procuration + fees)
Mortgage Easy = total − adviser − introducer         (no costs; the residual is the margin)
```

Timing: broker fees in the month written; procuration, protection and GI after each case type's
lag (1 to 6 months). HLP's share of procuration is shown as a memo line only.

## Running locally

```
node --test marketing/mortgage-easy-internal/admin-tests/*.test.mjs \
            marketing/mortgage-easy-internal/admin-private.local/*.test.mjs
node marketing/mortgage-easy-internal/admin-dev/server.mjs     # http://127.0.0.1:8789/admin/
```

The preview server skips the Access check and uses `admin-private.local/dev-kv.json`. It is
local only (127.0.0.1) and never deployed.

Routing check against the bundle Cloudflare deploys:

```
npx wrangler pages functions build functions --outdir /tmp/me-fnbuild --output-routes-path /tmp/me-fnbuild-routes.json
node marketing/mortgage-easy-internal/admin-tests/bundle-check.mjs /tmp/me-fnbuild/index.js
```

## Going live (each step needs explicit approval)

1. Create the admin Access application and owner-only policy. Note its AUD tag.
2. Create the KV namespace, bind it to the Pages project as `ADMIN_KV`, and set the three
   environment variables above.
3. Seed defaults: `npx wrangler kv key put assumptions --path marketing/mortgage-easy-internal/admin-private.local/defaults.json --namespace-id <id> --remote`
   (remove the illustrative adviser inputs first if they should not be the starting template).
4. Push. Then test from outside on every host: `/admin`, `/admin/`, `/admin/app.js`,
   `/api/admin/assumptions`, `/ADMIN/`, `//admin/`, `/%61dmin/`, a forged token, and an email that
   is allowed on the site but not on admin. Expect refusal or no data in every case.
