# Super Owner MFA recovery (break-glass)

**Status:** Design only · **not** operationalised until MFA gates are authorised  
**Related:** `docs/MULTI_TENANT_PHASE0.md` (MFA / Super Owner addendum)  
**Designated Super Owner email (migration identity only):** `pmabbott2@aol.com`

**Never store in this document:** passwords, TOTP secrets, recovery codes, service-role keys, JWTs, or dashboard credentials.

---

## 1. Purpose

Recover platform access when the Mortgage Hub **Super Owner** cannot complete normal TOTP login because:

- phone lost or replaced  
- authenticator app deleted  
- TOTP device unavailable  
- MFA enrolment corrupted  
- verified factor exists but codes cannot be completed  

This is an **administrative Auth recovery**, not an application-level MFA bypass.

---

## 2. Principles

| Principle | Rule |
|-----------|------|
| No app bypass | Hub must **not** ship a “skip MFA” button or secret URL that grants Super Owner without Auth MFA reset |
| Identity first | Verify the **legitimate** Super Owner before any factor reset |
| Auth is source of truth | Reset factors via **Supabase Auth Admin** controls (Dashboard and/or server `auth.admin` APIs with service role — server-only) |
| Audit | Log who authorised recovery, when, and which `auth.users.id` was affected (never log secrets) |
| Re-prove | After reset: re-enrol TOTP → verify → full sign-out → fresh password + TOTP → re-check platform + tenants 001/002 |
| Separated layers | Recovery restores **who** (Auth MFA). It does not grant tenant access by itself — `platform_roles.super_owner` remains the **what** |

---

## 3. Preconditions

Before any reset:

1. Confirm `platform_roles` still lists `super_owner` for the expected `auth.users.id` (UUID), not merely the email string in the UI.  
2. Confirm the Auth user email still matches the designated Super Owner migration identity (or an approved identity change recorded in audit).  
3. Confirm at least one **other** trusted operator can observe the recovery (four-eyes preferred): e.g. another platform Super Admin with documented authority, or a documented out-of-band approval from the business owner.  
4. Prefer working from a **known-good** device and network; revoke unknown Auth sessions after recovery.

---

## 4. Identity verification (before MFA reset)

Use **multiple** out-of-band checks. Suggested checklist (adapt to live ops policy):

| Check | Pass criteria |
|-------|----------------|
| Email ownership | Control of the Super Owner mailbox (challenge message / confirmation reply) |
| Live identity | Video or in-person confirmation with known Peter (or designated successor) |
| Knowledge | Confirm expected Hub behaviours / recent privileged actions only the Super Owner would know (no passwords asked over chat) |
| Device | Agree which authenticator will be enrolled next |
| Written approval | Short signed/email approval: “Reset MFA for user_id … reason … date …” stored outside git |

**Do not proceed** if identity cannot be established. Prefer temporary platform lockdown over an unverified reset.

---

## 5. Administrative MFA reset procedure

### 5.1 Preferred path — Supabase Dashboard (Auth)

1. Open the Supabase project Auth → Users.  
2. Locate the Super Owner by **UUID** (primary) / email (secondary).  
3. Review existing MFA factors (TOTP).  
4. Using Auth Admin UI capabilities for that project version: **remove / unenroll** the verified TOTP factor(s) for that user.  
5. Optionally revoke active sessions for that user so stale `aal2` JWTs cannot be reused.  
6. Record an audit entry (see §7).

### 5.2 Alternate path — Auth Admin API (server-only)

If Dashboard controls are insufficient:

1. From a **server-only** environment with `SUPABASE_SERVICE_ROLE_KEY` (never from a browser).  
2. List MFA factors for the user via Auth Admin MFA APIs.  
3. Delete the verified (and any dangling unverified) factors for that `user_id`.  
4. Sign the user out / revoke sessions via Auth Admin.  
5. Record audit entry.

Exact Admin API method names follow current Supabase Auth docs at implementation time — do not hard-code obsolete SDK calls in runbooks without re-checking docs.

### 5.3 Explicitly forbidden

- Disabling MFA globally for all users to “get Peter back in”  
- Hard-coding Super Owner email checks in the frontend to skip AAL2  
- Shipping a permanent “recovery code” in application config or git  
- Sharing service-role keys over chat or committing them  

---

## 6. Post-recovery re-enrolment (mandatory)

After factors are cleared, the Super Owner account returns to password-capable `aal1` with no verified factor:

1. Super Owner signs in with email/password (AAL1).  
2. Completes TOTP enrolment (QR → authenticator → verify code).  
3. Confirms session reaches **AAL2**.  
4. **Signs out completely**.  
5. Fresh login: password → TOTP challenge → AAL2 session.  
6. Verifies:  
   - Mortgage Hub platform root  
   - Tenant **001** Mortgage Easy  
   - Tenant **002** Trent Valley FS  
7. Confirms `platform_roles.role = super_owner` still resolves (no dependency on `tenant_memberships`).  
8. Close the recovery ticket with timestamps.

Until steps 1–7 pass, **do not** re-enable mandatory MFA enforcement for Super Owner if it was temporarily relaxed during a controlled recovery window (prefer: leave enforcement on for others; only the recovered account is factorless briefly — see §8).

---

## 7. Audit requirements

Write a durable audit row (application `security_audit_events` or equivalent) and keep the out-of-band approval artefact:

| Field | Example |
|-------|---------|
| event_type | `mfa_reset_recovery` |
| subject_user_id | Super Owner UUID |
| acting_operator | Operator UUID / name |
| timestamp | UTC |
| reason | Short free text |
| method | `dashboard` \| `auth_admin_api` |
| outcome | `success` \| `aborted` |

Also log subsequent: `mfa_enrolled`, `mfa_verified` (login), privileged access checks as designed in Phase 0.

**Never log:** TOTP secrets, QR payloads, passwords, recovery codes, service-role keys.

---

## 8. Interaction with mandatory MFA enforcement

| Situation | Behaviour |
|-----------|-----------|
| Enforcement ON + no verified factor | User must complete enrolment before privileged Hub surfaces (enrolment journey), not a silent bypass |
| Recovery mid-flight | Brief window where Super Owner has password but no factor — minimise duration; complete §6 same day |
| Never | Deploy a state where MFA is mandatory for the **only** Super Owner **before** successful enrolment has been verified |

If a second Super Owner (or break-glass Super Admin with documented rights) exists, prefer that account to perform Auth Admin recovery without relaxing enforcement flags.

---

## 9. Interaction with backups

| Artefact | Contains TOTP / password hashes? | Restores MFA? |
|----------|----------------------------------|---------------|
| Immediate logical dump (`backups/pre-phase1-immediate-baseline-…`) | **No** | **No** |
| Offline auth metadata JSON | Emails/ids only | **No** |
| Supabase Pro platform backup / PITR | Includes Auth schema state for that restore point | **Yes** (for that point in time) |

Restoring the **logical public dump alone** does **not** restore MFA factors.  
If Auth/MFA is lost and platform backup restore is undesirable, use **this recovery procedure** + re-enrolment (§6).

---

## 10. Success criteria

Recovery is complete only when:

- [ ] Identity verification recorded  
- [ ] Old factors removed via Auth Admin  
- [ ] New TOTP enrolled and verified  
- [ ] Fresh MFA login succeeds (AAL2)  
- [ ] Platform root + tenants 001 and 002 accessible as Super Owner  
- [ ] Audit events written  
- [ ] No secrets written to git or this runbook  

---

## 11. Related gates

See `MULTI_TENANT_PHASE0.md` gates **G7–G10**: Super Owner conversion, MFA capability, Super Owner enrolment, mandatory enforcement — each separately verifiable. Do not collapse into one irreversible step.
