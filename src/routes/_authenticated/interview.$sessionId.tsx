import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getSession, submitSession, setSessionPosition } from "@/lib/sessions.functions";
import { AppShell } from "@/components/AppShell";
import { useAudioPlayback } from "@/components/Avatar";
import { Avatar3D } from "@/components/Avatar3D";
import { PostCompletionBooking } from "@/components/PostCompletionBooking";
import {
  getSpeechRecognitionCtor,
  isBrowserSttSupported,
  isOpenAIQuotaError,
  preferBrowserSpeech,
  type BrowserSpeechRecognition,
} from "@/lib/browser-speech";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Pause, Play, ArrowLeft, Undo2, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { totalQuestions, questionIndexGlobal, getQuestion, findSection, prevStep, SECTIONS, ACKNOWLEDGEMENTS, ackClip, firstGreeting, firstNameFromFullName, type Section, type AnswersMap } from "@/lib/interview-script";
import {
  CREDIT_TYPES,
  parseCount,
  buildCreditSummary,
  ordinal,
  buildDependantsSummary,
  type CreditFlow,
  type DependantFlow,
} from "@/lib/interview-wizards";

export const Route = createFileRoute("/_authenticated/interview/$sessionId")({
  component: InterviewPage,
});

interface StepResp {
  done: boolean;
  section?: Section;
  sectionTitle?: string;
  questionIndex?: number;
  questionsInSection?: number;
  fieldKey?: string;
  fieldLabel?: string;
  prompt?: string;
  ack?: string;
  sayText?: string;
  wizard?: "credit" | "dependants";
}

// Voice-activity detection thresholds (tuned for snappier turn-taking)
const SILENCE_MS = 1100;
const MAX_TURN_MS = 45000; // hard cap per answer
const NO_SPEECH_TIMEOUT_MS = 12000; // if nothing detected at all, stop
const MAX_SILENT_RETRIES = 4; // silently re-listen this many times before prompting
const CALIBRATION_MS = 500; // measure ambient noise floor at start
const SPEECH_ON_MULT = 1.8; // RMS must exceed noiseFloor * this to count as speech
const SPEECH_OFF_MULT = 1.25; // below noiseFloor * this counts as silence (hysteresis)
const MIN_SPEECH_RMS = 0.006; // absolute floor for speech-on
const MIN_SILENCE_RMS = 0.005; // absolute ceiling for silence
const MIN_SPEECH_MS = 250; // require this much cumulative speech before allowing end

/** Reveal text up to the spoken fraction, snapping to whole words for a clean read. */
function revealByProgress(text: string, p: number): string {
  if (!text || p >= 1) return text;
  if (p <= 0) return "";
  const target = Math.ceil(text.length * p);
  if (target >= text.length) return text;
  const nextSpace = text.indexOf(" ", target);
  return text.slice(0, nextSpace === -1 ? text.length : nextSpace);
}

function buildPromptText(section: Section, index: number, firstName?: string) {
  const sectionDef = findSection(section);
  const question = getQuestion(section, index);
  if (!sectionDef || !question) return "";
  const personalise = (text: string) =>
    firstName ? text.replace(/\{firstName\}/g, firstName) : text.replace(/,?\s*\{firstName\}/g, "");
  if (section === "personal" && index === 0) {
    return personalise(firstGreeting(firstName, question.prompt));
  }
  return personalise(`${sectionDef.intro} ${question.prompt}`);
}

function asSusan(text: string) {
  return text.replace("Hi! I'll guide you", "Hi, I'm Susan. I'll guide you");
}

function InterviewPage() {
  const { sessionId } = Route.useParams();
  const navigate = useNavigate();
  const getSessionFn = useServerFn(getSession);
  const submitFn = useServerFn(submitSession);
  const setPositionFn = useServerFn(setSessionPosition);
  const getAuthToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);
  const { play, prefetch, playing, progress: speechProgress, stop: stopPlayback, unlock, getAmplitude, usingBrowserVoice } = useAudioPlayback(getAuthToken);

  const sessionQ = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => getSessionFn({ data: { sessionId } }),
  });

  // First name from the login profile — drives Susan's personalised greeting and
  // prompts (we no longer ask the customer for their name).
  const profileFirstName = firstNameFromFullName(sessionQ.data?.customer?.full_name);

  const [current, setCurrent] = useState<StepResp | null>(null);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [done, setDone] = useState(false);
  const [paused, setPaused] = useState(false);
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState<string>("Starting…");
  const [needsGesture, setNeedsGesture] = useState(false);
  const [consented, setConsented] = useState(false);
  const [lastHeard, setLastHeard] = useState("");
  // When the current question offers tappable choices, we wait for a tap
  // instead of listening on the microphone.
  const [optionsActive, setOptionsActive] = useState(false);
  // Credit-commitments wizard state (multi-select + per-item branches).
  const [credit, setCredit] = useState<CreditFlow | null>(null);
  // Dependants wizard state (count, then per-child name & age).
  const [dependants, setDependants] = useState<DependantFlow | null>(null);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const bootedRef = useRef(false);
  const noSpeechHandledRef = useRef(false);
  const silentRetryRef = useRef(0);
  // Authoritative copy of the credit wizard for use inside async callbacks.
  const creditRef = useRef<CreditFlow | null>(null);
  const dependantsRef = useRef<DependantFlow | null>(null);
  // When set, the next transcript is delivered here instead of to callStep.
  const pendingTranscriptRef = useRef<((text: string) => void) | null>(null);
  // Ensures we only open the mic once per question (it can be pre-armed ~1s
  // before Susan finishes speaking so quick answers aren't clipped).
  const listenArmedRef = useRef(false);
  // Use OpenAI transcription by default; only switch to the browser engine
  // permanently once OpenAI's quota is exhausted for this session.
  const forceBrowserSttRef = useRef(false);
  const pausedRef = useRef(false);
  const doneRef = useRef(false);
  const currentRef = useRef<StepResp | null>(null);

  pausedRef.current = paused;
  doneRef.current = done;
  currentRef.current = current;

  const stopRecognition = () => {
    try {
      recognitionRef.current?.abort();
    } catch {
      /* ignore */
    }
    recognitionRef.current = null;
  };

  const cleanupAudio = (stopTracks = true) => {
    stopRecognition();
    if (rafRef.current) window.clearInterval(rafRef.current);
    rafRef.current = null;
    if (stopTracks) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  };

  const normaliseStep = (data: StepResp): StepResp => {
    if (data.done) return data;
    const section = (data.section ?? "personal") as Section;
    const index = data.questionIndex ?? 0;
    const sectionDef = findSection(section);
    const question = getQuestion(section, index);
    return {
      ...data,
      section,
      sectionTitle: data.sectionTitle ?? sectionDef?.title ?? section,
      questionIndex: index,
      questionsInSection: data.questionsInSection ?? sectionDef?.questions.length ?? 0,
      fieldKey: data.fieldKey ?? question?.key,
      fieldLabel: data.fieldLabel ?? question?.label,
      prompt: data.prompt ?? question?.prompt,
      wizard: data.wizard ?? question?.wizard,
    };
  };

  const relistenWithPrompt = async () => {
    if (pausedRef.current || doneRef.current) return;
    setStatus("Susan is speaking…");
    try {
      await play("Sorry, I didn't quite catch that. Could you say that again?");
    } catch {
      /* browser/openai may both fail — still re-listen */
    }
    if (!pausedRef.current && !doneRef.current) startListening();
  };

  // Browsers (esp. Chrome) fire `no-speech` after only a few seconds. Rather
  // than nagging the user immediately, quietly keep listening a few times so
  // they have plenty of time to start speaking.
  const handleNoSpeech = () => {
    if (pausedRef.current || doneRef.current) return;
    if (silentRetryRef.current < MAX_SILENT_RETRIES) {
      silentRetryRef.current += 1;
      setStatus("Listening… take your time");
      void startListening();
    } else {
      silentRetryRef.current = 0;
      void relistenWithPrompt();
    }
  };

  const getStepOptions = (step: StepResp | null) => {
    if (!step || step.done || !step.section || step.questionIndex == null) return null;
    const q = getQuestion(step.section, step.questionIndex);
    if (!q?.options?.length) return null;
    return {
      options: q.options,
      allowOther: q.allowOther ?? false,
      otherLabel: q.otherLabel ?? "Other",
      otherPrompt: q.otherPrompt ?? "No problem — please describe it in your own words.",
    };
  };

  // Open the mic at most once per question (guarded so the early pre-arm and
  // the post-speech call don't double-start it).
  const startListeningOnce = () => {
    if (listenArmedRef.current) return;
    if (pausedRef.current || doneRef.current) return;
    listenArmedRef.current = true;
    void startListening();
  };

  // Pre-arm the mic ~1s before Susan stops, but only for spoken-answer steps
  // (tap options and the credit wizard wait for a tap instead).
  const armListenEarly = (step: StepResp | null) => {
    if (pausedRef.current || doneRef.current) return;
    if (step?.wizard === "credit" || step?.wizard === "dependants" || getStepOptions(step)) return;
    startListeningOnce();
  };

  // After Susan finishes a question, either start a wizard, show tap options,
  // or open the mic.
  const beginInputForStep = (step: StepResp | null) => {
    if (pausedRef.current || doneRef.current) return;
    if (step?.wizard === "credit") {
      startCreditSelect();
    } else if (step?.wizard === "dependants") {
      startDependants();
    } else if (getStepOptions(step)) {
      setOptionsActive(true);
      setStatus("Tap the option that best fits");
    } else {
      startListeningOnce();
    }
  };

  // Customer tapped one of the preset choices.
  const chooseOption = (value: string) => {
    if (thinking || transcribing) return;
    setOptionsActive(false);
    void callStep(value);
  };

  // Customer tapped "Other" — Susan asks them to describe it, then we listen
  // (pre-arming the mic just before she finishes so quick answers aren't clipped).
  const chooseOther = async (otherPrompt: string) => {
    if (thinking || transcribing) return;
    setOptionsActive(false);
    setStatus("Susan is speaking…");
    listenArmedRef.current = false;
    try {
      await play(otherPrompt, { onNearEnd: () => startListeningOnce(), leadMs: 1000 });
    } catch {
      /* ignore playback failure — still listen */
    }
    startListeningOnce();
  };

  // ---- Credit-commitments wizard ----
  const setCreditState = (next: CreditFlow | null) => {
    creditRef.current = next;
    setCredit(next);
  };

  const say = async (text: string) => {
    setStatus("Susan is speaking…");
    try {
      await play(text);
    } catch {
      /* ignore playback failure */
    }
  };

  const startCreditSelect = () => {
    setOptionsActive(false);
    pendingTranscriptRef.current = null;
    setCreditState({ phase: "select", selected: [], typeIdx: 0, count: 0, itemIdx: 0, entries: [] });
    setStatus("Tap each that applies, then tap Continue");
  };

  const toggleCreditType = (key: string) => {
    const c = creditRef.current;
    if (!c || c.phase !== "select") return;
    const selected = c.selected.includes(key)
      ? c.selected.filter((k) => k !== key)
      : [...c.selected, key];
    setCreditState({ ...c, selected });
  };

  const creditNone = () => {
    setCreditState(null);
    void callStep("No ongoing credit commitments.");
  };

  const creditContinue = () => {
    const c = creditRef.current;
    if (!c) return;
    if (!c.selected.length) return creditNone();
    setCreditState({ ...c, typeIdx: 0, entries: [] });
    void askCreditCount();
  };

  const askCreditCount = async () => {
    const c = creditRef.current;
    if (!c) return;
    const key = c.selected[c.typeIdx];
    if (key === "other") return askCreditOther();
    const t = CREDIT_TYPES.find((x) => x.key === key);
    setCreditState({ ...c, phase: "count" });
    await say(`You've told me you have a ${t?.noun ?? "commitment"}. How many ${t?.plural ?? "of those"} do you have?`);
    setStatus("Tap how many you have");
  };

  const onCreditCount = (n: number) => {
    const c = creditRef.current;
    if (!c) return;
    setCreditState({ ...c, phase: "amount", count: n, itemIdx: 1 });
    void askCreditAmount();
  };

  // "More" — let them say a larger number.
  const creditCountMore = async () => {
    await say("How many exactly?");
    setStatus("Say how many");
    pendingTranscriptRef.current = (text) => onCreditCount(parseCount(text) ?? 1);
    if (!pausedRef.current && !doneRef.current) void startListening();
  };

  const askCreditAmount = async () => {
    const c = creditRef.current;
    if (!c) return;
    const key = c.selected[c.typeIdx];
    const t = CREDIT_TYPES.find((x) => x.key === key);
    const label = c.count > 1 ? `${t?.noun ?? "commitment"} number ${c.itemIdx}` : `the ${t?.noun ?? "commitment"}`;
    await say(`What's the monthly payment, and the balance left, on ${label}?`);
    setStatus("Say the monthly payment and the balance");
    pendingTranscriptRef.current = (text) => onCreditAmount(text);
    if (!pausedRef.current && !doneRef.current) void startListening();
  };

  const onCreditAmount = (text: string) => {
    const c = creditRef.current;
    if (!c) return;
    const key = c.selected[c.typeIdx];
    const t = CREDIT_TYPES.find((x) => x.key === key);
    const entries = [...c.entries, { typeKey: key, label: t?.label ?? "Other", index: c.itemIdx, detail: text }];
    if (c.itemIdx < c.count) {
      setCreditState({ ...c, entries, itemIdx: c.itemIdx + 1 });
      void askCreditAmount();
    } else {
      setCreditState({ ...c, entries, typeIdx: c.typeIdx + 1, count: 0, itemIdx: 0 });
      void nextCreditType();
    }
  };

  const nextCreditType = async () => {
    const c = creditRef.current;
    if (!c) return;
    if (c.typeIdx < c.selected.length) return askCreditCount();
    return finishCredit();
  };

  const askCreditOther = async () => {
    const c = creditRef.current;
    if (!c) return;
    setCreditState({ ...c, phase: "other" });
    await say("Please describe the other credit, including the monthly payment and the balance left.");
    setStatus("Describe the other credit");
    pendingTranscriptRef.current = (text) => {
      const cc = creditRef.current;
      if (!cc) return;
      const entries = [...cc.entries, { typeKey: "other", label: "Other", index: 1, detail: text }];
      setCreditState({ ...cc, entries, typeIdx: cc.typeIdx + 1 });
      void nextCreditType();
    };
    if (!pausedRef.current && !doneRef.current) void startListening();
  };

  const finishCredit = () => {
    const c = creditRef.current;
    if (!c) return;
    const summary = buildCreditSummary(c.entries);
    setCreditState(null);
    void callStep(summary);
  };

  // ---- Dependants wizard ----
  const setDependantsState = (next: DependantFlow | null) => {
    dependantsRef.current = next;
    setDependants(next);
  };

  const startDependants = () => {
    setOptionsActive(false);
    pendingTranscriptRef.current = null;
    setDependantsState({ phase: "count", count: 0, itemIdx: 0, entries: [] });
    setStatus("Tap how many dependants you have");
  };

  const dependantsNone = () => {
    setDependantsState(null);
    void callStep("No dependants.");
  };

  const onDependantCount = (n: number) => {
    if (n <= 0) return dependantsNone();
    setDependantsState({ phase: "detail", count: n, itemIdx: 1, entries: [] });
    void askDependantDetail();
  };

  // "More" — let them say a larger number.
  const dependantCountMore = async () => {
    await say("How many exactly?");
    setStatus("Say how many");
    pendingTranscriptRef.current = (text) => onDependantCount(parseCount(text) ?? 1);
    if (!pausedRef.current && !doneRef.current) void startListening();
  };

  const askDependantDetail = async () => {
    const d = dependantsRef.current;
    if (!d) return;
    const who = d.count > 1 ? `your ${ordinal(d.itemIdx)} child or dependant` : "your child or dependant";
    await say(`What's the name and age of ${who}?`);
    setStatus("Say their name and age");
    pendingTranscriptRef.current = (text) => onDependantDetail(text);
    if (!pausedRef.current && !doneRef.current) void startListening();
  };

  const onDependantDetail = (text: string) => {
    const d = dependantsRef.current;
    if (!d) return;
    const entries = [...d.entries, { index: d.itemIdx, detail: text }];
    if (d.itemIdx < d.count) {
      setDependantsState({ ...d, entries, itemIdx: d.itemIdx + 1 });
      void askDependantDetail();
    } else {
      setDependantsState(null);
      void callStep(buildDependantsSummary(entries));
    }
  };

  // Route a finished transcript either to the credit wizard or the normal step.
  const deliverTranscript = (text: string) => {
    const handler = pendingTranscriptRef.current;
    if (handler) {
      pendingTranscriptRef.current = null;
      handler(text);
      return;
    }
    void callStep(text);
  };

  const callStep = async (transcript: string) => {
    silentRetryRef.current = 0;
    setThinking(true);
    setStatus(transcript ? "Preparing the next question…" : "Preparing…");
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Not signed in");
      const res = await fetch("/api/interview-step", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sessionId, transcript }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = normaliseStep((await res.json()) as StepResp);
      if (data.done) {
        setDone(true);
        setCurrent(null);
        setStatus("All done");
        return;
      }
      currentRef.current = data;
      setCurrent(data);
      setLastHeard("");
      setOptionsActive(false);
      const opts = getStepOptions(data);
      if (data.sayText) {
        setStatus("Susan is speaking…");
        if (!pausedRef.current && !doneRef.current) {
          // Kick off generating the question audio now so it's ready by the time
          // the (instant, pre-cached) acknowledgement finishes playing.
          void prefetch([data.sayText]);
        }
        listenArmedRef.current = false;
        // Speak a short acknowledgement immediately to remove the silent gap
        // while the next question's speech is being synthesised.
        if (data.ack && !pausedRef.current && !doneRef.current) {
          await play(data.ack, { noReveal: true }).catch(() => {});
        }
        const spoke = await play(data.sayText, { onNearEnd: () => armListenEarly(data), leadMs: 1000 })
          .then(() => true)
          .catch((e) => {
            console.error("TTS play failed", e);
            setStatus(opts ? "Tap the option that best fits" : "Listening… speak your answer");
            if (!opts) toast.message("Having trouble with voice playback — please answer when you're ready");
            return true;
          });
        if (spoke && !pausedRef.current && !doneRef.current) {
          if (data.wizard === "credit") {
            startCreditSelect();
          } else if (data.wizard === "dependants") {
            startDependants();
          } else if (opts) {
            // Wait for a tap rather than listening on the microphone.
            setOptionsActive(true);
            setStatus("Tap the option that best fits");
          } else {
            startListeningOnce();
          }
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      bootedRef.current = false;
      setNeedsGesture(true);
      setStatus("Error — tap Start to retry");
    } finally {
      setThinking(false);
    }
  };

  const submitRecording = async (blob: Blob, mimeType: string) => {
    if (blob.size < 512) {
      handleNoSpeech();
      return;
    }
    setTranscribing(true);
    setStatus("Understanding what you said…");
    try {
      const ext = mimeType.includes("mp4") ? "m4a" : "webm";
      const form = new FormData();
      form.append("file", blob, `recording.${ext}`);
      const token = await getAuthToken();
      const res = await fetch("/api/stt", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const payload = (await res.json().catch(() => ({}))) as {
        text?: string;
        error?: string;
        quota?: boolean;
      };
      if (!res.ok) {
        const msg = payload.error ?? "Transcription failed";
        if ((payload.quota || isOpenAIQuotaError(msg)) && isBrowserSttSupported()) {
          forceBrowserSttRef.current = true;
          toast.message("OpenAI quota reached — switching to browser speech for now");
          setTranscribing(false);
          return startBrowserListening();
        }
        throw new Error(msg);
      }
      const text = payload.text ?? "";
      setTranscribing(false);
      if (text.trim()) {
        deliverTranscript(text.trim());
      } else {
        handleNoSpeech();
      }
    } catch (e) {
      setTranscribing(false);
      const msg = e instanceof Error ? e.message : "Transcription failed";
      if (isOpenAIQuotaError(msg) && isBrowserSttSupported()) {
        forceBrowserSttRef.current = true;
        toast.message("OpenAI quota reached — switching to browser speech for now");
        return startBrowserListening();
      }
      toast.error(msg);
      if (!pausedRef.current && !doneRef.current) startListening();
    }
  };

  const startBrowserListening = async () => {
    const SR = getSpeechRecognitionCtor();
    if (!SR) return startOpenAIListening();

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new SR();
      recognitionRef.current = rec;
      rec.lang = "en-GB";
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      const parts: string[] = [];
      let silenceTimer: ReturnType<typeof setTimeout> | null = null;
      const fieldKey = currentRef.current?.fieldKey;
      // Dates need a touch more cushion (people pause between day/month/year).
      const silenceMs = fieldKey === "date_of_birth" ? 2000 : 1400;

      const clearSilence = () => {
        if (silenceTimer) window.clearTimeout(silenceTimer);
        silenceTimer = null;
      };

      const scheduleFinish = () => {
        clearSilence();
        silenceTimer = window.setTimeout(() => {
          try {
            rec.stop();
          } catch {
            /* ignore */
          }
        }, silenceMs);
      };

      rec.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const piece = event.results[i]?.[0]?.transcript ?? "";
          if (!piece) continue;
          if (event.results[i].isFinal) {
            parts.push(piece);
          }
          if (piece.trim()) silentRetryRef.current = 0;
          const preview = [...parts, ...(event.results[i].isFinal ? [] : [piece])].join(" ").trim();
          setLastHeard(preview);
        }
        scheduleFinish();
      };

      rec.onerror = (event) => {
        recognitionRef.current = null;
        clearSilence();
        setListening(false);
        if (event.error === "aborted") return;
        if (event.error === "no-speech") {
          noSpeechHandledRef.current = true;
          handleNoSpeech();
          return;
        }
        console.warn("Browser speech recognition error:", event.error);
        toast.message("Something went wrong — let me listen again");
        if (!pausedRef.current && !doneRef.current) void relistenWithPrompt();
      };

      rec.onend = () => {
        recognitionRef.current = null;
        clearSilence();
        setListening(false);
        if (noSpeechHandledRef.current) {
          noSpeechHandledRef.current = false;
          return;
        }
        const text = parts.join(" ").trim();
        setLastHeard(text);
        if (text) {
          deliverTranscript(text);
        } else {
          handleNoSpeech();
        }
      };

      setListening(true);
      setLastHeard("");
      setStatus(
        fieldKey === "date_of_birth"
          ? "Listening… say day, month and year (e.g. 15 March 1980)"
          : "Listening… speak your answer",
      );
      rec.start();
    } catch {
      setNeedsGesture(true);
      setListening(false);
      setStatus("Allow microphone, then tap Start");
    }
  };

  const startOpenAIListening = async () => {
    if (pausedRef.current || doneRef.current) return;
    try {
      const existingStream = streamRef.current;
      const stream = existingStream?.active
        ? existingStream
        : await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
      streamRef.current = stream;
      const mimeType =
        ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) ||
        "audio/webm";
      const mr = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      mr.onstop = async () => {
        cleanupAudio(false);
        setListening(false);
        const blob = new Blob(chunksRef.current, { type: mr.mimeType });
        await submitRecording(blob, mr.mimeType);
      };
      mr.start(250);
      mediaRef.current = mr;
      setListening(true);
      setStatus("Listening…");

      // Voice-activity detection
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const startedAt = Date.now();
      let speechDetected = false;
      let speechMs = 0;
      let lastSpeechAt = Date.now();
      let noiseFloor = 0.005;
      let calibrated = false;
      let smoothed = 0;
      const noiseSamples: number[] = [];
      const TICK_MS = 80;
      const EMA_ALPHA = 0.18;

      const intervalId = window.setInterval(() => {
        const mr2 = mediaRef.current;
        if (!mr2 || mr2.state !== "recording") {
          window.clearInterval(intervalId);
          return;
        }
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        smoothed = smoothed === 0 ? rms : smoothed + EMA_ALPHA * (rms - smoothed);
        const now = Date.now();
        const elapsed = now - startedAt;

        // Calibrate noise floor in the first window (75th percentile)
        if (elapsed < CALIBRATION_MS) {
          noiseSamples.push(rms);
          return;
        }
        if (!calibrated) {
          noiseSamples.sort((a, b) => a - b);
          noiseFloor = noiseSamples[Math.floor(noiseSamples.length * 0.75)] || 0.005;
          calibrated = true;
        }

        // Use smoothed RMS to defeat brief background spikes (TV, traffic, breath)
        const onThreshold = Math.max(MIN_SPEECH_RMS, noiseFloor * SPEECH_ON_MULT);
        const offThreshold = Math.max(MIN_SILENCE_RMS, noiseFloor * SPEECH_OFF_MULT);

        if (smoothed > onThreshold) {
          speechDetected = true;
          speechMs += TICK_MS;
          lastSpeechAt = now;
        }
        // anything below onThreshold counts as not-speech; lastSpeechAt is the
        // last time we heard real speech, so silence accumulates naturally.

        const activeStep = currentRef.current;
        const silenceThreshold = (activeStep?.fieldKey && activeStep?.section)
          ? (getQuestion(activeStep.section, activeStep.questionIndex ?? 0)?.silenceMs ?? SILENCE_MS)
          : SILENCE_MS;
        // Auto-submit ~2s after speech ceases (per question override allowed)
        if (speechDetected && speechMs >= MIN_SPEECH_MS && now - lastSpeechAt > silenceThreshold && smoothed < onThreshold) {
          window.clearInterval(intervalId);
          try { mr2.requestData(); mr2.stop(); } catch {}
          return;
        }
        if (!speechDetected && elapsed > NO_SPEECH_TIMEOUT_MS) {
          window.clearInterval(intervalId);
          try { mr2.requestData(); mr2.stop(); } catch {}
          return;
        }
        if (speechDetected && elapsed > 18000) {
          window.clearInterval(intervalId);
          try { mr2.requestData(); mr2.stop(); } catch {}
          return;
        }
        if (elapsed > MAX_TURN_MS) {
          window.clearInterval(intervalId);
          try { mr2.requestData(); mr2.stop(); } catch {}
          return;
        }
      }, TICK_MS);

      rafRef.current = intervalId as unknown as number;
    } catch {
      setNeedsGesture(true);
      setListening(false);
      setStatus("Allow microphone, then tap Start");
    }
  };

  const startListening = async () => {
    if (pausedRef.current || doneRef.current) return;
    // OpenAI transcription is more accurate (esp. for numbers), so it's the
    // default. The browser engine is only used when explicitly preferred, or
    // after OpenAI's quota has been exhausted this session.
    if ((preferBrowserSpeech() || forceBrowserSttRef.current) && isBrowserSttSupported()) {
      return startBrowserListening();
    }
    return startOpenAIListening();
  };

  const handlePause = () => {
    pausedRef.current = true;
    setPaused(true);
    stopPlayback();
    stopRecognition();
    if (mediaRef.current?.state === "recording") mediaRef.current.stop();
    cleanupAudio();
    setListening(false);
    // Reset any in-progress wizard so resume restarts it cleanly.
    pendingTranscriptRef.current = null;
    setCreditState(null);
    setDependantsState(null);
    setStatus("Paused");
  };

  const prepareMediaFromGesture = async () => {
    const unlockPromise = unlock();
    const streamPromise = streamRef.current?.active
      ? Promise.resolve(streamRef.current)
      : navigator.mediaDevices.getUserMedia({ audio: true });
    const [, stream] = await Promise.all([unlockPromise, streamPromise]);
    streamRef.current = stream;
  };

  const handleResume = async () => {
    pausedRef.current = false;
    setNeedsGesture(false);
    setPaused(false);
    try {
      await prepareMediaFromGesture();
    } catch (e) {
      console.error("Resume media unlock failed", e);
      pausedRef.current = true;
      setNeedsGesture(true);
      setPaused(true);
      setStatus("Allow microphone, then tap Start");
      toast.error("Please allow microphone access, then tap Start");
      return;
    }
    if (current?.sayText) {
      setStatus("Speaking…");
      listenArmedRef.current = false;
      play(current.sayText, { onNearEnd: () => armListenEarly(currentRef.current), leadMs: 1000 })
        .catch((e) => {
          console.error("TTS play failed", e);
          setStatus("Listening… speak your answer");
          toast.message("Having trouble with voice playback — please answer when you're ready");
        })
        .then(() => {
          beginInputForStep(currentRef.current);
        })
        .catch(() => {
          // already surfaced above
        });
    } else {
      beginInputForStep(currentRef.current);
    }
  };

  const playLocal = (sayText: string, section: Section, index: number) => {
    const secDef = findSection(section);
    const q = getQuestion(section, index);
    const localStep = {
      done: false,
      section,
      sectionTitle: secDef?.title ?? section,
      questionIndex: index,
      questionsInSection: secDef?.questions.length ?? 0,
      fieldKey: q?.key,
      fieldLabel: q?.label,
      prompt: q?.prompt,
      sayText,
    };
    currentRef.current = localStep;
    setCurrent(localStep);
    setStatus("Speaking…");
    listenArmedRef.current = false;
    play(sayText, { onNearEnd: () => armListenEarly(localStep), leadMs: 1000 })
      .then(() => {
        beginInputForStep(localStep);
      })
      .catch((e) => {
        console.error("TTS play failed", e);
        setStatus("Listening… speak your answer");
        toast.message("Having trouble with voice playback — please answer when you're ready");
        beginInputForStep(localStep);
      });
  };

  const handleStart = async () => {
    if (bootedRef.current || !sessionQ.data) return;
    pausedRef.current = false;
    setNeedsGesture(false);
    setPaused(false);
    setStarted(true);
    setStatus("Starting…");
    try {
      await prepareMediaFromGesture();
    } catch (e) {
      console.error("Start media unlock failed", e);
      pausedRef.current = true;
      setNeedsGesture(true);
      setStarted(false);
      setPaused(true);
      setStatus("Allow microphone, then tap Start");
      toast.error("Please allow microphone access, then tap Start");
      return;
    }
    bootedRef.current = true;
    const messages = sessionQ.data.messages;
    const lastAvatar = [...messages].reverse().find((m) => m.role === "avatar");
    const lastCustomer = [...messages].reverse().find((m) => m.role === "customer");
    const hasOpenQuestion =
      lastAvatar && (!lastCustomer || new Date(lastAvatar.created_at) > new Date(lastCustomer.created_at));
    const savedSection = (sessionQ.data.session.current_section as Section) || "personal";
    const savedIndex = sessionQ.data.session.current_question_index ?? 0;

    if (hasOpenQuestion) {
      // Resume an in-flight question — replay the exact avatar line
      playLocal(asSusan(lastAvatar!.text), savedSection, savedIndex);
    } else if (messages.length > 0) {
      // Resume after an answer — re-ask the saved question locally, no server advance
      playLocal(buildPromptText(savedSection, savedIndex, profileFirstName), savedSection, savedIndex);
    } else {
      // Fresh session — let the server seed the first question
      callStep("");
    }
  };

  const answersMap: AnswersMap = (() => {
    const m: AnswersMap = {};
    (sessionQ.data?.answers ?? []).forEach((a: { section: string; field_key: string; value: string | null }) => {
      m[`${a.section}:${a.field_key}`] = a.value ?? "";
    });
    return m;
  })();

  const handleBack = async () => {
    if (!current?.section || current.questionIndex == null) return;
    const prev = prevStep(current.section, current.questionIndex, answersMap);
    if (!prev) {
      toast.info("You're at the first question");
      return;
    }
    stopPlayback();
    if (mediaRef.current?.state === "recording") {
      try { mediaRef.current.stop(); } catch {}
    }
    cleanupAudio(false);
    setListening(false);
    setThinking(false);
    try {
      await setPositionFn({ data: { sessionId, section: prev.section, index: prev.index } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't go back");
      return;
    }
    playLocal(buildPromptText(prev.section, prev.index, profileFirstName), prev.section, prev.index);
  };


  useEffect(() => {
    if (!sessionQ.data || started || done) return;
    setNeedsGesture(true);
    setStatus("Review the consent below, then tap Start");
    const firstPrompt = SECTIONS[0]?.questions[0]?.prompt ?? "";
    // Exact text of Susan's opening line (matches the server's first `sayText`
    // built from the same `firstGreeting` + login first name, so it's a cache
    // hit). Prefetch it FIRST and on its own so time-to-first-audio is minimal,
    // then warm the acks/intros used later in the interview.
    const greeting = firstPrompt ? firstGreeting(profileFirstName, firstPrompt) : "";
    if (greeting) void prefetch([greeting]);
    void prefetch([
      ...ACKNOWLEDGEMENTS.map(ackClip),
      ...SECTIONS.map((s) => s.intro),
    ]);
  }, [sessionQ.data, started, done, prefetch, profileFirstName]);

  useEffect(() => () => cleanupAudio(), []);

  const handleFinish = async () => {
    try {
      await submitFn({ data: { sessionId } });
      navigate({ to: "/sessions/$sessionId", params: { sessionId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to submit");
    }
  };

  if (sessionQ.isLoading) {
    return <AppShell title="Interview"><div className="py-16 text-center text-muted-foreground">Loading…</div></AppShell>;
  }

  const sec = (current?.section ?? "personal") as Section;
  const qi = current?.questionIndex ?? 0;
  const progress = done ? 100 : Math.round((questionIndexGlobal(sec, qi, answersMap) / Math.max(1, totalQuestions(answersMap))) * 100);
  const stepOpts = getStepOptions(current);
  const showOptions = Boolean(stepOpts) && optionsActive && started && !done && !paused && !thinking && !transcribing && !listening;
  const wizardReady = started && !done && !paused && !thinking && !transcribing;
  const showCreditSelect = credit?.phase === "select" && wizardReady;
  const showCreditCount = credit?.phase === "count" && wizardReady && !listening;
  const showDependantsCount = dependants?.phase === "count" && wizardReady && !listening;

  return (
    <AppShell
      title="Interview"
      action={
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              handlePause();
              navigate({ to: "/chat/$sessionId", params: { sessionId } });
            }}
            title="Switch to the typed chat assistant"
          >
            <MessageSquare className="w-4 h-4 mr-2" /> Switch to typing
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate({ to: "/home" })}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
        </div>
      }
    >
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <Progress value={progress} className="h-2" />
          <div className="flex justify-between text-xs text-muted-foreground mt-2">
            <span>{current?.sectionTitle ?? (done ? "Finished" : "Starting…")}</span>
            <span>{progress}%</span>
          </div>
        </div>

        <div className="flex flex-col items-center text-center gap-6 bg-card rounded-3xl border p-6 sm:p-10">
          {!done && (
            <Avatar3D
              speaking={playing}
              listening={listening}
              getAmplitude={getAmplitude}
              usingBrowserVoice={usingBrowserVoice}
            />
          )}
          {done ? (
            <PostCompletionBooking
              sessionId={sessionId}
              channel="voice"
              defaultName={sessionQ.data?.customer?.full_name ?? ""}
              defaultEmail={sessionQ.data?.customer?.email ?? ""}
              onComplete={handleFinish}
            />
          ) : (
            <>
              <p className="text-lg font-medium leading-snug min-h-[3rem]">
                {current?.sayText
                  ? revealByProgress(current.sayText, speechProgress)
                  : current?.prompt ?? (thinking ? "Preparing your first question…" : "")}
              </p>
              {lastHeard && listening && (
                <p className="text-xs text-muted-foreground">Hearing: {lastHeard}</p>
              )}
              {showOptions && stepOpts && (
                <div className="flex flex-wrap justify-center gap-2 w-full max-w-md">
                  {stepOpts.options.map((o) => (
                    <Button
                      key={o.value}
                      variant="outline"
                      size="lg"
                      className="rounded-full"
                      onClick={() => chooseOption(o.value)}
                    >
                      {o.label}
                    </Button>
                  ))}
                  {stepOpts.allowOther && (
                    <Button
                      variant="ghost"
                      size="lg"
                      className="rounded-full border border-dashed"
                      onClick={() => void chooseOther(stepOpts.otherPrompt)}
                    >
                      {stepOpts.otherLabel}
                    </Button>
                  )}
                </div>
              )}
              {showCreditSelect && credit && (
                <div className="w-full max-w-md space-y-4">
                  <div className="flex flex-wrap justify-center gap-2">
                    {CREDIT_TYPES.map((t) => {
                      const on = credit.selected.includes(t.key);
                      return (
                        <Button
                          key={t.key}
                          variant={on ? "default" : "outline"}
                          size="lg"
                          className="rounded-full"
                          onClick={() => toggleCreditType(t.key)}
                        >
                          {t.label}
                        </Button>
                      );
                    })}
                    <Button
                      variant={credit.selected.includes("other") ? "default" : "ghost"}
                      size="lg"
                      className="rounded-full border border-dashed"
                      onClick={() => toggleCreditType("other")}
                    >
                      Other
                    </Button>
                  </div>
                  <div className="flex justify-center gap-2">
                    <Button variant="ghost" size="lg" className="rounded-full" onClick={creditNone}>
                      None of these
                    </Button>
                    <Button
                      size="lg"
                      className="rounded-full"
                      disabled={!credit.selected.length}
                      onClick={creditContinue}
                    >
                      Continue
                    </Button>
                  </div>
                </div>
              )}
              {showCreditCount && credit && (
                <div className="flex flex-wrap justify-center gap-2 w-full max-w-md">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Button
                      key={n}
                      variant="outline"
                      size="lg"
                      className="rounded-full w-14"
                      onClick={() => onCreditCount(n)}
                    >
                      {n}
                    </Button>
                  ))}
                  <Button
                    variant="ghost"
                    size="lg"
                    className="rounded-full border border-dashed"
                    onClick={() => void creditCountMore()}
                  >
                    6+
                  </Button>
                </div>
              )}
              {showDependantsCount && dependants && (
                <div className="flex flex-wrap justify-center gap-2 w-full max-w-md">
                  <Button
                    variant="outline"
                    size="lg"
                    className="rounded-full"
                    onClick={dependantsNone}
                  >
                    None
                  </Button>
                  {[1, 2, 3, 4].map((n) => (
                    <Button
                      key={n}
                      variant="outline"
                      size="lg"
                      className="rounded-full w-14"
                      onClick={() => onDependantCount(n)}
                    >
                      {n}
                    </Button>
                  ))}
                  <Button
                    variant="ghost"
                    size="lg"
                    className="rounded-full border border-dashed"
                    onClick={() => void dependantCountMore()}
                  >
                    5+
                  </Button>
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                {transcribing
                  ? "Understanding what you said…"
                  : thinking
                    ? "Preparing the next question…"
                    : status}
              </p>
              {needsGesture && !started && (
                <label className="flex items-start gap-3 text-left text-sm text-muted-foreground max-w-md mx-auto cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={consented}
                    onChange={(e) => setConsented(e.target.checked)}
                  />
                  <span>
                    I agree to this voice interview being transcribed and stored for my mortgage adviser.
                    The AI summary is assistive only — not mortgage advice.
                  </span>
                </label>
              )}
              <div className="flex flex-wrap justify-center gap-2">
                {needsGesture ? (
                  <Button
                    onClick={() => {
                      if (!consented) {
                        toast.error("Please confirm consent before starting");
                        return;
                      }
                      pausedRef.current = false;
                      setNeedsGesture(false);
                      setPaused(false);
                      void handleStart();
                    }}
                    size="lg"
                    className="rounded-full"
                    disabled={!consented}
                  >
                    <Play className="w-4 h-4 mr-2" /> {started ? "Tap to continue" : "Start interview"}
                  </Button>
                ) : paused ? (
                  <Button onClick={handleResume} size="lg" className="rounded-full">
                    <Play className="w-4 h-4 mr-2" /> Resume
                  </Button>
                ) : (
                  <Button onClick={handlePause} size="lg" variant="outline" className="rounded-full">
                    <Pause className="w-4 h-4 mr-2" /> Pause
                  </Button>
                )}
                {started && current?.section && current.questionIndex != null && !needsGesture &&
                  prevStep(current.section, current.questionIndex) && (
                  <Button
                    onClick={handleBack}
                    size="lg"
                    variant="outline"
                    className="rounded-full"
                    disabled={thinking || transcribing}
                  >
                    <Undo2 className="w-4 h-4 mr-2" /> Previous question
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
