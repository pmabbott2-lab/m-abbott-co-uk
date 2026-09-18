# Gate G4A — Service-role & server-side tenant hardening

**Status:** Complete (local; not pushed; not Azure-deployed)  
**Branch:** `targeted-features`  
**Base tag:** `post-g4-tenant-routing` → `35e20ef`  
**Tag:** `post-g4a-server-hardening`  
**Verify:** `node --env-file=.env scripts/g4a-server-hardening-verify.mjs`

G1–G4 remain in force. **G5 not started.**

---

## Objective

G3 RLS protects authenticated PostgREST. **Service role bypasses RLS.**  
G4A adds an application assertion layer so privileged operations always establish tenant authority before elevated reads/writes.

Chain:

```
REQUEST → resolve tenant → auth (if required) → membership/capability or public journey authority
→ SERVER-SIDE TENANT ASSERTION → service-role op → tenant-scoped query/write
```

Never: trust body `tenant_id`; never default missing/invalid tenant to 001; never “search all tenants, take first match”.

---

## Canonical assertion architecture

**Module:** `src/lib/tenant-assert.server.ts` (extends `tenant-context.server.ts`)

| Helper | Purpose |
|--------|---------|
| `requireAuthenticatedTenantBySlug/Id` | Membership for route/UUID tenant |
| `resolveSoleMembershipTenant` | 1 membership → that tenant; 0/2+ fail closed |
| `requirePublicTenantBySlug` | Public journey: active slug only |
| `assertRowBelongsToTenant` | Resource `id` + `tenant_id` match |
| `withForcedTenantId` | Strip client `tenant_id`; force authorised |
| `rejectMismatchedClientTenantId` | Deny forged body tenant_id |
| `requireAuthenticatedTenantAdmin/Data` | Admin / data planes via G1A helpers |
| `tenantErrorMessage` | Opaque client errors |

Fail-closed codes: `TENANT_REQUIRED`, `TENANT_NOT_FOUND`, `TENANT_DATA_ACCESS_DENIED`, etc. No cross-tenant leakage in messages.

---

## Trusted vs untrusted tenant sources

**HIGH TRUST:** server-resolved active slug; validated membership; DB row `tenant_id`; invite token bound to `tenant_id`; (future) validated Twilio mapping.

**LOW TRUST (request only, never authorise):** form/query/JSON `tenant_id`, localStorage, hidden fields, URL alone without validation.

---

## Service-role inventory (summary)

~39 modules touch `supabaseAdmin` / service role / `auth.admin` (libs + API routes).

**Hardened in G4A (high risk):**

| Area | Files | Action |
|------|-------|--------|
| Booking / slots / callbacks | `booking.functions.ts` | Resolve tenant; adviser membership; force `tenant_id`; scope updates |
| Referrals / RAF SMS | `referrals.functions.ts` | Tenant-scoped codes; **sendSms object shape fix** |
| Introducer calculator leads | `introducer-calculator-lead.server.ts` | Force introducer `tenant_id` |
| Staff invites | `sessions.functions.ts` | Invite insert/list/revoke/consume bound to tenant; membership on accept |
| Telephony manage | `telephony-manage.functions.ts` | Owner + membership; scope numbers/agents; force insert tenant |
| Finance / commission | `finance.functions.ts` | Session ownership; ledger/rates scoped; forced inserts |
| Comms | `comms.functions.ts`, `comms.server.ts` | Tenant settings scoped; platform templates remain global |

**Deferred / residual privileged paths (documented for later gates):**

- Twilio voice/SMS webhook routes (transport still global; authority hardening partial)
- `teams-calendar.server.ts` (shared Graph integration — see Teams section)
- Broad CRM list/report paths still using service role with legacy owner checks (`exportOwnerCustomerReport`, some session list aggregations)
- `network-commission.functions.ts`, diary-settings, journey-analytics, phone-lookup, inbound-voicemail
- `auth.admin.generateLink` / password-reset (trusted server workflows; Auth users unchanged)
- `test-accounts.functions.ts` (owner tooling)

These remain **G5+ / Twilio gate** candidates where full journey exposure requires end-to-end feature enforcement.

---

## Resource ownership / CRUD protection

- **Read:** privileged queries add `.eq("tenant_id", authorisedTenantId)` (or assert row belongs).
- **Insert:** `withForcedTenantId` — client `tenant_id` ignored/replaced.
- **Update:** `.eq("id", …).eq("tenant_id", …)`; do not allow payload reassignment of `tenant_id`.
- **Delete:** same dual predicate (or assert-then-delete).

Service role *can* still reassign without app checks — tests document this; **application layer must block**.

---

## Domain findings

### Booking
Public/staff booking resolves tenant from slug → introducer → sole membership → adviser (never invent 001).  
`listBookableAdvisors(tenantId)` filters `tenant_memberships`.  
`assertAdvisorInTenant` before assign. Appointment insert forces `tenant_id`.

### Adviser availability
Slots accept optional `tenantSlug`; pool is membership-scoped. Empty 002 membership → empty adviser pool (no 001 bleed).

### CRM / customers / cases
Finance/session fee paths assert session tenant. Broader CRM service-role lists partially deferred — RLS still protects authenticated clients; privileged export paths flagged.

### Referrals / introducers
Calculator leads and RAF codes force introducer’s/user’s tenant. Introducer slug is not globally trusted across firms.

### Referral sendSms bug — **FIXED**
Was: positional `sendSms(phone, message)` (G2/G3 finding).  
Now: `sendSms({ to: profile.phone, body: message })` in `sendMyReferralLink`.  
Twilio architecture/sender unchanged. Verified by static regression in G4A suite.

### SMS
All audited triggers retain **global** Twilio transport. G4A ensures originating ops have validated tenant. **Per-tenant Twilio transport deferred** (later Twilio gate).

Triggers noted: booking confirm, callback confirm, RAF/referral share, invitations/text-me-a-link, interview/journey (existing), inbound auto-reply (webhook).

### Telephony
Runtime frozen (account/numbers/webhooks/MS/TwiML unchanged).  
DB manage panel: 001-only numbers; 002 cannot list/mutate; unknown tenant fail closed. Legacy null `tenant_id` rows readable only for Mortgage Easy slug (commented exception).

### Callbacks
`createCallbackRequest` resolves tenant, asserts adviser, forces `tenant_id`. Do not expose 002 public callback until G5.

### Communications
Platform `communication_templates` catalogue remains global (`tenant_id` null). Tenant `communication_settings` / versions scoped. No copy of 001 defaults into 002.

### Finance / commission
Session-scoped and list handlers require membership + `tenant_id` filters; ledger/history/audit inserts forced.

### Teams / Microsoft Graph
Shared/global Graph integration remains. Appointment sync still uses advisor’s linked calendar after tenant-scoped booking. **No per-tenant Graph infra in G4A** (not required for assertion security). Documented for later if isolation demanded.

### Staff invitations
Create/list/revoke scoped to creator’s sole membership tenant. Token resolve requires `tenant_id`. Accept upserts `tenant_memberships` for **invite.tenant_id only** (slug change cannot move firm).

### Auth Admin
`auth.admin.*` remains for trusted invite/profile/link flows only. No Super Owner conversion, no MFA, no 002 user creation, six Auth accounts retained.

### Public journeys
Authority from validated active slug (+ resource/introducer). Forged `tenant_id` rejected/overridden.

### Platform / reference data
Not incorrectly tenant-scoped: feature catalogue, lender refs, global communication template catalogue, platform config.

### GROUP / EXTERNAL
Assertions use `can_access_tenant_data` (GROUP SO eventual; EXTERNAL never auto). Super Owner **not** started. Support/emergency grants time-limited; fixtures cleaned.

---

## Tests

| Suite | Result |
|-------|--------|
| `scripts/g4a-server-hardening-verify.mjs` | PASS |
| `scripts/g4-routing-verify.mjs` | PASS |
| `scripts/g2-verify.mjs` | PASS |
| G3 core RPC/counts (SQL) | Owner 001 true, 002 false; mem 002=0; platform_roles=0; no EXTERNAL; no active grants |
| `npm run build` | PASS (`tenant-assert.server` bundled) |

G4A suite covers: forged tenant, forced insert, scoped update/delete, public slug, EXTERNAL+support grant rollback, sendSms shape, booking static guards, Twilio row counts.

---

## Migrations

**None** for G4A (application assertion only). G3 RLS unchanged.

---

## Supabase types

Type regeneration **deferred** (same as G3) — avoid unsafe credential/login changes.

Privileged G4A modules use `supabaseAdminUntyped` from `client.server.ts` (alias of the existing service-role client) because generated `Database` types omit G1–G4A `tenant_id` columns. This is not a new privilege boundary — only a typing bridge until `supabase gen types` is run safely.

---

## Rollback

1. `git checkout post-g4-tenant-routing` (or reset to `35e20ef`)  
2. Restore data from `backups/post-g4a-server-tenant-hardening-*` if needed  
3. Prior: `backups/post-g3-tenant-security-20260917T204824Z/`

---

## G5 dependencies

- Feature enforcement (`requireTenantFeature`) for Susan / booking / callback exposure on 002  
- Broader CRM privileged list hardening  
- Public 002 journey enablement only after features ready  

## Later Twilio dependencies

- Per-tenant Messaging / numbers / subaccounts  
- Inbound webhook tenant resolution from To-number mapping  
- Do **not** change Twilio resources until that gate  

---

## Confirmations

- Owner 001 access retained; 002 data denied  
- 002 memberships = 0; platform_roles = 0  
- Super Owner NOT started; MFA OFF  
- Twilio resources unchanged; no real SMS/calls in G4A  
- No EXTERNAL tenant persists  
- NO Azure deployment; NO git push; G5 NOT STARTED  
