# Gate G6A — Staging safety, environment isolation & preview readiness

**Status:** Complete (local; not pushed; staging infrastructure NOT provisioned)  
**Branch:** `targeted-features`  
**Base:** `post-g6-company-provisioning` → `ed87eda`  
**Tag:** `post-g6a-staging-safety`  
**Verify:** `node --env-file=.env scripts/g6a-staging-safety-verify.mjs`

G1–G6 remain in force. **Azure staging/prod deploy, Git push, G7 Super Owner, MFA, Twilio subaccounts NOT started.**

---

## Decisions

| Decision | Value |
|----------|--------|
| **CODE READY FOR STAGING INFRASTRUCTURE** | **YES** |
| **SAFE TO DEPLOY STAGING NOW** | **NO** |

Infrastructure (separate Azure app, Supabase project, secrets, DNS, workflows) is still required before any deploy.

---

## Environment model

| Variable | Role |
|----------|------|
| **`APP_ENV`** | Server-authoritative: `production` \| `staging` \| `development` |
| `VITE_APP_ENV` | Public mirror for staging banner only |
| `COMMUNICATION_DELIVERY_MODE` | `live` \| `capture` \| `disabled` |
| `APP_BASE_URL` / `VITE_APP_URL` | Environment-specific origin |

**Resolution** (`src/lib/app-environment.server.ts`):

1. Explicit `APP_ENV` / `VITE_APP_ENV`
2. Unset + Azure (`WEBSITE_*`) → **production** (legacy preserve)
3. Unset local → **development**
4. Invalid value → **unknown** → external actions **disabled** (never production)

**Defaults for delivery mode:**

| Env | Default mode |
|-----|----------------|
| production | live |
| staging / development | capture |
| unknown | disabled |

**Core principle:** missing staging config must **never** fall back to production integrations.

Helpers: `getAppEnvironment()`, `isProduction()`, `isStaging()`, `getCommunicationDeliveryMode()`, `isTwilioLiveDeliveryAllowed()`, `isTeamsGraphLiveAllowed()`, `isSusanEnvironmentAllowed()`, `assertProductionOperationAllowed()`.

External guard: `src/lib/external-action.server.ts` — `assertExternalActionAllowed` / `captureExternalAction`.

---

## External service inventory

| Service | Purpose | Staging strategy | Real side effect? | Safe default | Staging secret? | Webhook? |
|---------|---------|------------------|-------------------|--------------|-----------------|----------|
| Supabase | Auth/DB | **Separate staging project** | N/A | — | Yes (unique) | — |
| Twilio SMS | Outbound SMS | capture/disable; never reuse prod SIDs | Yes if live | capture | Opt-in test only | Inbound `/api/sms/inbound` |
| Twilio Voice | Softphone/inbound | block outbound; leave prod webhooks alone | Yes | blocked | Opt-in test | Multiple `/api/twilio/voice/*` |
| Email | Mostly mailto / Auth | capture/suppress; Auth emails = blocker until staging Auth | Auth yes | capture | Staging Auth | — |
| MS Graph/Teams | Calendar/meetings | mock capture; no prod calendar writes | Yes | blocked | Dedicated Entra later | OAuth callback |
| Susan/Simli | Avatar | `STAGING_SUSAN_ENABLED=false` | Paid API | off | Staging keys | — |
| TTS/STT/OpenAI | Susan stack | same as Susan env | Paid API | off | Staging keys | — |
| OpenAI chat (broader) | Interview step, call AI, classify, commission, address helpers | `STAGING_OPENAI_ENABLED` or `STAGING_SUSAN_ENABLED` | Paid API + customer text | off in staging | Staging key only | — |
| Azure Speech TTS | Susan `/api/tts` | same OpenAI/Susan env gate | Paid API | off in staging | Staging key | — |
| getAddress.io | UK address lookup | `STAGING_GETADDRESS_ENABLED`; else postcodes.io fallback | Paid API | off in staging | Staging key (never prod) | — |
| postcodes.io | Free address fallback | always OK | No key | allowed | — | — |
| Azure | Hosting | separate Web App (design) | — | — | Separate slot secrets | — |

**Payment / debit card:** none found.

---

## Twilio / SMS / voice

- Production Twilio resources **unchanged**.
- `sendSms` → guard → **capture** returns `CAPTURED_*` sid; **disabled** throws; **live** only if production (or `STAGING_TWILIO_ALLOW_LIVE=true` + live mode).
- Presence of production `TWILIO_*` in a staging process does **not** enable live send.
- Softphone outbound (`client-outbound`) blocked when not live-allowed.
- Recommendation for future UAT: **fully mocked/capture transport** first; dedicated Twilio test subaccount only if voice UAT required.

---

## Email

- No dedicated Resend/SendGrid/Nodemailer transport in-app; staff “email link” is typically client mailto; transactional SMS dominates.
- **Supabase Auth** password-recovery / invite emails are Auth-provider generated → **cannot be safely intercepted in-app**. Staging requires separate Auth project + registered redirect URLs. Do not trigger recovery against production Auth during UAT.
- App-level email actions → capture/suppress via delivery mode.

---

## Graph / Teams / booking

- `syncAppointmentToTeams` / `deleteTeamsEvent` guarded.
- Non-live write → **mock** event id + join URL persisted (booking UAT without calendar side effects).
- Reads of production calendars blocked unless `STAGING_TEAMS_ALLOW_READ=true`.
- Future: dedicated test Microsoft identity **or** keep mock layer for initial UAT.

---

## Supabase staging recommendation

**B — SEPARATE SUPABASE STAGING PROJECT** (preferred).

Do not copy production customer/business data. Seed synthetic tenants/config only. Synthetic personas (design only — not created now):

Platform Super Owner (G7), 001 Owner/Adviser/Customer/Introducer, 002 Owner/Adviser/Customer/Introducer.

**002:** no permanent production memberships; staging DB holds synthetic 002 identities.  
**Susan:** staging seed preserves 001 ON / 002 OFF.  
**Regulatory 002:** show Not configured; not a staging-infra blocker.

---

## Feature × environment

`ENVIRONMENT permits service` **AND** `tenant feature enabled` **AND** auth → operate.

Example: staging + Susan env OFF + 001 feature ON → DENY.  
Production + Susan env ON + 002 feature OFF → DENY (tenant).

---

## Webhooks & callbacks

Production Twilio webhooks must continue pointing at production origin.  
Future staging webhooks → staging origin only. **Do not change live webhooks in G6A.**

`APP_BASE_URL` drives links/callbacks. Staging must set staging origin so captured/comms links never become `https://mymortgagehub.uk/...`.

### Auth redirects to register later on staging Auth

- `{APP_BASE_URL}/auth`
- `{APP_BASE_URL}/auth/reset`
- `{APP_BASE_URL}/register`
- `{APP_BASE_URL}/api/teams/callback`

---

## Secrets (names only)

| Class | Examples |
|-------|----------|
| Safe public | `VITE_APP_URL`, `VITE_APP_ENV`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` |
| Production secret | `SUPABASE_SERVICE_ROLE_KEY`, `TWILIO_AUTH_TOKEN`, `TEAMS_CLIENT_SECRET`, Simli/OpenAI keys |
| Staging secret required | Separate Supabase service role + publishable; optional staging Twilio/Graph/Susan keys |
| Must never share | Production Twilio/Graph/Supabase service role values into staging app |

### VITE / client audit

Client may receive publishable Supabase + public URLs/`VITE_APP_ENV` only.  
**Confirmed not for client:** service-role, Twilio auth token/API secret, Graph client secret, provider secrets.

---

## Staging UI

- `StagingBanner` in root when non-production.
- Destructive UAT must **not** run against production DB — separate Supabase is the primary control.
- Finance: synthetic only; no production finance copy; no payment provider found.

---

## Azure / domain / CI (design only)

**Recommend: separate Azure Web App** (not only a slot) for stronger env/secret/webhook isolation on B1.

**Hostname:** `staging.mymortgagehub.uk` → `/{slug}` tenant paths unchanged.

**GitHub:** current `.github/workflows/targeted-features_mortgagehub-prod.yml` deploys on **push to `targeted-features`**. This is unsafe as permanent production policy.

Recommended CI/CD:

- Production: protected branch or **manual `workflow_dispatch` + environment approval**
- Staging: dedicated branch / manual dispatch → staging Web App
- Docs-only: no deploy

Do not push workflow changes in G6A.

---

## Local staging simulation

```bash
APP_ENV=staging \
VITE_APP_ENV=staging \
COMMUNICATION_DELIVERY_MODE=capture \
APP_BASE_URL=http://localhost:5173 \
VITE_APP_URL=http://localhost:5173 \
npm run dev
```

Expect STAGING banner; SMS/Teams captured/mocked; no real Twilio/Graph writes.

---

## Template

`.env.staging.example` — placeholders only.

---

## Tests & regressions

- `scripts/g6a-staging-safety-verify.mjs`
- G6 / G5 / G4A / G4 / G3 regressions required PASS
- No DB schema migration in G6A → **G6 backup remains DB recovery point**

---

## Type debt

G6 ≈ 18 untyped bridges. G6A adds env helpers **without** new Supabase `as any` modules. Report post-count in completion report.

---

## Exact remaining actions before SAFE TO DEPLOY STAGING = YES

1. Create separate Azure Web App  
2. DNS `staging.mymortgagehub.uk`  
3. Separate Supabase staging project + migrations seed  
4. Synthetic Auth users / personas  
5. Staging secrets (never prod values)  
6. Auth redirect URLs  
7. Twilio capture-only (or dedicated test)  
8. Graph mock or test identity  
9. Susan staging keys only if enabled  
10. Staging GitHub workflow (manual)  
11. Harden production workflow (no auto-push deploy)  
12. Webhook isolation plan executed  

---

## Confirmations

No Azure staging created · No production deploy · No Git push · No Twilio/Graph resource changes · No real SMS/email/Teams · No 002 memberships · platform_roles=0 · MFA OFF · Super Owner NOT started · Auth users=6 · G7 NOT STARTED.
