# Mortgage Hub — Gate G4 (Tenant routing & branding)

**Status:** Complete · **G4A / G5 NOT STARTED** · **NO Azure deployment** · **NO push**  
**Date:** 2026-09-17  
**Baseline:** `post-g3-tenant-security` @ `fbecadc`  
**Backup:** `backups/post-g3-tenant-security-20260917T204824Z/`

---

## 1. Scope

G4 delivers the first **visible** multi-tenant application layer:

| URL | Meaning |
|-----|---------|
| `/` | Mortgage Hub **platform** root (not Mortgage Easy) |
| `/mortgageeasy` | Tenant 001 context |
| `/trentvalleyfs` | Tenant 002 context |
| `/[tenantSlug]/…` | Dynamic tenant resolution from `tenants` table |
| `/unknown-company` | Controlled 404 — **never** falls back to 001 |

G4 does **not**: Super Owner UI, full feature enforcement (G5), service-role hardening (G4A), Twilio changes, Azure staging/production deploy.

---

## 2. Security principle

```
URL slug → resolve tenants row → presentation context
→ authenticate → membership / platform authority → RLS → data
```

Slug identifies **requested** firm only. It is **not** authorisation.

---

## 3. Routing architecture

### Before G4
Flat TanStack file routes: `/`, `/auth`, `/home`, `/book/$slug` (introducer), pathless `_authenticated`. No `/$tenantSlug`.

### After G4
- **Platform root** rewritten: firm picker + platform sign-in (`src/routes/index.tsx`)
- **Tenant layout** `src/routes/$tenantSlug/route.tsx`
  - `beforeLoad`: reserved-slug check → peek tenant → inactive UI or load presentation
  - Fail closed: unknown → `notFound()`; inactive → firm unavailable panel
- Children:
  - `/$tenantSlug/` — branded landing
  - `/$tenantSlug/login` — tenant login bridge → `/auth?tenant=…` → membership check
  - `/$tenantSlug/workspace` — membership gate → `/home` on success, deny otherwise
  - `/$tenantSlug/ref/$introducerRef` — routing shell for future introducer links

Existing flat authenticated routes (`/home`, …) remain for G4 to avoid a high-churn rewrite. Tenant UI convenience may store slug in `sessionStorage` (`mh:ui-tenant-*`) — **not** authority.

Reserved first segments (cannot be tenant slugs): `api`, `auth`, `home`, `book`, `go`, `raf`, … (`RESERVED_TENANT_SLUGS`).

**Note:** Marketing static site historically served under `/mortgageeasy/`. Hub SPA now also owns `/mortgageeasy` tenant routes. Staging/proxy must decide ownership; document under staging design.

---

## 4. Tenant context & presentation

| Module | Role |
|--------|------|
| `src/lib/tenant-context.server.ts` | G2 resolve/membership/admin/data (unchanged fail-closed) |
| `src/lib/tenant-presentation.ts` | Safe shared types |
| `src/lib/tenant-presentation.server.ts` | Load branding + features for UI; server fns |
| `src/lib/tenant-ui.tsx` | React provider / hooks |

Presentation fields: tenantId, companyCode, slug, names, type, status, websiteUrl, contact fields, logoUrl, colours, susanEnabled, usedNeutralFallback, pageTitle.

Never exposes Twilio/service keys/grants.

---

## 5. Branding

| Tenant | Source | Result |
|--------|--------|--------|
| 001 Mortgage Easy | Existing marketing logos + navy/green | Seeded `tenant_branding`; assets in `public/tenant-branding/mortgageeasy/` |
| 002 Trent Valley FS | Existing `marketing/second-brand-website` logos + river palette | Seeded; assets in `public/tenant-branding/trentvalleyfs/` |
| Incomplete branding | Neutral Hub + company name | `usedNeutralFallback`; **never** copies 001 |

Migration: `20260917210000_gate_g4_tenant_branding_seed.sql` (remote name `gate_g4_tenant_branding_seed`).

Website links: 001 → `/mortgageeasy/`; 002 → `NULL` (link hidden — no invented URL).

Regulatory: no invented FCA text. 002 legal/FCA still incomplete in DB — report gap.

---

## 6. Login & membership

- `/$tenantSlug/login` → `/auth?tenant=<slug>`
- After auth → `/$tenantSlug/workspace` membership check via `has_tenant_membership`
- 001-only user on `/trentvalleyfs/workspace` → **Access denied** (no fake 002 memberships)
- Multi-membership ready: route selects current firm; future switcher not built

---

## 7. Public journeys / generated links

| Area | G4 status |
|------|-----------|
| Tenant landing / login / workspace | Done |
| `/ref/...` shell | Done (verify introducer∈tenant deferred) |
| Legacy `/book`, `/go`, `/raf` | Still flat; need tenant prefix in G5/G6 |
| SMS/email/booking generated URLs | Still mostly flat `/home`, `/book/…` — **tenantise in G4A/G5** |
| Susan | Landing hides CTA when `susan` disabled; **hard block G5** |

---

## 8. Feature / Susan / Twilio

- Features **read** for UI only; G5 enforces
- 001 Susan enabled / 002 disabled preserved
- Twilio frozen

---

## 9. G4A service-role hardening list (input)

| Area | Files (examples) | Service role? | Tenant assertion? | Risk | G4A action |
|------|------------------|---------------|-------------------|------|------------|
| Booking | `booking.functions.ts` | Yes | Partial/none | Cross-tenant writes | Assert `tenant_id` + membership before insert |
| SMS | `sms.server.ts`, inbound API | Yes | Weak | Wrong-tenant logs/links | Pass tenant into link builders + assert |
| Sessions/CRM | `sessions.functions.ts` | Yes | Weak | Cross-tenant CRM | Assert on every mutate |
| Introducer / leads | `introducer*.ts`, calculator-lead | Yes | Weak | Cross-tenant leads | Bind introducer→tenant |
| Referrals | `referrals.functions.ts` | Yes | Weak | Bad RAF URLs | Tenant-prefixed share URLs + assert |
| Comms | `comms.server.ts` | Yes | Defaults ME footer | Wrong regulatory footer | Load `tenant_comms_config` |
| Telephony | `telephony*.ts`, voice APIs | Yes | Brand enum only | Wrong firm numbers | Map tenant→telephony config |
| Finance | `finance.functions.ts` | Yes | Weak | Cross-tenant finance | Assert admin + tenant |
| Auth admin | `admin.functions.ts`, password reset | Yes | N/A / JUSTIFIED | Invite wrong firm | Scope invites to tenant |
| Teams | `teams-calendar.server.ts` | Yes | Weak | Diary bleed | Tenant-scoped advisors |

G4 did **not** expose new 002 write journeys that require unhardened service-role paths.

---

## 10. Staging design (not built)

| Concern | Requirement |
|---------|-------------|
| Host | Separate Azure Web App or slot (e.g. staging.mymortgagehub.uk) |
| Supabase | Prefer separate project or strict non-prod keys |
| Twilio | Test credentials / disable outbound SMS & voice |
| Email | Sink or disabled |
| OAuth / Teams | Staging redirect URIs |
| Susan / avatar / TTS/STT | Staging keys or mocks |
| Webhooks | Point only at staging; never prod numbers |

Authorise staging separately.

---

## 11. Tests

- `scripts/g4-routing-verify.mjs` — slug resolve, branding separation, Owner 001/002, counts, Susan
- G3 helper regression smoke (Owner data 001 allow / 002 deny)
- Build: `npm run build`

---

## 12. Rollback

1. Checkout `post-g3-tenant-security`
2. Optional: revert branding seed via SQL / PITR
3. Do not weaken RLS to “fix” routing

---

## 13. G5 dependencies

- Feature/API enforcement (Susan hard block on 002)
- Tenant-prefix remaining public journeys
- Generated link tenantisation
- Full authenticated route nesting under `/$tenantSlug` (optional product decision)

---

## 14. Regulatory gaps (002)

Missing / incomplete for Trent Valley FS in DB: FCA details, legal entity copy, privacy/legal URLs, company website URL, telephone/email for public footer. Use neutral UI until configured — **do not copy 001**.
