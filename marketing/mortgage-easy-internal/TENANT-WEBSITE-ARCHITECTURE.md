# Tenant website architecture (reusable pattern)

Internal only. Not part of the published site (`marketing/mortgage-hub-website`).

Mortgage Easy (Tenant 001) is the first tenant built this way. Use the same pattern for every
later tenant website; Trent Valley Financial Services is planned as Tenant 002 (see the end of
this note).

## 1. Shape

Each tenant website is a separate static site, built and deployed on its own, that links into
Mortgage Hub. The website and the Hub are separate systems:

| Layer | Mortgage Easy (Tenant 001) | Owned by |
| --- | --- | --- |
| Source | GitHub `pmabbott2-lab/m-abbott-co-uk`, branch `mortgageeasy-site`, folder `marketing/mortgage-hub-website` | Tenant site work |
| Hosting | Cloudflare Pages project `mortgageeasy`, production branch `mortgageeasy-site`, automatic deploy on push | Tenant site work |
| Large media | R2 bucket `mortgageeasy-media`, custom domain `https://media.mortgageeasy.uk` | Tenant site work |
| Domain | `https://mortgageeasy.uk` (canonical); `www.mortgageeasy.uk`, `mortgage-easy.co.uk`, `mortgage-easy.com` (+ `www`) 301 to it | Cloudflare account |
| Pre-launch gate (optional) | Cloudflare Access app "Mortgage Easy - private pre-production" | Cloudflare Zero Trust |
| Customer accounts, journeys, booking, APIs | Mortgage Hub (`https://mymortgagehub.uk`), deployed separately | Hub work |

The tenant site never contains Hub code, Hub secrets or Supabase access. It is plain HTML, CSS and
JS plus media.

## 2. Repository and branch

- One dedicated branch per tenant site (e.g. `mortgageeasy-site`). Never build a tenant site on a
  Hub branch, and never merge a tenant branch into the Hub branches.
- Hub security work (e.g. `targeted-features`, S4C3) is developed, reviewed and deployed on its own
  branches and checkouts. Tenant website changes must not touch Hub files, Hub CORS or Supabase.
- Internal notes for the tenant live beside the site (here: `marketing/mortgage-easy-internal/`),
  outside the published folder.

## 3. Cloudflare Pages

- Pages project connected to GitHub, production branch = the tenant branch, build output = the
  site folder. Every push to that branch deploys automatically (about a minute).
- Other branches pushed to the same repo create preview deployments
  (`<branch>.<project>.pages.dev`, `<hash>.<project>.pages.dev`). These are gated too (section 5).
- Pages does not honour HTTP range requests, so video seeking and Safari/iOS playback break for
  MP4s served from Pages. Put video and other large media in R2 (section 4).

## 4. Media on R2

- One R2 bucket per tenant, objects under `video/` etc.
- Serve it through a custom domain on the tenant's zone (`media.<tenant-domain>`), not the
  rate-limited `r2.dev` development URL; disable `r2.dev` once the custom domain is in use.
- The media domain is public (not behind Access) so that browsers can stream from it; it only
  exposes the uploaded files, and the bucket root does not list contents.
- Check before switching links: `200` with `accept-ranges: bytes` on a full request, `206` with
  `content-range` on a `Range` request, and the same bytes as the previous host.
- Cache-bust replaced files with a `?v=N` query or a new file name. Captions (`.vtt`) can stay on
  Pages (same origin, no CORS needed).

## 5. Optional private gate (Cloudflare Access)

Used while a tenant site is in private development, without adding any login code to the site.

- Zero Trust (free plan) with the One-time PIN login method: a 6-digit code is emailed to the
  user; there is no password or authenticator app.
- One self-hosted Access application whose destinations cover every hostname that serves the site:
  `*.<project>.pages.dev`, `<project>.pages.dev`, the canonical domain, and each alias/`www`.
  Covering `pages.dev` closes the bypass where the site is reachable on its Pages address.
- One Allow policy with an explicit email list (Include → Emails). Nobody else receives a code.
- Session duration 24 hours.
- Add a tester: Zero Trust → Access controls → Policies → open the app's policy → add the email.
  Remove a tester: delete the email (their existing session lasts until it expires, or revoke it
  under Team & Resources → Users).
- Redirect Rules run before Access, so `www`/alias 301s still work while gated.

Removing the gate at public launch needs no rebuild: delete the Access application (or remove the
canonical domain from its destinations and keep `pages.dev` gated). Only do this with explicit
launch approval.

**The owner-only admin area (`/admin`, `/api/admin`) has its own separate Access application and
must never be removed with the site gate.** Launching the public site removes only the site gate.
See `ADMIN-CALCULATOR.md`.

## 6. Custom domain and redirects

- Attach the canonical domain and `www` as Pages custom domains; Pages adds the proxied CNAMEs.
- `www` → apex: Redirect Rule, wildcard `*://www.<domain>/*` → `https://<domain>/${2}`, 301,
  preserve query string.
- Extra domains that should reach the same site: proxied placeholder A records (`192.0.2.1`) for
  the apex and `www`, plus a Redirect Rule `*://*<alias-domain>/*` → `https://<domain>/${3}`, 301,
  preserve query string.
- Never edit unrelated DNS records, especially email (MX, SPF/TXT, Microsoft `autodiscover`,
  `enterpriseregistration`, `enterpriseenrollment`). Record the DNS list before and after.

## 7. Tenant-aware Hub links and referrals

- All Hub links use the tenant route, e.g. `https://mymortgagehub.uk/<tenant-slug>/login` with
  `join=1` / `start=voice|book` as needed. Do not fall back to generic `/auth` links.
- Introducer `?ref=` is read on landing, kept in `sessionStorage`, and appended to Hub links and
  internal page links so attribution survives navigation and the redirect domains.

## 8. Hub APIs and CORS (separate integration)

- Any calls from the site to Hub APIs (rates, calculator leads, forms) only work once the Hub
  allows the tenant origin (`https://<domain>`) in CORS. That is a Hub change, made and deployed
  in the Hub project, not in the tenant site.
- Until then the site must degrade cleanly (local calculator maths, forms in preview mode).

## 9. Workflow

develop → test → approve → commit → push → automatic deploy

1. Develop on the tenant branch; preview locally.
2. Test: page loads, navigation, mobile layout, images, favicon, media playback/seeking/captions,
   calculator maths, `?ref=` persistence, Hub link targets. While gated, test in a signed-in
   browser (or with an Access service token).
3. Owner approves the change.
4. Commit and push to the tenant branch; Cloudflare Pages deploys automatically.
5. Re-check the deployed site.

Rollback: `git revert` the commit and push (redeploys automatically), or in Cloudflare Pages →
Deployments, roll back to a previous production deployment instantly.

## 10. Tenant 002: Trent Valley Financial Services (planned, not started)

- Different branding and design. Do not clone the Mortgage Easy design; reuse individual
  components selectively (e.g. calculator logic, video player, `?ref=` handling, Hub link helper)
  where they fit.
- Set up the Cloudflare side early: its own Pages project on its own branch, its own R2 bucket and
  media domain, and an Access gate from day one.
- Build iteratively on its own branch and deploy independently of Mortgage Easy and the Hub.
- Hub tenant routing, membership and CORS for Tenant 002 are separate Hub work.
