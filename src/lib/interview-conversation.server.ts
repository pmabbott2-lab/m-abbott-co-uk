import { chatCompletion } from "@/lib/openai.server";
import { classifyTurn } from "@/lib/interview-classify.server";
import {
  BROKER_HANDOFF,
  HOLD_LINE,
  OPEN_FIELD_KEY,
  OPEN_OPTIONS,
  STATE_FIELD_KEY,
  beginJourneyLine,
  openingLine,
  parseSusanState,
  type SusanTalkState,
} from "@/lib/interview-opening";
import { findSection, resolveQuestionPrompt, type Question, type Section } from "@/lib/interview-script";

type Supa = { from: (table: string) => any };

export type ConvJson = {
  done: false;
  section: Section;
  sectionTitle: string;
  questionIndex: number;
  questionsInSection: number;
  fieldKey: string;
  fieldLabel: string;
  prompt: string;
  ack: string;
  sayText: string;
  followupCount: number;
  wizard?: Question["wizard"];
  options?: Array<{ value: string; label: string }>;
  keepListening?: boolean;
};

export type ConvResult =
  | { action: "respond"; json: ConvJson }
  | { action: "begin_journey" }
  | { action: "proceed" };

function londonNow(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date());
}

async function loadState(supabase: Supa, sessionId: string): Promise<SusanTalkState | null> {
  const { data } = await supabase
    .from("interview_answers")
    .select("field_key, value")
    .eq("session_id", sessionId);
  const row = (data ?? []).find((a: { field_key: string; value: string | null }) => a.field_key === STATE_FIELD_KEY);
  if (!row?.value) return null;
  return parseSusanState(row.value);
}

async function saveState(supabase: Supa, sessionId: string, state: SusanTalkState): Promise<void> {
  await supabase.from("interview_answers").upsert(
    {
      session_id: sessionId,
      section: "personal",
      field_key: STATE_FIELD_KEY,
      field_label: STATE_FIELD_KEY,
      value: JSON.stringify(state),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "session_id,section,field_key" },
  );
}

async function logTurn(
  supabase: Supa,
  sessionId: string,
  section: Section,
  role: "customer" | "avatar",
  text: string,
): Promise<void> {
  if (!text.trim()) return;
  await supabase.from("interview_messages").insert({
    session_id: sessionId,
    role,
    text,
    section,
  });
}

function progress(section: Section, index: number) {
  const sec = findSection(section)!;
  return {
    section,
    sectionTitle: sec.title,
    questionIndex: index,
    questionsInSection: sec.questions.length,
  };
}

function openingJson(firstName: string, section: Section, index: number): ConvJson {
  const sayText = openingLine(firstName);
  return {
    done: false,
    ...progress(section, index),
    fieldKey: OPEN_FIELD_KEY,
    fieldLabel: "Any questions before we start",
    prompt: sayText,
    ack: "",
    sayText,
    followupCount: 0,
    options: OPEN_OPTIONS,
    keepListening: true,
  };
}

function floorJson(
  sayText: string,
  section: Section,
  index: number,
  currentQ: Question | undefined,
  extras?: { options?: ConvJson["options"]; wizard?: Question["wizard"]; fieldKey?: string },
): ConvJson {
  return {
    done: false,
    ...progress(section, index),
    fieldKey: extras?.fieldKey ?? OPEN_FIELD_KEY,
    fieldLabel: currentQ?.label ?? "Any questions",
    prompt: sayText,
    ack: "",
    sayText,
    followupCount: 0,
    wizard: extras?.wizard,
    options: extras?.options,
    keepListening: true,
  };
}

async function answerAside(utterance: string): Promise<string> {
  try {
    const say = await chatCompletion({
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content:
            "You are Susan, a warm, intelligent British mortgage-fact-find assistant on a video call. " +
            "Answer the customer's question fully but briefly — one or two sentences. " +
            "Treat this as a real conversation: be helpful, human and specific. " +
            "Do not ask the next fact-find question. Do not say you are an AI. " +
            "Do not invent mortgage rates, products or live financial facts. " +
            "Do not give personalised financial advice. If they want a rate, product, or a recommendation, " +
            "say you cannot help with that yourself and that their adviser can when they arrange an appointment later. " +
            `The current UK date and time is ${londonNow()}.`,
        },
        { role: "user", content: utterance },
      ],
    });
    return say.trim() || "Happy to help with that.";
  } catch {
    return "Happy to help with that.";
  }
}

function afterAsideLine(answer: string, openQ: boolean): string {
  const pivot = openQ ? " Anything else before we start?" : " Anything else, or shall we carry on?";
  return `${answer.trim()}${pivot}`;
}

export async function maybeConversationalStep(opts: {
  supabase: Supa;
  sessionId: string;
  transcript: string;
  firstName: string;
  section: Section;
  index: number;
  currentQ: Question | undefined;
}): Promise<ConvResult> {
  const trimmed = opts.transcript.trim();
  let state = await loadState(opts.supabase, opts.sessionId);

  if (!trimmed) {
    if (!state || state.phase === "open_q") {
      state = { phase: "open_q", holding: false, awaitingContinue: false };
      await saveState(opts.supabase, opts.sessionId, state);
      const json = openingJson(opts.firstName, opts.section, opts.index);
      await logTurn(opts.supabase, opts.sessionId, opts.section, "avatar", json.sayText);
      return { action: "respond", json };
    }
    return { action: "proceed" };
  }

  if (!state) state = { phase: "open_q", holding: false, awaitingContinue: false };

  const currentPrompt = opts.currentQ
    ? `${opts.currentQ.label}. ${opts.currentQ.expects ?? resolveQuestionPrompt(opts.currentQ, {})}`
    : "opening questions";
  const openFloor = state.phase === "open_q";
  const kind = await classifyTurn(trimmed, currentPrompt, {
    holding: state.holding,
    openFloor,
    awaitingContinue: state.awaitingContinue,
  });

  const respond = async (json: ConvJson, next: SusanTalkState): Promise<ConvResult> => {
    await logTurn(opts.supabase, opts.sessionId, opts.section, "customer", trimmed);
    await saveState(opts.supabase, opts.sessionId, next);
    await logTurn(opts.supabase, opts.sessionId, opts.section, "avatar", json.sayText);
    return { action: "respond", json };
  };

  if (kind === "hold") {
    return respond(floorJson(HOLD_LINE, opts.section, opts.index, opts.currentQ), {
      ...state,
      holding: true,
      awaitingContinue: false,
    });
  }

  if (kind === "continue") {
    if (state.phase === "open_q") {
      await logTurn(opts.supabase, opts.sessionId, opts.section, "customer", trimmed);
      await saveState(opts.supabase, opts.sessionId, {
        phase: "journey",
        holding: false,
        awaitingContinue: false,
      });
      return { action: "begin_journey" };
    }
    const q = opts.currentQ;
    const prompt = q ? resolveQuestionPrompt(q, {}) : "Let's carry on.";
    const sayText = `Lovely. ${prompt}`;
    return respond(
      {
        done: false,
        ...progress(opts.section, opts.index),
        fieldKey: q?.key ?? OPEN_FIELD_KEY,
        fieldLabel: q?.label ?? "Continue",
        prompt,
        ack: "",
        sayText,
        followupCount: 0,
        wizard: q?.wizard,
        keepListening: !q?.options?.length && q?.wizard !== "credit" && q?.wizard !== "dependants",
      },
      { phase: "journey", holding: false, awaitingContinue: false },
    );
  }

  if (kind === "clarify") {
    if (state.holding) {
      return respond(floorJson(HOLD_LINE, opts.section, opts.index, opts.currentQ), {
        ...state,
        holding: true,
        awaitingContinue: false,
      });
    }
    if (state.phase === "open_q") {
      return respond(openingJson(opts.firstName, opts.section, opts.index), {
        phase: "open_q",
        holding: false,
        awaitingContinue: false,
      });
    }
    const q = opts.currentQ;
    const prompt = q ? resolveQuestionPrompt(q, {}) : openingLine(opts.firstName);
    return respond(
      {
        done: false,
        ...progress(opts.section, opts.index),
        fieldKey: q?.key ?? OPEN_FIELD_KEY,
        fieldLabel: q?.label ?? "Question",
        prompt,
        ack: "",
        sayText: `Of course. ${prompt}`,
        followupCount: 0,
        wizard: q?.wizard,
        keepListening: true,
      },
      { ...state, holding: false, awaitingContinue: false },
    );
  }

  if (kind === "regulated" || kind === "current" || kind === "general") {
    const answer =
      kind === "regulated" || kind === "current" ? BROKER_HANDOFF : await answerAside(trimmed);
    const sayText = afterAsideLine(answer, state.phase === "open_q");
    return respond(floorJson(sayText, opts.section, opts.index, opts.currentQ), {
      ...state,
      holding: false,
      awaitingContinue: true,
    });
  }

  if (state.phase === "open_q" || state.holding) {
    const answer = await answerAside(trimmed);
    const sayText = afterAsideLine(answer, state.phase === "open_q");
    return respond(floorJson(sayText, opts.section, opts.index, opts.currentQ), {
      ...state,
      holding: false,
      awaitingContinue: true,
    });
  }

  // Genuine fact-find answer — let the Hub journey save it.
  if (state.awaitingContinue) {
    await saveState(opts.supabase, opts.sessionId, {
      phase: "journey",
      holding: false,
      awaitingContinue: false,
    });
  }
  return { action: "proceed" };
}

export { beginJourneyLine };
