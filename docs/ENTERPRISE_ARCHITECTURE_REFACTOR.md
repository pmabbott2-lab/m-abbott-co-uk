# Mortgage Hub — Enterprise Architecture Refactor

**Status:** Architecture review & migration plan — **awaiting approval before implementation**  
**Date:** 2026-07-21  
**Author:** Lead Software Architect (AI-assisted review)  
**Codebase:** `/Users/petermabbott/Projects/m-abbott-co-uk-main`  
**Branch at review:** `targeted-features` @ `9eb23ed`

---

## Executive summary

Mortgage Hub is a **single-tenant, full-stack mortgage CRM** built on TanStack Start, React 19, and Supabase Postgres. It has mature features (AI fact-find, diary/booking, telephony, finance/commission, introducer portal, admin RBAC) but **no multi-tenant isolation**. Advisors and admins currently see all firm data; RLS policies use global role checks (`has_role(..., 'advisor')`), not organisation boundaries.

This document defines the target **enterprise SaaS platform architecture**, a phased migration plan, risks, and effort estimates. **No breaking changes should begin until this plan is approved.**

---

## 1. Architecture review

### 1.1 Current stack

| Layer | Technology | Notes |
|-------|------------|-------|
| Frontend | TanStack Start, React 19, TanStack Router, TanStack Query | File-based routing, SSR via Nitro |
| UI | Tailwind 4, shadcn/Radix | ~50 UI primitives |
| Backend | TanStack Start server functions (`createServerFn`) | 13 `*.functions.ts` modules, ~150 endpoints |
| Database | Supabase Postgres | 32 tables, 9 enums, 25 migrations |
| Auth | Supabase Auth (email, Google, MFA) | JWT + RLS + app-layer checks |
| Integrations | Twilio (SMS/voice), OpenAI, Microsoft Graph (Teams), getAddress.io, Simli | Server-only secrets |
| Storage | Supabase Storage (`avatars` bucket) | User-scoped paths only |
| Tests | **None** | No vitest/jest/playwright |

### 1.2 Current domain model (conceptual)

```
auth.users
  └── profiles, user_roles (customer | advisor | introducer | admin)
  └── admin_profiles + admin_permissions (owner | supervisor | general)
  └── advisor_profiles, introducers (company_code = intra-firm grouping, NOT tenant)

interview_sessions (cases / fact-finds) — central hub
  ├── interview_messages, interview_answers, advisor_notes
  ├── session_advisors (allocation, max 3)
  ├── session_contact_tracking, customer_contact_log, customer_journey_milestones
  ├── finance_fee_lines → finance_ledger
  └── appointments, phone_calls, callback_requests

introducers → introducer_leads, customer_introducer_links
referral_codes → referrals
```

**Key insight:** `interview_sessions` is the case/customer record hub. There is no separate `customers` or `cases` table — customers are `auth.users` with role `customer`, and cases are sessions.

### 1.3 Current auth & authorisation

| Concept | Implementation | Gap for SaaS |
|---------|----------------|--------------|
| App roles | `user_roles.role`: customer, advisor, introducer, admin | No platform super admin; roles not tenant-scoped |
| Admin levels | owner, supervisor, general + 14 permission keys | Owner bootstrapped via `ADMIN_EMAILS` env — single firm |
| Session MFA | TOTP (staff), SMS (customer/introducer) | OK; extend for tenant policies |
| Server auth | `requireSupabaseAuth` middleware → `{ userId, supabase, claims }` | No `tenantId` in context |
| API auth | `requireApiAuth()` on some routes | Twilio webhooks unauthenticated |
| Data access | Mix of RLS (reads) + `supabaseAdmin` (writes) | Service role bypasses all RLS |

### 1.4 Current RLS model (critical)

RLS is **role-based, not tenant-based**:

- Advisors can read **all** sessions, appointments, callbacks, contacts
- Admins inherit broad access
- Introducers scoped to own `introducer_id`
- Customers scoped to `customer_id = auth.uid()`
- Finance tables: RLS enabled with **no policies** → service role only

**This pattern is incompatible with multi-tenant SaaS without a full rewrite.**

### 1.5 Current application structure

```
src/
├── routes/           # Pages + API (monolithic home.tsx ~4,100 lines)
├── lib/              # Business logic (*.functions.ts + *.server.ts)
├── components/       # Flat feature + UI components
└── integrations/supabase/
```

**Natural server-side domains already exist:** sessions, booking, finance, referrals, introducer, telephony, teams, admin, auth.

**UI coupling:** `/home` and `/sessions/:id` bundle CRM, admin, finance, referrals into single route files.

### 1.6 Integrations & scoping today

| Integration | Scoped by | Multi-tenant concern |
|-------------|-----------|----------------------|
| Twilio SMS/Voice | Global env credentials | Per-tenant subaccounts or shared pool + tenant routing |
| OpenAI | Global API key | Per-tenant usage metering, rate limits |
| Microsoft Teams | Per-advisor OAuth tokens | OK pattern; tokens need `tenant_id` |
| getAddress.io | Global API key | Per-tenant or platform key |
| Supabase Storage | `avatars/{userId}/` | Needs `{tenantId}/{userId}/` prefix |

### 1.7 Security gaps (existing, pre-refactor)

1. `openAIChat` server function has **no auth middleware**
2. Twilio webhooks lack **signature validation**
3. Login SMS codes stored **in-memory** (not multi-instance safe)
4. Heavy reliance on **service role** bypasses RLS for most writes
5. `types.ts` is **stale** vs migrations (22 vs 32 tables)
6. No **audit log** for general platform actions (finance audit exists only)

---

## 2. Target architecture

### 2.1 Platform vision

Mortgage Hub becomes a **multi-tenant SaaS platform** where each **Organisation (Tenant)** is an isolated mortgage/protection/estate agency firm. The platform supports:

- Mortgage firms, networks, estate agencies, protection businesses
- White-labelled organisations (future)
- Third-party module marketplace (future)
- Platform super-administration

### 2.2 Core platform entities (new)

```sql
-- Identity & tenancy
tenants                    -- UUID PK, the organisation
tenant_memberships         -- user_id + tenant_id + role + status
tenant_settings            -- branding, email/SMS config, domain (future)
tenant_licences            -- starter | professional | enterprise | white_label
tenant_features            -- module flags per tenant (overrides licence defaults)
platform_users             -- users with is_platform_super_admin (or separate table)

-- Platform governance
platform_audit_log         -- all significant actions, tenant-scoped + platform-scoped
notifications              -- in-app notification queue
notification_preferences   -- per user per channel
notification_deliveries    -- email/SMS/push delivery log

-- Future marketplace (schema only, no implementation)
marketplace_modules        -- registry of installable modules
tenant_module_installs     -- which modules a tenant has enabled
```

### 2.3 Tenant isolation model

**Defence in depth — three layers:**

1. **Database:** `tenant_id UUID NOT NULL` on every business table; RLS enforces `tenant_id = current_tenant_id()`
2. **Application:** Every server function resolves `{ userId, tenantId, roles, permissions }` and rejects cross-tenant access
3. **API:** All HTTP routes validate tenant context; webhooks resolve tenant from phone number / subdomain / config

**JWT custom claims (recommended):**

```json
{
  "tenant_id": "uuid",
  "tenant_role": "organisation_owner",
  "platform_admin": false
}
```

Set via Supabase Auth hook on login; refreshed on tenant switch.

### 2.4 Role model (target)

| Role | Scope | Description |
|------|-------|-------------|
| **Platform Super Admin** | Platform | Create/suspend tenants, licences, modules, platform stats |
| **Organisation Owner** | Tenant | Full tenant control, billing, branding |
| **Organisation Administrator** | Tenant | User management, settings (no billing) |
| **Manager** | Tenant | Team oversight, allocations, reports |
| **Mortgage Adviser** | Tenant | Cases, diary, CRM (allocated) |
| **Compliance Officer** | Tenant | Read-heavy compliance, audit, journey |
| **Trainer** | Tenant | Learning academy (future module) |
| **Introducer** | Tenant | Own leads/referrals within tenant |
| **Customer** | Tenant | Own cases/bookings within tenant |

**Migration mapping:**

| Current | Target |
|---------|--------|
| `admin` + `owner` level | Organisation Owner (or Platform Super Admin if in platform allowlist) |
| `admin` + `supervisor` | Organisation Administrator |
| `admin` + `general` | Organisation Administrator (permission matrix preserved) |
| `advisor` | Mortgage Adviser |
| `introducer` | Introducer |
| `customer` | Customer |
| *(new)* | Manager, Compliance Officer, Trainer |

### 2.5 Licence & feature flag model

**Licence tiers** define default module bundles:

| Module | Starter | Professional | Enterprise | White Label |
|--------|---------|--------------|------------|-------------|
| CRM | ✓ | ✓ | ✓ | ✓ |
| Mortgage Pipeline | — | ✓ | ✓ | ✓ |
| AI Fact Find | ✓ | ✓ | ✓ | ✓ |
| AI Interview (voice/avatar) | — | ✓ | ✓ | ✓ |
| Compliance | — | — | ✓ | ✓ |
| Learning Academy | — | — | ✓ | ✓ |
| Document Management | — | ✓ | ✓ | ✓ |
| Messaging (SMS/voice) | ✓ | ✓ | ✓ | ✓ |
| Reporting | — | ✓ | ✓ | ✓ |
| Open Banking | — | — | ✓ | ✓ |
| ID Verification | — | — | ✓ | ✓ |
| Introducer Portal | — | ✓ | ✓ | ✓ |
| Recruitment | — | — | ✓ | ✓ |
| Training | — | — | ✓ | ✓ |

**Feature resolution:** `effective_features = licence_defaults ∪ tenant_feature_overrides`

**Implementation pattern:**

```typescript
// src/platform/features.ts
type FeatureKey = 'crm' | 'ai_fact_find' | 'ai_interview' | ...;

function requireFeature(tenantId: string, feature: FeatureKey): void;
function isFeatureEnabled(context: TenantContext, feature: FeatureKey): boolean;
```

Enforced in server functions and route guards. UI hides disabled modules.

### 2.6 Modular architecture (target)

```
src/
├── platform/                 # Cross-cutting: tenant context, features, audit, notifications
│   ├── tenant-context.server.ts
│   ├── features.server.ts
│   ├── audit.server.ts
│   └── notifications.server.ts
├── modules/
│   ├── auth/
│   ├── crm/
│   ├── fact-find/
│   ├── booking/
│   ├── telephony/
│   ├── finance/
│   ├── referrals/
│   ├── compliance/           # new (wraps journey, audit, GDPR)
│   ├── organisation/         # tenant settings UI
│   ├── platform-admin/       # super admin portal
│   └── reports/
├── integrations/             # Supabase, Twilio, OpenAI, etc.
├── components/ui/            # Shared UI kit
└── routes/                   # Thin route shells delegating to modules
```

Each module exports:
- `*.functions.ts` — server functions
- `components/` — UI
- `types.ts` — domain types
- `index.ts` — public API (prevents deep cross-imports)

### 2.7 White-labelling (architected, not implemented)

Store in `tenant_settings`:

- `display_name`, `logo_url`, `primary_colour`, `secondary_colour`
- `email_from_name`, `email_from_address`, `email_template_prefix`
- `custom_domain` (future), `login_page_slug` (future)
- `branding_json` for extensibility

Login flow: resolve tenant from subdomain/slug → load branding → render themed auth page.

### 2.8 Marketplace (architected, not implemented)

`marketplace_modules` registry with:
- `module_key`, `name`, `version`, `provider`, `webhook_url`, `config_schema`
- `tenant_module_installs`: enabled, config JSON, installed_at

Server functions call module hooks via internal event bus (future). No implementation in initial phases.

---

## 3. Database changes

### 3.1 New tables

| Table | Purpose |
|-------|---------|
| `tenants` | Organisation root: id (UUID), name, slug, status, licence_id, created_at |
| `tenant_memberships` | user_id, tenant_id, role, status, invited_by, joined_at |
| `tenant_settings` | tenant_id PK, branding, email/SMS config JSON |
| `licence_tiers` | starter/professional/enterprise/white_label definitions |
| `licence_features` | licence_id + feature_key (default modules) |
| `tenant_feature_overrides` | tenant_id + feature_key + enabled |
| `platform_audit_log` | tenant_id (nullable), user_id, action, resource, ip, metadata |
| `notifications` | tenant_id, user_id, type, title, body, read_at |
| `notification_preferences` | tenant_id, user_id, channel, enabled |

### 3.2 Tables requiring `tenant_id`

**All 32 existing business tables** plus new tables above.

Grouped by domain:

| Domain | Tables |
|--------|--------|
| **Identity** | profiles*, user_roles*, admin_profiles*, admin_permissions*, advisor_profiles, introducers, staff_invitations |
| **Cases** | interview_sessions, interview_messages, interview_answers, advisor_notes, session_advisors, session_contact_tracking, customer_contact_log, customer_journey_milestones, advisor_contact_views |
| **Booking** | appointments, advisor_availability, callback_requests |
| **Comms** | sms_messages, phone_calls |
| **Introducer** | introducer_leads, customer_introducer_links, introducer_amendment_history |
| **Referrals** | referral_codes, referrals |
| **Finance** | finance_fee_lines, finance_ledger, commission_rates, commission_rate_history, finance_settings, finance_audit_log |

*`profiles` and `user_roles` need careful design — users may belong to multiple tenants via `tenant_memberships`. Consider deprecating global `user_roles` in favour of tenant-scoped roles.*

### 3.3 Schema improvements (recommended alongside migration)

| Improvement | Rationale |
|-------------|-----------|
| **Per-tenant case ref sequence** | Replace global `case_ref_seq` with tenant-scoped sequences |
| **Composite indexes `(tenant_id, ...)`** | Every query filters by tenant first |
| **Partial indexes preserved** | e.g. `(tenant_id, starts_at) WHERE status='confirmed'` |
| **NOT NULL tenant_id** | After backfill; enforce via CHECK + FK |
| **Unified `customers` view/table** | Optional: materialise customer records per tenant for CRM clarity |
| **Soft-delete pattern** | Extend `deleted_at` consistently; add to more tables |
| **Regenerate `types.ts`** | After each migration phase |
| **Storage path convention** | `{tenant_id}/{user_id}/avatar.jpg` |
| **Webhook tenant routing table** | Map Twilio numbers → tenant_id |

### 3.4 RLS rewrite (every table)

Replace global `has_role(..., 'advisor')` with:

```sql
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid AS $$
  SELECT (auth.jwt() ->> 'tenant_id')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION is_tenant_member(_tenant_id uuid, _roles text[] DEFAULT NULL)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenant_memberships
    WHERE tenant_id = _tenant_id
      AND user_id = auth.uid()
      AND status = 'active'
      AND (_roles IS NULL OR role = ANY(_roles))
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;
```

Example policy:

```sql
CREATE POLICY "tenant_isolation_select" ON interview_sessions
  FOR SELECT USING (
    tenant_id = current_tenant_id()
    AND (
      customer_id = auth.uid()
      OR is_tenant_member(tenant_id, ARRAY['mortgage_adviser','manager','organisation_administrator','organisation_owner','compliance_officer'])
    )
  );
```

**Service role usage:** Restrict to platform-admin operations, webhooks (with tenant resolved), and background jobs. Business writes should use user JWT + RLS where possible.

### 3.5 Initial data migration (single tenant → multi-tenant)

Since there are no production users:

1. Create default tenant: `Mortgage Hub Demo` (or firm's real name)
2. Backfill `tenant_id` on all rows with default tenant UUID
3. Create `tenant_memberships` from existing `user_roles` + `admin_profiles`
4. Map `ADMIN_EMAILS` owner → Organisation Owner on default tenant
5. Seed licence tier (Enterprise for dev)

---

## 4. Authentication changes

### 4.1 Login flow (target)

1. User enters email/password (or OAuth)
2. Supabase Auth validates credentials
3. **Auth hook** (`custom_access_token_hook`): lookup `tenant_memberships`, set JWT claims
4. If user belongs to **multiple tenants**: show tenant picker; store selection in session
5. If **platform super admin**: additional claim `platform_admin: true`
6. Client stores active `tenant_id` in session/localStorage; sent on every server function call

### 4.2 Tenant resolution strategies

| Method | When | Priority |
|--------|------|----------|
| JWT claim | Authenticated requests | Primary |
| Subdomain `{slug}.mortgagehub.com` | Public booking, login | Future |
| Path prefix `/t/{slug}/book/...` | Public pages before custom domains | Phase 2 |
| Invite token | Staff/customer registration | Existing pattern extended |

### 4.3 Registration & invites

- **Staff invites:** `staff_invitations` gains `tenant_id`; invite URL includes tenant context
- **Customer signup:** Assign to tenant via booking slug, referral link, or invite
- **Platform admin creates tenant:** Provisions tenant + owner invite in one flow

### 4.4 MFA

Preserve existing MFA rules; allow tenant-level policy override (future):
- Force TOTP for all staff
- Optional SMS for customers

### 4.5 Server context (target)

Every authenticated handler receives:

```typescript
type RequestContext = {
  userId: string;
  tenantId: string;
  tenantRole: TenantRole;
  platformAdmin: boolean;
  features: Set<FeatureKey>;
  permissions: PermissionMatrix; // tenant-scoped admin permissions
  supabase: SupabaseClient;
};
```

Middleware chain: `requireSupabaseAuth` → `requireTenantContext` → `requireFeature(...)` → handler.

---

## 5. API changes

### 5.1 Server functions (~150 endpoints across 13 files)

Every function must:

1. Authenticate (except explicitly public endpoints)
2. Resolve and validate `tenantId`
3. Check role + permission + feature flag
4. Scope all queries with `.eq('tenant_id', tenantId)`
5. Write audit log entry for mutating operations

**Public endpoints (keep, add tenant resolution):**

| Function | Tenant resolution |
|----------|-------------------|
| `getAvailableSlots`, `createAppointment` | Introducer slug → tenant |
| `getLeadForBooking` | Lead + slug → tenant |
| `resolveReferralSlug` | Slug → tenant |
| `getStaffInvite` | Invite token → tenant |

**Fix immediately (security, pre-phase-1):**

| Endpoint | Issue |
|----------|-------|
| `openAIChat` | Add auth + tenant + feature check |
| Twilio webhooks | Add signature validation + tenant routing |
| `markStaffInviteUsed` | Verify JWT matches claimed userId |

### 5.2 HTTP API routes

| Route | Change |
|-------|--------|
| `/api/interview-step` | Validate session.tenant_id matches JWT tenant |
| `/api/tts`, `/api/stt`, `/api/avatar-token` | Require tenant + `ai_interview` feature |
| `/api/teams/callback` | OAuth state includes tenant_id |
| `/api/twilio/voice/*` | Signature validation; lookup tenant from phone number |
| `/api/sms/inbound` | Same |
| `/api/auth/request-password-reset` | Tenant-aware redirect URLs (future) |

### 5.3 New API areas (platform admin)

| Route | Purpose |
|-------|---------|
| `/platform/tenants` | CRUD tenants (super admin only) |
| `/platform/tenants/:id/licence` | Upgrade/downgrade |
| `/platform/tenants/:id/features` | Enable/disable modules |
| `/platform/stats` | Usage, storage, user counts |
| `/platform/audit` | Platform-wide audit log |

Implemented as server functions under `src/modules/platform-admin/`.

---

## 6. Frontend changes

### 6.1 New UI areas

| Area | Route | Audience |
|------|-------|----------|
| **Organisation settings** | `/settings/organisation` | Owner, Admin |
| **Branding** | `/settings/branding` | Owner (White Label licence) |
| **Team management** | `/settings/team` | Owner, Admin |
| **Licence & modules** | `/settings/licence` | Owner (view), Platform admin (edit) |
| **Platform admin portal** | `/platform/*` | Platform Super Admin only |
| **Tenant picker** | `/select-organisation` | Multi-tenant users |

### 6.2 Refactor existing UI

| Current | Action |
|---------|--------|
| `home.tsx` (~4,100 lines) | Split into module components; role-based dashboard routing |
| `sessions.$sessionId.tsx` (~1,660 lines) | Extract tab panels to `modules/sessions`, `modules/crm`, `modules/finance` |
| `admin-access.ts` permissions | Extend with tenant scope; map to new roles |
| `AdvisorViewBanner` | Preserve; tenant-scoped |
| Public booking `/book/:slug` | Resolve tenant from introducer slug |

### 6.3 Feature-gated navigation

App shell reads `effective_features` from server; hides nav items for disabled modules. Route `beforeLoad` guards call `requireFeature`.

### 6.4 White-label theming (future)

CSS variables loaded from `tenant_settings` at app init:
`--brand-primary`, `--brand-logo-url`, etc.

---

## 7. Audit logging

### 7.1 Central audit system

**Table:** `platform_audit_log`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| tenant_id | UUID | Nullable for platform-level actions |
| user_id | UUID | Actor |
| action | text | e.g. `appointment.created`, `tenant.suspended` |
| resource_type | text | e.g. `appointment`, `tenant` |
| resource_id | UUID | Affected record |
| ip_address | inet | From request headers |
| user_agent | text | Optional |
| metadata | jsonb | Before/after diff, extra context |
| created_at | timestamptz | |

### 7.2 Implementation

```typescript
// platform/audit.server.ts
async function auditLog(event: AuditEvent, context: RequestContext): Promise<void>;
```

Call from server functions on: create, update, delete, login, permission change, licence change, export, GDPR download.

Migrate existing `finance_audit_log` to write to central log (or sync both during transition).

---

## 8. Notifications framework

### 8.1 Design (central, module-agnostic)

```
Event (e.g. appointment.booked)
  → NotificationService.emit({ tenantId, userId, type, payload })
    → Check notification_preferences
    → Queue in notifications (in-app)
    → Dispatch email (future: tenant SMTP or platform relay)
    → Dispatch SMS (Twilio, tenant-scoped)
    → Push (future)
```

### 8.2 Phase 1 scope

- In-app notifications table + bell icon in AppShell
- Email for critical events (booking confirmation — already via SMS)
- SMS remains via existing Twilio integration

---

## 9. Security recommendations

| Area | Current | Recommendation | Phase |
|------|---------|----------------|-------|
| Tenant isolation | None | RLS + app layer + JWT claims | 1–2 |
| Service role abuse | Most writes bypass RLS | Reduce to webhooks/platform jobs | 2–3 |
| OpenAI proxy | Unauthenticated | Auth + tenant + rate limit | 0 (hotfix) |
| Twilio webhooks | No signature check | Validate `X-Twilio-Signature` | 0 (hotfix) |
| Secrets | Global `.env` | Tenant secrets in encrypted JSON; platform secrets in env/Vault | 4 |
| Teams tokens | AES-256-GCM | Keep; add tenant_id to storage | 2 |
| Session management | Supabase defaults | Review refresh token rotation, idle timeout | 3 |
| Rate limiting | None | Per-tenant API rate limits (edge middleware) | 3 |
| Input validation | Zod in server fns | Extend to all endpoints; centralise schemas | 1 |
| File storage | User-scoped | Tenant-scoped paths + RLS | 2 |
| Audit | Finance only | Central audit log | 2 |
| GDPR export | Exists | Tenant-scoped; audit the export | 2 |
| CSP / headers | Unknown | Add security headers in Nitro config | 3 |
| Dependency scanning | None | Add npm audit + Dependabot | 0 |

---

## 10. Performance recommendations

| Area | Recommendation | Phase |
|------|----------------|-------|
| **Indexes** | Composite `(tenant_id, ...)` on all high-traffic tables | 1 |
| **RLS functions** | Mark STABLE; avoid per-row subqueries where possible | 2 |
| **Query patterns** | Always filter `tenant_id` first; paginate list endpoints | 1 |
| **Caching** | Redis/Upstash for tenant settings, feature flags, licence (TTL 5 min) | 3 |
| **Background jobs** | Move AI transcription, report generation, email to queue (Supabase Edge / pg_cron / external) | 3 |
| **Lazy loading** | Split `home.tsx` bundles; route-level code splitting (partially exists) | 2 |
| **Connection pooling** | Supabase pooler for server functions | 1 |
| **Read replicas** | Supabase read replica for reporting queries (Enterprise tier) | 5 |
| **Storage CDN** | Supabase CDN for tenant assets/logos | 4 |
| **OpenAI** | Batch requests; cache TTS for repeated phrases | 3 |
| **List endpoints** | Cursor pagination instead of full table scans | 2 |

**Scale targets:**

| Metric | Design assumption |
|--------|-------------------|
| Organisations | 10,000+ |
| Users | 100,000+ |
| Customer records | Millions (sessions + profiles) |
| Documents | Large object storage per tenant (future module) |
| AI usage | Metered per tenant; queue under load |

---

## 11. Code quality recommendations

| Area | Current | Target |
|------|---------|--------|
| Folder structure | Flat `lib/` + `components/` | `modules/` + `platform/` |
| Largest files | home.tsx 4,100 lines; sessions.functions.ts 3,400 lines | Max ~400 lines per file |
| Types | Stale generated types | Auto-regenerate in CI |
| Testing | None | Unit tests for permissions, features, pure logic; integration tests for RLS |
| DI | Direct imports | Tenant context injected via middleware |
| Error handling | Ad-hoc `throw new Error` | Typed error codes + consistent HTTP mapping |
| Documentation | Partial (`docs/`) | Per-module README + ADRs |
| CI | Unknown | Build + lint + test + migration check on PR |

---

## 12. Migration plan

### Phase 0 — Pre-work (no breaking changes)

**Goal:** Safety net + quick security fixes.

- [ ] Approve this document
- [ ] Regenerate Supabase types
- [ ] Fix `openAIChat` auth
- [ ] Add Twilio webhook signature validation
- [ ] Add baseline tests for `admin-access`, auth middleware
- [ ] Document current behaviour (smoke test checklist)

**Exit criteria:** Build passes; smoke tests documented; security hotfixes deployed.

---

### Phase 1 — Platform foundation

**Goal:** Tenant model exists; single default tenant; no user-visible change.

- [ ] Create `tenants`, `tenant_memberships`, `tenant_settings`, licence tables
- [ ] Add nullable `tenant_id` to all 32 tables
- [ ] Backfill default tenant for all existing data
- [ ] Set `tenant_id NOT NULL`
- [ ] Add composite indexes
- [ ] Create `current_tenant_id()` and `is_tenant_member()` functions
- [ ] Seed default tenant + memberships from existing roles
- [ ] Add `requireTenantContext` middleware (reads JWT claim or default tenant)
- [ ] Update all server functions to pass `tenant_id` in queries (app layer only; RLS unchanged yet)

**Exit criteria:** All data has tenant_id; server functions filter by tenant; app behaves identically.

---

### Phase 2 — RLS & auth hardening

**Goal:** Database-enforced tenant isolation.

- [ ] Implement Supabase Auth hook for JWT `tenant_id` claim
- [ ] Rewrite RLS policies on all 32 tables
- [ ] Reduce `supabaseAdmin` usage (audit each call site)
- [ ] Add `platform_audit_log` + audit middleware
- [ ] Tenant-scoped storage paths + policies
- [ ] Per-tenant case ref sequences

**Exit criteria:** Cross-tenant query returns zero rows in tests; audit log captures mutations.

---

### Phase 3 — Roles, licences & feature flags

**Goal:** Entitlement system live.

- [ ] Expand role enum / tenant_memberships roles
- [ ] Map existing roles to new model
- [ ] Implement licence tiers + feature resolution
- [ ] Add `requireFeature()` guards to server functions
- [ ] Feature-gated UI navigation
- [ ] Organisation settings page (name, basic settings)

**Exit criteria:** Disabled module is inaccessible via API and UI; licence change takes effect without deploy.

---

### Phase 4 — Platform admin & organisation management

**Goal:** Super admin can manage tenants; org owners manage their firm.

- [ ] Platform admin portal (`/platform/*`)
- [ ] Create / suspend / delete tenant
- [ ] Upgrade / downgrade licence; enable / disable modules
- [ ] Platform usage stats (user counts, storage, API usage)
- [ ] Organisation settings (team, branding placeholders)
- [ ] Tenant picker for multi-org users

**Exit criteria:** New tenant can be provisioned end-to-end without SQL manual steps.

---

### Phase 5 — Modular refactor & notifications

**Goal:** Maintainable codebase; central notifications.

- [ ] Split `home.tsx` and `sessions.$sessionId.tsx` into modules
- [ ] Split oversized `*.functions.ts` files
- [ ] Extract `modules/*` with public `index.ts` APIs
- [ ] In-app notification framework
- [ ] Background job queue for AI/reports

**Exit criteria:** No route file > 500 lines; module boundaries enforced by lint rule.

---

### Phase 6 — Scale, white-label & marketplace prep

**Goal:** Production SaaS readiness.

- [ ] Caching layer (tenant settings, features)
- [ ] Rate limiting per tenant
- [ ] Custom domain routing (white label)
- [ ] Marketplace schema + module registry (no third-party installs yet)
- [ ] Read replica routing for reports
- [ ] Per-tenant Twilio subaccount support (optional)
- [ ] Comprehensive test suite + load testing

**Exit criteria:** Load test to target scale; white-label theming demo on second tenant.

---

## 13. Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| RLS rewrite introduces data leaks | Medium | Critical | Automated cross-tenant tests; security review per table; staged rollout |
| Service role bypass undermines RLS | High | Critical | Inventory all `supabaseAdmin` calls; reduce in Phase 2 |
| Breaking existing booking/introducer flows | Medium | High | Public routes get tenant resolution tests; keep slug compatibility |
| JWT claim hook breaks login | Medium | High | Feature flag; fallback to default tenant during dev |
| Performance regression from RLS | Medium | Medium | Composite indexes; EXPLAIN ANALYZE on hot queries |
| Scope creep (marketplace, white-label) | High | Medium | Strict phase gates; architect only until Phase 6 |
| No automated tests | High | High | Phase 0 baseline tests; RLS tests mandatory in Phase 2 |
| Stale types cause runtime errors | Medium | Medium | Regenerate types in CI on every migration |
| Multi-tenant user confusion | Low | Medium | Clear tenant picker UX |
| Twilio/OpenAI cost attribution | Medium | Low | Per-tenant usage metering in Phase 4 |

---

## 14. Recommended implementation order

```
Phase 0 (security + tests)
    ↓
Phase 1 (tenant_id columns + app-layer scoping)
    ↓
Phase 2 (RLS rewrite + audit log)     ← critical path
    ↓
Phase 3 (licences + feature flags)
    ↓
Phase 4 (platform admin + org settings)
    ↓
Phase 5 (modular refactor + notifications)
    ↓
Phase 6 (scale + white-label + marketplace prep)
```

**Parallel tracks (after Phase 1):**
- UI module extraction (Phase 5) can start once feature flags exist (Phase 3)
- Security hardening (rate limits, caching) can proceed alongside Phase 4

**Do not start:** Marketplace installs, custom domains, Open Banking, ID Verification modules until core tenancy is proven.

---

## 15. Estimated development effort

Estimates assume 1 senior full-stack developer, familiar with the codebase. No production migration complexity (no live users).

| Phase | Scope | Estimate | Calendar |
|-------|-------|----------|----------|
| **Phase 0** | Security hotfixes, types, baseline tests | 3–5 days | Week 1 |
| **Phase 1** | Tenant schema, backfill, app-layer scoping | 2–3 weeks | Weeks 2–4 |
| **Phase 2** | RLS rewrite (32 tables), auth hook, audit | 3–4 weeks | Weeks 5–8 |
| **Phase 3** | Roles, licences, feature flags, org settings v1 | 2–3 weeks | Weeks 9–11 |
| **Phase 4** | Platform admin portal, tenant provisioning | 2–3 weeks | Weeks 12–14 |
| **Phase 5** | Modular refactor, notifications | 3–4 weeks | Weeks 15–18 |
| **Phase 6** | Scale, caching, white-label prep, load tests | 3–4 weeks | Weeks 19–22 |
| **Total** | | **18–26 weeks** | **~5–6 months** |

With 2 developers (1 backend/DB focus, 1 frontend): **12–16 weeks**.

Ongoing after launch: marketplace, Open Banking, ID Verification, Learning Academy are separate product phases (+4–8 weeks each).

---

## 16. Future roadmap (post-refactor)

| Horizon | Capability |
|---------|------------|
| **Q1 post-launch** | Custom domains, full white-label login, email templates per tenant |
| **Q2** | Marketplace MVP (install/config third-party modules); Open Banking module |
| **Q3** | ID Verification; Document Management; Compliance module |
| **Q4** | Learning Academy; Recruitment; Training modules |
| **Ongoing** | Mobile app (push notifications); API for third-party developers; network/hierarchy (parent tenant → child firms) |

### Network / hierarchy (future)

Some customers (networks) need **parent-child tenant relationships**:

```
Network Tenant (HLP)
  ├── Firm Tenant A
  ├── Firm Tenant B
  └── Firm Tenant C
```

Architect now with optional `parent_tenant_id` on `tenants` (nullable, unused until needed).

---

## 17. Approval checklist

Before implementation begins, please confirm:

- [ ] Target role model approved (Section 2.4)
- [ ] Licence tiers and module list approved (Section 2.5)
- [ ] Phase order approved (Section 14)
- [ ] Single default tenant approach OK for dev (Section 3.5)
- [ ] `tenant_memberships` replaces global `user_roles` (Section 3.2)
- [ ] Platform admin access model (env allowlist vs separate auth)
- [ ] Effort estimate acceptable (Section 15)
- [ ] Phase 0 security hotfixes can proceed immediately

**Once approved, implementation will proceed one phase at a time with build verification and change summaries after each phase.**

---

## Appendix A — Complete table inventory

| # | Table | Needs tenant_id | Has RLS today |
|---|-------|-----------------|---------------|
| 1 | profiles | ✓ | ✓ |
| 2 | user_roles | ✓ (or replace) | ✓ |
| 3 | interview_sessions | ✓ | ✓ |
| 4 | interview_messages | ✓ | ✓ |
| 5 | interview_answers | ✓ | ✓ |
| 6 | advisor_notes | ✓ | ✓ |
| 7 | session_advisors | ✓ | ✓ |
| 8 | advisor_profiles | ✓ | ✓ |
| 9 | advisor_availability | ✓ | ✓ |
| 10 | staff_invitations | ✓ | ✓ |
| 11 | introducers | ✓ | ✓ |
| 12 | introducer_leads | ✓ | ✓ |
| 13 | customer_introducer_links | ✓ | ✗ |
| 14 | introducer_amendment_history | ✓ | ✗ |
| 15 | appointments | ✓ | ✓ |
| 16 | sms_messages | ✓ | ✓ |
| 17 | callback_requests | ✓ | ✓ |
| 18 | phone_calls | ✓ | ✓ |
| 19 | session_contact_tracking | ✓ | ✓ |
| 20 | customer_contact_log | ✓ | ✓ |
| 21 | advisor_contact_views | ✓ | ✓ |
| 22 | customer_journey_milestones | ✓ | ✓ |
| 23 | referral_codes | ✓ | ✓ |
| 24 | referrals | ✓ | ✓ |
| 25 | admin_profiles | ✓ | ✓ |
| 26 | admin_permissions | ✓ | ✓ |
| 27 | finance_fee_lines | ✓ | ✓ (no policies) |
| 28 | finance_ledger | ✓ | ✓ (no policies) |
| 29 | commission_rates | ✓ | ✓ (no policies) |
| 30 | commission_rate_history | ✓ | ✗ |
| 31 | finance_settings | ✓ | ✗ |
| 32 | finance_audit_log | ✓ | ✗ |

## Appendix B — Server function modules

| File | ~Functions | Primary domain |
|------|------------|----------------|
| sessions.functions.ts | 46 | Cases, CRM, staff, journey |
| booking.functions.ts | 29 | Appointments, callbacks, contacts |
| finance.functions.ts | 17 | Fees, commission, ledger |
| referrals.functions.ts | 13 | RAF, introducer referrals |
| telephony.functions.ts | 8 | Voice, GDPR export |
| introducer.functions.ts | 7 | Introducer portal |
| admin.functions.ts | 6 | Admin access matrix |
| introducer-customer.functions.ts | 5 | Customer attribution |
| teams-calendar.functions.ts | 4 | Microsoft calendar |
| test-accounts.functions.ts | 4 | Dev tooling |
| address.functions.ts | 3 | getAddress.io |
| auth.functions.ts | 3 | Login SMS codes |
| openai.functions.ts | 2 | OpenAI proxy |

## Appendix C — Key files referenced

| Path | Relevance |
|------|-----------|
| `src/integrations/supabase/auth-middleware.ts` | Auth middleware to extend |
| `src/lib/admin-access.ts` | Permission model to extend |
| `src/routes/_authenticated/route.tsx` | Auth gate to extend |
| `supabase/bootstrap-from-scratch.sql` | Core schema + RLS patterns |
| `supabase/migrations/` | 25 migration files |
| `src/lib/sessions.functions.ts` | Largest server module |
| `src/routes/_authenticated/home.tsx` | Largest UI file |
