export const OPEN_FIELD_KEY = "open_questions";
export const STATE_FIELD_KEY = "__susan_state";

export type SusanPhase = "open_q" | "journey";

export type SusanTalkState = {
  phase: SusanPhase;
  holding: boolean;
  awaitingContinue: boolean;
};

export const DEFAULT_SUSAN_STATE: SusanTalkState = {
  phase: "open_q",
  holding: false,
  awaitingContinue: false,
};

export function isInternalAnswerKey(key: string | undefined | null): boolean {
  return Boolean(key && (key === STATE_FIELD_KEY || key.startsWith("__susan")));
}

export function isOpeningPhase(state: SusanTalkState | null | undefined): boolean {
  return (state?.phase ?? "open_q") === "open_q";
}

export function openingLine(firstName: string): string {
  const hi = firstName ? `Hi ${firstName}, I'm Susan.` : "Hi, I'm Susan.";
  return `${hi} Before we start, have you got any questions for me?`;
}

export function beginJourneyLine(firstName: string, firstPrompt: string): string {
  const start = firstName
    ? `Lovely, ${firstName}. Let's get your adviser up to speed.`
    : "Lovely. Let's get your adviser up to speed.";
  return `${start} ${firstPrompt}`;
}

/** Spoken for rates, products, or personal advice — keep people in the fact-find. */
export const BROKER_HANDOFF =
  "That's something I can't help you with, but your adviser would definitely be able to help you with that when we arrange your appointment later. What I can do is give you a lending calculation at the end, as part of your summary.";

export const HOLD_LINE = "Of course — go ahead.";

export const OPEN_OPTIONS = [
  { value: "No", label: "No, let's start" },
  { value: "Yes", label: "Yes, I have a question" },
];

export function parseSusanState(raw: string | null | undefined): SusanTalkState {
  if (!raw?.trim()) return { ...DEFAULT_SUSAN_STATE, phase: "open_q" };
  try {
    const parsed = JSON.parse(raw) as Partial<SusanTalkState>;
    return {
      phase: parsed.phase === "journey" ? "journey" : "open_q",
      holding: Boolean(parsed.holding),
      awaitingContinue: Boolean(parsed.awaitingContinue),
    };
  } catch {
    if (raw === "journey") return { phase: "journey", holding: false, awaitingContinue: false };
    return { ...DEFAULT_SUSAN_STATE };
  }
}
