
# Mortgage Fact-Find Avatar App — Build Plan

## What we're building
A mobile-friendly web app where a mortgage customer signs in, taps "Start interview", and is guided through a spoken fact-find by an on-screen avatar. The avatar asks each question aloud, the customer answers with their voice, the answer is transcribed, and an AI moves to the next question. Each interview is saved as a separate session that the customer (and their advisor) can review later. Advisors see a dashboard listing every customer's sessions with a clean structured summary of the answers.

## Core experience

**Customer side**
- Sign up / log in (email + password, plus Google).
- Home screen: list of past interview sessions + big "Start new interview" button.
- Interview screen: animated avatar, current question shown as text + spoken, mic button to record answer, live transcript, "Next" auto-advances.
- End of interview: summary of captured answers, option to edit any field, submit to advisor.

**Advisor side**
- Separate login (role = advisor).
- Dashboard: table of customers and their sessions (status: in-progress / submitted, date, completeness %).
- Session detail page: structured answers grouped by section, raw transcript, ability to add notes.

## Sections covered in v1
1. Personal & contact details (name, DOB, address, marital status, dependants)
2. Employment & income (employer, role, salary, self-employed accounts)
3. Outgoings & credit (monthly expenses, debts, credit history)
4. Property & mortgage need (purchase price, deposit, type, term, purpose)

The AI follows a scripted question list per section but can ask brief follow-ups when an answer is unclear, then extracts structured fields from the conversation.

## Technical approach (for reference)

- **Stack**: TanStack Start (existing), Lovable Cloud for auth + database + storage.
- **Auth**: Email/password + Google. `profiles` table + `user_roles` table (`customer`, `advisor`) with `has_role()` security-definer for RLS.
- **Database**:
  - `interview_sessions` (id, customer_id, status, started_at, submitted_at, completeness)
  - `interview_messages` (id, session_id, role: avatar/customer, text, audio_url, created_at)
  - `interview_answers` (id, session_id, section, field_key, value_json) — structured fields extracted by the AI
  - `advisor_notes` (id, session_id, advisor_id, note, created_at)
  - RLS: customers see only their own rows; advisors see all (via `has_role`).
- **AI**: Lovable AI Gateway.
  - STT: `openai/gpt-4o-mini-transcribe` for customer speech.
  - LLM: `google/gemini-3-flash-preview` drives the question flow + structured extraction (Output.object schema per section).
  - TTS: `openai/gpt-4o-mini-tts` (voice: `alloy`) streams the avatar's spoken question.
  - All AI calls in TanStack server routes / server functions; `LOVABLE_API_KEY` stays server-side.
- **Avatar**: animated SVG/Lottie-style talking head that lip-syncs to audio output volume (no third-party avatar SDK in v1). If you'd later prefer a photoreal avatar (HeyGen, D-ID, Ready Player Me), we can swap that layer in.
- **Routing**:
  - `/auth` — login/signup
  - `/_authenticated/` — customer home, `/interview/$sessionId` — live interview, `/sessions/$sessionId` — review
  - `/_authenticated/_advisor/dashboard`, `/sessions/$sessionId` (shared, role-gated)
- **Design**: calm, trustworthy financial-services feel — soft neutrals, deep navy primary, generous spacing, large tap targets, clear progress indicator across sections.

## What's out of scope for v1
- Document upload (payslips, ID) — easy to add next.
- E-signature / DIP submission.
- Multi-language.
- Photoreal avatar provider integration.
- SMS/email notifications to the advisor.

## Suggested build order
1. Enable Lovable Cloud, set up auth + roles + tables.
2. Design system + shell (auth screen, customer home, advisor dashboard skeleton).
3. Interview engine: question script, server route for next-question + extraction.
4. Voice layer: TTS streaming for avatar, mic capture + STT for customer.
5. Animated avatar component with speaking state.
6. Session review + advisor session detail + notes.
7. Polish: progress bar, edit-answer flow, empty/error states.

Reply with any tweaks (e.g. swap voice, change sections, add document upload) and I'll start building.
