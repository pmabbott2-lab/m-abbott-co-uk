# Hybrid voice + tap interview

Two changes to make the interview feel more natural.

## 1. Open the mic before Susan finishes speaking

Right now the mic only starts recording once the TTS audio's `onended` fires, so anyone who answers a beat early gets cut off.

- In `src/components/Avatar.tsx` (`useAudioPlayback`), expose a `onNearEnd` callback (or a `nearEndMs` option) that fires when the audio is ~700ms from finishing.
- In `src/routes/_authenticated/interview.$sessionId.tsx`, start the recorder when `onNearEnd` fires instead of after `play()` resolves. Keep playback running; only stop the recorder on the user's silence trigger as today.
- Guard against double-starts if the user is already speaking.

## 2. Tap-to-select for closed questions, voice for soft facts

Today every question is voice-only. We'll classify each question and render the right input.

### Question type system

In `src/lib/interview-script.ts`, add an optional `input` field on `Question`:

```ts
type ChoiceOption = { value: string; label: string };
type InputSpec =
  | { kind: "voice" }                                       // current behaviour
  | { kind: "single"; options: ChoiceOption[] }             // radio buttons
  | { kind: "multi"; options: ChoiceOption[] }              // checkboxes
  | { kind: "composite"; fields: Array<                     // mix of taps + one voice slot
      | { key: string; label: string; kind: "single"; options: ChoiceOption[] }
      | { key: string; label: string; kind: "voice"; prompt?: string }
    > };
```

Default remains `{ kind: "voice" }` so nothing breaks.

### Mapping current questions

| Question | New input |
|---|---|
| `personal:full_name` | voice |
| `personal:date_of_birth` | voice |
| `personal:home` | voice (house name/number, street, town, postcode, years there) |
| `personal:family` | composite — single-select marital status (Single / Married / Civil partnership / Cohabiting / Divorced / Separated / Widowed), single-select dependants count (None / 1 / 2 / 3 / 4+), then voice slot for "names and ages" (only shown when dependants > 0) |
| `employment:work` | composite — single-select employment status (Employed / Self-employed / Contractor / Retired / Other), voice slot for employer, job title, time in role, gross annual income |
| `employment:retirement_income` | voice |
| `outgoings:outgoings_credit` | composite — voice slot for essentials £/month, single-select "Any credit/loans?" (Yes / No) + voice slot for monthly amount when Yes, single-select "Adverse credit in last 6 yrs?" (Yes / No) + voice slot for details when Yes |
| `property:mortgage_need` | composite — single-select purpose (First-time buyer / Next home / Remortgage / Buy-to-let), single-select property type (Flat / Terraced / Semi-detached / Detached), voice slot for price, deposit, term |

### UI

New component `src/components/QuestionInput.tsx`:
- Renders Susan's prompt and the appropriate control(s).
- For `single`/`multi`: shadcn `RadioGroup` / `Checkbox` cards, large tap targets, "Continue" button.
- For `composite`: stacked cards — each tap field uses radios; each voice field shows a Record button + live transcript area, reusing the existing recorder hook.
- On submit, assembles a single answer string (e.g. `"Marital status: Married. Dependants: 2. Names/ages: Alice 6, Ben 4"`) so the existing evaluator/fact-find pipeline keeps working unchanged.

In `interview.$sessionId.tsx`:
- Branch on `question.input.kind`: voice-only keeps current flow; choice/composite renders `<QuestionInput />` and skips the evaluator loop (we already have the structured answer — submit straight to `submitAnswer`).
- Susan still speaks the prompt; for composite, mic opens (near-end of TTS) only when the active sub-field is a voice slot.

### Evaluator

`src/lib/interview-evaluator.server.ts` doesn't need new logic — structured answers already satisfy its fact gates (purpose, property type, marital status, dependants count, employment status, credit yes/no). We only keep the evaluator engaged for the remaining voice slots, so the recent loop fixes still apply.

## Out of scope

- No changes to fact-find storage, lender calc, or auth.
- No redesign of the session list or summary pages.
