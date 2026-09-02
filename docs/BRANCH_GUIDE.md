# Branch navigation guide — signed-off spec

Status: **Approved for rebuild** (2026-09-02).  
Restore before work: `restore-point-2026-09-02-post-branch-rebuild`.

---

## Decisions (confirmed)

| # | Question | Decision |
|---|----------|----------|
| 1 | Diary placement | **Top-level Diary** for advisors and owner/supervisor/admin. Two sub-tabs: **Diary** (own or filtered) and **All appointments** (forward-looking grid, admin only). |
| 2 | Commission mgmt | Under **Finance** (not a separate top tab). |
| 3 | Owner finance report | Under **Finance** (owner-only third sub-area). |
| 4 | Introducers tab | Inline portal content (no link-out). **Management → Manage** holds admin introducer management for non-introducer admins. |
| 5 | Dual advisor/admin roles | **Not used** — no combined-role landing logic required. |
| 6 | General admin, customers-only | **Single Customers top tab** only (sub-tabs they are permitted). |
| 7 | Owner as customer / IT builder | **Test accounts only** for role testing. Owner production account stays staff-only. Test provisioning moves to IT builder when multi-tenant; then removed from firm-facing UI. |

---

## Branch tree

```
STAFF PLATFORM (/home)
│
├── CUSTOMERS                    [customers permission]
│   ├── Customers                case / fact-find list
│   ├── Contacts                 callbacks & attention [appointments]
│   └── Relationship             renewals pipeline [relationship]
│
├── DIARY                        [advisors + owner/supervisor/admin]
│   ├── Diary / My diary         own diary (advisor) or filtered advisor diary (admin)
│   └── All appointments         forward-looking grid across advisors [admin only]
│
├── MANAGEMENT                   [admin + relevant permissions]
│   ├── Commission statements    per-advisor statements [owner/supervisor/advisors perm]
│   ├── View                     advisor / introducer / customer view [owner/supervisor]
│   ├── Manage                   team roles, invites, RAF, test accounts [invites/raf/advisors]
│   └── Admin access             permission matrix [owner/supervisor]
│
├── INTRODUCERS                  [isIntroducer — inline portal UI]
│
└── FINANCE
    ├── My commission            [isAdvisor only — not owner/supervisor/admin dashboards]
    │   ├── Summary              monthly / annual + exports
    │   └── Pipeline             Month / YTD / L12M + detail + exports
    ├── Commission mgmt          payout queue [finance_* permissions]
    └── Finance report           owner-only ledger

CUSTOMER PLATFORM (/home when !isAdvisor)
├── Talk · Type · Book (journey — unchanged)
├── Your summary / cases
└── Refer a friend (when applicable)

NOT on staff dashboard: Spoken, Type, Book-as-customer header actions.
```

---

## Role visibility matrix

| Branch | Owner | Supervisor | General admin | Advisor | Introducer |
|--------|:-----:|:----------:|:-------------:|:-------:|:----------:|
| Customers → Customers | ✓ | ✓ | if `customers` | ✓ | — |
| Customers → Contacts | ✓ | ✓ | if `appointments` | ✓ | — |
| Customers → Relationship | ✓ | ✓ | if `relationship` | — | — |
| Diary (own) | — | — | — | ✓ | — |
| Diary (filtered + all appointments) | ✓ | ✓ | if `advisors`/`appointments` | — | — |
| Management → View | ✓ | ✓ | — | — | — |
| Management → Manage → Team roles | ✓ | ✓ | if `advisors`/`introducers` | — | — |
| Management → Admin access | ✓ | ✓ | — | — | — |
| Introducers (inline) | ✓† | ✓† | if `introducers`† | — | ✓ |
| Finance → My commission | — | — | — | ✓ | ✓ |
| Finance → Commission statements | ✓ | ✓ | if `advisors` | — | — |
| Finance → Commission mgmt | ✓ | ✓ | if `finance_*` | — | — |
| Finance → Finance report | ✓ | — | — | — | — |
| Customer journey | — | — | — | — | — |

\*Owners and supervisors use the top-level **Diary** tab (filtered + all appointments) or **Management → View → Advisor view**, not advisor-only UI.  
†Top **Introducers** tab only when user has introducer role; admin management of introducers is under **Management → Manage → Team roles**.

### General admin — customers-only example

If you grant a general admin **customers** permission only, they see the **Customers** top tab (and permitted sub-tabs). Use `13@test.co.uk` and set permissions in **Admin access**.

---

## Test accounts (owner-provisioned)

Provision via **Management → Manage → Test accounts** (after rebuild).

| Email | Role | Purpose |
|-------|------|---------|
| 1–3@test.co.uk | Introducer | Introducer portal / referrals |
| 4–5@test.co.uk | Advisor | Advisor diary, customers, commission |
| 6–12@test.co.uk | Customer | Journey (Talk / Type / Book) |
| **13@test.co.uk** | **General admin** | **Branch nav QA — allocate permissions via Admin access** |

Password: `TestHub2026!` · Phone: `07123456789`

---

## Rebuild phases

1. **Tab shell + routing** — done (2026-09-02). See `src/lib/staff-branch-nav.ts` and `src/components/staff/StaffBranchTabs.tsx`.
2. **Move panels into sub-tabs** — done (2026-09-02). Panels live under `src/components/staff/panels/`; staff dashboard in `StaffDashboard.tsx`; customer home slimmed in `home.tsx`.
3. **Introducer inline; remove portal hop** — done (2026-09-02). Top **Introducers** tab for real introducer accounts only. Owner/supervisor use **Management → Introducer view** (full portal, not read-only). **Management → Advisors → Advisor view** embeds customers, diary link, and commission. Both view-as modes log actions to a scrollable audit panel with export; **Exit** is at the bottom of the page.
4. Split My commission → Summary / Pipeline — done (2026-09-02). `MyCommissionBranchPanel` with Summary (monthly/annual + export) and Pipeline (Month/YTD/L12M + detail + exports) under **Finance → My commission**.
5. Diary relocate + admin advisor filter — done (2026-09-02). Top-level **Diary** with **Diary** and **All appointments** sub-tabs. `AdvisorDiaryPanel` + `AllAppointmentsGridPanel` via `DiaryTabsPanel`. `/diary` route reuses the same tabs. **Team roles** moved to **Management → Manage**.
6. Remove staff journey CTAs — done (2026-09-02). No Spoken, Type, or Customer booking in the staff dashboard header. Advisors get **Customer booking** under **Customers** tab only. Owner/supervisor use test accounts or **Management → View → Advisor view** for booking workflows.
7. Role QA + export regression — done (2026-09-02). Automated checks in `scripts/qa-phase7.ts` (`npm run test:qa`): role visibility matrix + export mapper regression.

Tag restore point before phase 1 if not already on `restore-point-2026-09-02-post-enhancements`.

### Automated QA (phase 7)

```bash
npm run test:qa
```

Covers role visibility (owner, supervisor, advisor, introducer, general admin perm variants) and export mapper regression (invalid dates, column alignment).

### Manual smoke checklist

| Account | Verify |
|---------|--------|
| Owner | Customers · Diary (2 tabs) · Management · Finance; no Spoken/Type in header; Team roles under Manage |
| `4@test.co.uk` (advisor) | My diary only; My commission under Finance; Customer booking under Customers |
| `13@test.co.uk` (general admin) | After granting `customers` only in Admin access → single Customers tab |
| `1@test.co.uk` (introducer) | Introducers tab only; referral export works |

### Interim Manage sub-tabs (under Management → Manage)

Manage sub-tabs via `src/components/ManageTabPanel.tsx` and `MANAGE_SUB_TABS`:

| Sub-tab id | Label | Who sees it |
|------------|-------|-------------|
| `team-roles` | Team roles | Owner / supervisor / `advisors` or `introducers` permission |
| `colour-scheme` | Colour scheme | Owner |
| `test-accounts` | Test accounts | Owner |
| `invites` | Invites | `invites` permission |
| `refer-a-friend` | Refer a friend | `raf` permission |

```
Management branch
├── Commission statements | per-advisor commission [owner/supervisor/advisors perm]
├── View              advisor / introducer / customer view
├── Manage            team-roles | colour-scheme | test-accounts | invites | refer-a-friend
└── Admin access
```

---

## Colour schemes (theme profiles)

Ten firm colour schemes in **Manage → Colour scheme** (owner). Default: **MortgageEasy** (navy + green).

| Profile | Use case |
|---------|----------|
| MortgageEasy | Brokerage demo — matches marketing site |
| Classic Hub | Original warm cream / amber |
| Midnight … Arctic | Alternative firm branding |

Stored in browser localStorage now. **Multi-tenant:** one `theme_profile_id` per firm from IT builder / firm settings.

See `src/lib/theme-profiles.ts` and `src/theme-profiles.css`.

---

## Future: multi-tenant & IT builder

- Test account provisioning is **temporary** for single-firm demo/training.
- Multi-tenant: move test/seed tooling to **IT builder** (platform operator), not firm owner UI.
- Do not add owner-as-customer preview; use test accounts only.
