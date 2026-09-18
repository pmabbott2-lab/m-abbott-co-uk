# Gate G5 — Tenant features, journeys & link enforcement

**Status:** Complete (local; not pushed; not Azure-deployed)  
**Branch:** `targeted-features`  
**Base:** `post-g4a-server-hardening` → `45eb958`  
**Tag:** `post-g5-tenant-features`  
**Verify:** `node --env-file=.env scripts/g5-features-verify.mjs`

G1–G4A remain in force. **G6 / Super Owner / MFA / Twilio subaccounts / staging deploy NOT started.**

---

## Preflight backup reconciliation

| Checkpoint | Tables | Rows | Auth meta |
|------------|--------|------|-----------|
| G3 `post-g3-…204824Z` | 60 | 135 | 6 |
| G4A `post-g4a-…091055Z` | 51 | 120 | 6 |

**Verdict: A — backup script/scope difference (NOT data loss).**

Evidence:

- Common tables: **identical row counts** (0 diffs).
- G4A omitted 9 tables present in G3 and still live:  
  `lender_remortgage_policies`, `network_commission_lines`, `platform_mfa_policy`, `platform_restore_points`, `security_audit_events`, `super_admin_tenant_access`, `tenant_comms_config`, `tenant_settings`, `view_as_audit_log`.
- Those 9 tables accounted for **15 rows** in G3 (= 135−120).
- Live `public` base tables = **60**. Auth users = 6. No G4A migrations.

Post-G5 backups restore the **full 60-table** G3 scope.

---

## Feature resolution semantics

Matches `public.is_tenant_feature_enabled`:

1. If `tenant_features` row exists → `state === 'enabled'`
2. Else if catalogue `default_enabled` → enabled
3. Else → **false** (fail closed)

States other than `enabled` fail closed for public/API (no entitlement detail leakage).

**001 continuity:** catalogue defaults are mostly `false`. G5 migration seeds **001** operational features to `enabled` (except `password_recovery`, which stays on catalogue default `true`). **002 is not mass-enabled** — only explicit `susan_ai_journey=disabled`; other keys resolve off via defaults.

Feature enabled **never** replaces membership / RLS / G4A tenant assertion.

---

## Catalogue (24 keys)

| Key | Category | Default | 001 | 002 | G5 enforce |
|-----|----------|---------|-----|-----|------------|
| susan_ai_journey | customer_journey | false | enabled | disabled | **Critical** UI+API |
| susan_chat_journey | customer_journey | false | enabled | off | createSession chat + routes |
| appointment_booking | customer_journey | false | enabled | off | book routes + server |
| request_callback | customer_journey | false | enabled | off | callback server |
| external_website_links | public_access | false | enabled | off | shell link (needs URL) |
| introducer_journey | customer_journey | false | enabled | off | ref/resolve |
| refer_a_friend | customer_journey | false | enabled | off | RAF share + URLs |
| customer_portal | customer_journey | false | enabled | off | session create |
| telephone_voice | integration | false | enabled | off | telephony manage |
| public_hub_landing | public_access | false | enabled | off | tenant landing CTAs |
| customer_case_hub | customer_journey | false | enabled | off | (portal+cases; RLS) |
| staff_diary / staff_crm / staff_cases / staff_finance / staff_marketing_scripts / journey_analytics / view_as / relationship_pipeline | staff_* | false | enabled | off | finance wired; others ready via helper |
| teams_calendar | integration | false | enabled | off | assertion+feature later depth |
| mortgage_calculator_public | public_access | false | enabled | off | branding only if no lead |
| introducer_calculator_lead | customer_journey | false | enabled | off | lead API |
| password_recovery | public_access | **true** | default on | default on | do not block retained accounts |
| sms_notifications | comms | false | enabled | off | capability before SMS workflows |

---

## Architecture

| Layer | Module |
|-------|--------|
| Server | `src/lib/tenant-features.server.ts` — `isTenantFeatureEnabled`, `requireTenantFeature`, `getTenantFeatureFlags`, `resolveFeatureTenantId` |
| Susan APIs | `src/lib/susan-feature-guard.server.ts` |
| URLs | `src/lib/tenant-url.ts` — `buildTenantPath` / `buildTenantUrl` / canonical book/raf/ref |
| UI | `TenantPresentation.features` + `susanEnabled` |

Chain: **tenant assertion AND feature enabled**.

---

## Journey results (summary)

- **Susan 001:** enabled; landing CTA; APIs guarded; session create requires feature + tenant_id.
- **Susan 002:** disabled; no CTA; API/session with 002 context DENY; no ME fallback.
- **Susan chat:** independent key; 001 on / 002 off.
- **Booking:** `/$tenantSlug/book/$introducerSlug`; legacy `/book/$slug` resolves introducer→tenant→canonical redirect; G4A asserts remain.
- **Callback / RAF / introducer / calculator lead:** feature + tenant forced.
- **External website:** feature + configured URL only; 002 null → no invent.
- **Telephony/SMS:** UI/capability gated; **Twilio transport unchanged**.
- **Staff:** outer feature gate on finance + telephony manage; role/RLS remain inner.
- **Password recovery:** remains available via default_enabled.
- **Platform `/`:** not controlled by tenant `public_hub_landing`.

### Legacy links

| Route | Class |
|-------|-------|
| `/book/$slug` | **A/B** — resolve introducer tenant; redirect canonical; feature deny if off |
| `/go/$slug`, `/raf/$code` | **B** — retain; tenantise generated links; feature on RAF actions |
| `/auth`, `/register`, `/api/*` platform | **D** — flat platform |
| `/$tenantSlug/...` | Canonical |

Never: unknown resource → 001.

---

## Migration

`20260918103000_gate_g5_seed_001_operational_features` (applied remotely).

---

## Tests / regression

| Suite | Result |
|-------|--------|
| g5-features-verify | PASS |
| g4a-server-hardening-verify | PASS |
| g4-routing-verify | PASS |
| npm run build | PASS |

No real SMS/calls/emails/Teams invites sent.

---

## 002 regulatory gaps (before production-ready)

Populate for Trent Valley (do **not** copy 001): FCA / legal / privacy / contact / `website_url` / telephone / complete branding assets.

---

## Type debt

`supabaseAdminUntyped` bridge: **13** modules. Cleanup item: regenerate Supabase `Database` types and remove temporary untyped admin bridges.

---

## Staging readiness

**STAGING READY: NO**

Blockers for a separate staging gate:

1. Twilio still global (001 numbers; no 002 isolation)
2. Microsoft Graph/Teams still shared
3. 002 regulatory/contact/website gaps
4. 002 memberships = 0 (no staff/customer for E2E without fixtures)
5. Stale generated types / untyped bridge
6. Some staff navigation feature gates still thinner than finance/telephony
7. Staging secrets/webhooks/callbacks environment not provisioned

Code is feature-enforcement capable locally; staging is a **separate explicit gate**.

---

## Rollback

1. `git checkout post-g4a-server-hardening`
2. Revert migration seed if needed (delete 001 feature rows except susan, or restore backup)
3. Backup: `backups/post-g5-tenant-features-*` (full 60-table scope)

---

## Deferred

- **G6:** Company Settings feature editor, provisioning, Super Owner wizard  
- **Twilio gate:** per-tenant transport/numbers/webhooks  
- Full staff-nav feature wiring parity  
