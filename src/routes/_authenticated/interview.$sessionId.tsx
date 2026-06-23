import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getSession, submitSession, setSessionPosition } from "@/lib/sessions.functions";
import { AppShell } from "@/components/AppShell";
import { Avatar, useAudioPlayback } from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Pause, Play, ArrowLeft, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { totalQuestions, questionIndexGlobal, getQuestion, findSection, prevStep, type Section, type AnswersMap } from "@/lib/interview-script";

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
  sayText?: string;
}

// Voice-activity detection thresholds
const SILENCE_MS = 450; // sustained silence after speech ends the turn
const MAX_TURN_MS = 45000; // hard cap per answer
const NO_SPEECH_TIMEOUT_MS = 10000; // if nothing detected at all, stop
const CALIBRATION_MS = 500; // measure ambient noise floor at start
const SPEECH_ON_MULT = 3.0; // RMS must exceed noiseFloor * this to count as speech
const SPEECH_OFF_MULT = 1.6; // below noiseFloor * this counts as silence (hysteresis)
const MIN_SPEECH_RMS = 0.015; // absolute floor for speech-on
const MIN_SILENCE_RMS = 0.009; // absolute ceiling for silence
const MIN_SPEECH_MS = 250; // require this much cumulative speech before allowing end

function buildPromptText(section: Section, index: number) {
  const sectionDef = findSection(section);
  const question = getQuestion(section, index);
  if (!sectionDef || !question) return "";
  if (section === "personal" && index === 0) {
    return `Hi, I'm Susan. I'll guide you through a quick fact-find for your mortgage application. ${sectionDef.intro} ${question.prompt}`;
  }
  return `${sectionDef.intro} ${question.prompt}`;
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
  const { play, playing, stop: stopPlayback, unlock } = useAudioPlayback();

  const sessionQ = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => getSessionFn({ data: { sessionId } }),
  });

  const [current, setCurrent] = useState<StepResp | null>(null);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [done, setDone] = useState(false);
  const [paused, setPaused] = useState(false);
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState<string>("Starting…");
  const [needsGesture, setNeedsGesture] = useState(false);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const bootedRef = useRef(false);
  const pausedRef = useRef(false);
  const doneRef = useRef(false);

  pausedRef.current = paused;
  doneRef.current = done;

  const cleanupAudio = (stopTracks = true) => {
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
    };
  };

  const callStep = async (transcript: string) => {
    setThinking(true);
    setStatus(transcript ? "Thinking…" : "Preparing…");
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
      setCurrent(data);
      if (data.sayText) {
        setStatus("Speaking…");
        const spoke = await play(data.sayText)
          .then(() => true)
          .catch((e) => {
            console.error("TTS play failed", e);
            bootedRef.current = false;
            setNeedsGesture(true);
            setPaused(true);
            setStatus("Audio blocked — tap Start");
            toast.error("Audio blocked — tap Start");
            return false;
          });
        // play() resolves when speech ends → start listening
        if (spoke && !pausedRef.current && !doneRef.current) startListening();
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

  const startListening = async () => {
    if (pausedRef.current || doneRef.current) return;
    try {
      const existingStream = streamRef.current;
      const stream = existingStream?.active ? existingStream : await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = ["audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) || "audio/webm";
      const mr = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      mr.onstop = async () => {
        cleanupAudio(false);
        setListening(false);
        const blob = new Blob(chunksRef.current, { type: mr.mimeType });
        if (blob.size < 1024) {
          // nothing meaningful — re-listen
          if (!pausedRef.current && !doneRef.current) startListening();
          return;
        }
        setTranscribing(true);
        setStatus("Transcribing…");
        try {
          const ext = mr.mimeType.includes("mp4") ? "mp4" : "webm";
          const form = new FormData();
          form.append("file", blob, `recording.${ext}`);
          const res = await fetch("/api/stt", { method: "POST", body: form });
          if (!res.ok) throw new Error("Transcription failed");
          const { text } = (await res.json()) as { text: string };
          setTranscribing(false);
          if (text.trim()) {
            await callStep(text.trim());
          } else if (!pausedRef.current && !doneRef.current) {
            startListening();
          }
        } catch (e) {
          setTranscribing(false);
          toast.error(e instanceof Error ? e.message : "Transcription failed");
          if (!pausedRef.current && !doneRef.current) startListening();
        }
      };
      mr.start();
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
      const noiseSamples: number[] = [];
      const TICK_MS = 80;

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

        const onThreshold = Math.max(MIN_SPEECH_RMS, noiseFloor * SPEECH_ON_MULT);
        const offThreshold = Math.min(MIN_SILENCE_RMS, Math.max(noiseFloor * SPEECH_OFF_MULT, noiseFloor + 0.002));

        if (rms > onThreshold) {
          speechDetected = true;
          speechMs += TICK_MS;
          lastSpeechAt = now;
        } else if (rms < offThreshold) {
          // count as silence — do not bump lastSpeechAt
        } else {
          // in-between band — treat as quiet enough not to extend speech
        }

        if (speechDetected && speechMs >= MIN_SPEECH_MS && now - lastSpeechAt > SILENCE_MS) {
          window.clearInterval(intervalId);
          try { mr2.stop(); } catch {}
          return;
        }
        if (!speechDetected && elapsed > NO_SPEECH_TIMEOUT_MS) {
          window.clearInterval(intervalId);
          try { mr2.stop(); } catch {}
          return;
        }
        if (elapsed > MAX_TURN_MS) {
          window.clearInterval(intervalId);
          try { mr2.stop(); } catch {}
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

  const handlePause = () => {
    pausedRef.current = true;
    setPaused(true);
    stopPlayback();
    if (mediaRef.current?.state === "recording") mediaRef.current.stop();
    cleanupAudio();
    setListening(false);
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
      play(current.sayText)
        .catch((e) => {
          console.error("TTS play failed", e);
          setPaused(true);
          setNeedsGesture(true);
          setStatus("Audio blocked — tap Start");
          toast.error("Audio blocked — tap Start");
          throw e;
        })
        .then(() => {
          if (!pausedRef.current && !doneRef.current) startListening();
        })
        .catch(() => {
          // already surfaced above
        });
    } else {
      startListening();
    }
  };

  const playLocal = (sayText: string, section: Section, index: number) => {
    const secDef = findSection(section);
    const q = getQuestion(section, index);
    setCurrent({
      done: false,
      section,
      sectionTitle: secDef?.title ?? section,
      questionIndex: index,
      questionsInSection: secDef?.questions.length ?? 0,
      fieldKey: q?.key,
      fieldLabel: q?.label,
      prompt: q?.prompt,
      sayText,
    });
    setStatus("Speaking…");
    play(sayText)
      .then(() => {
        if (!pausedRef.current && !doneRef.current) startListening();
      })
      .catch((e) => {
        console.error("TTS play failed", e);
        bootedRef.current = false;
        setStarted(false);
        setNeedsGesture(true);
        setPaused(true);
        setStatus("Audio blocked — tap Start");
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
      playLocal(buildPromptText(savedSection, savedIndex), savedSection, savedIndex);
    } else {
      // Fresh session — let the server seed the first question
      callStep("");
    }
  };

  const handleBack = async () => {
    if (!current?.section || current.questionIndex == null) return;
    const prev = prevStep(current.section, current.questionIndex);
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
    playLocal(buildPromptText(prev.section, prev.index), prev.section, prev.index);
  };


  useEffect(() => {
    if (!sessionQ.data || started || done) return;
    setNeedsGesture(true);
    setStatus("Tap Start to begin");
  }, [sessionQ.data, started, done]);

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
  const progress = done ? 100 : Math.round((questionIndexGlobal(sec, qi) / totalQuestions()) * 100);

  return (
    <AppShell
      title="Interview"
      action={
        <Button variant="outline" size="sm" onClick={() => navigate({ to: "/home" })}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
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
          <Avatar speaking={playing} listening={listening} />
          {done ? (
            <>
              <h2 className="text-2xl font-semibold">All done!</h2>
              <p className="text-muted-foreground">Review your answers, edit anything, and submit to your advisor.</p>
              <Button size="lg" onClick={handleFinish}>Review & submit</Button>
            </>
          ) : (
            <>
              <p className="text-lg font-medium leading-snug min-h-[3rem]">
                {current?.sayText ?? current?.prompt ?? (thinking ? "Preparing your first question…" : "")}
              </p>
              <p className="text-sm text-muted-foreground">
                {transcribing ? "Transcribing…" : thinking ? "Thinking…" : status}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {needsGesture ? (
                  <Button
                    onClick={() => {
                      pausedRef.current = false;
                      setNeedsGesture(false);
                      setPaused(false);
                      void handleStart();
                    }}
                    size="lg"
                    className="rounded-full"
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
