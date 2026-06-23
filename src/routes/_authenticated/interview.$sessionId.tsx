import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getSession, submitSession } from "@/lib/sessions.functions";
import { AppShell } from "@/components/AppShell";
import { Avatar, useAudioPlayback } from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Pause, Play, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { totalQuestions, questionIndexGlobal, type Section } from "@/lib/interview-script";

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
  sayText?: string;
}

// Voice-activity detection thresholds
const SILENCE_MS = 1800; // silence after speech ends the turn
const MAX_TURN_MS = 25000; // hard cap per answer
const NO_SPEECH_TIMEOUT_MS = 8000; // if nothing detected at all, stop
const CALIBRATION_MS = 600; // measure ambient noise floor at start
const SPEECH_MULTIPLIER = 2.5; // speech must be this much louder than noise floor
const MIN_SPEECH_RMS = 0.012; // absolute floor

function InterviewPage() {
  const { sessionId } = Route.useParams();
  const navigate = useNavigate();
  const getSessionFn = useServerFn(getSession);
  const submitFn = useServerFn(submitSession);
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
  const [status, setStatus] = useState<string>("Tap start to begin");

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

  const cleanupAudio = () => {
    if (rafRef.current) window.clearInterval(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
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
      const data = (await res.json()) as StepResp;
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
            setPaused(true);
            setStatus("Audio blocked — tap resume");
            toast.error("Audio blocked — tap resume");
            return false;
          });
        // play() resolves when speech ends → start listening
        if (spoke && !pausedRef.current && !doneRef.current) startListening();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      setStatus("Error — tap resume to retry");
    } finally {
      setThinking(false);
    }
  };

  const startListening = async () => {
    if (pausedRef.current || doneRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = ["audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) || "audio/webm";
      const mr = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      mr.onstop = async () => {
        cleanupAudio();
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
      let lastSpeechAt = Date.now();
      let noiseFloor = 0.005;
      const noiseSamples: number[] = [];

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

        // Calibrate noise floor in the first window
        if (elapsed < CALIBRATION_MS) {
          noiseSamples.push(rms);
          rafRef.current = null;
          return;
        }
        if (noiseSamples.length && noiseFloor === 0.005) {
          noiseSamples.sort((a, b) => a - b);
          noiseFloor = noiseSamples[Math.floor(noiseSamples.length / 2)] || 0.005;
        }

        const threshold = Math.max(MIN_SPEECH_RMS, noiseFloor * SPEECH_MULTIPLIER);
        if (rms > threshold) {
          speechDetected = true;
          lastSpeechAt = now;
        }

        if (speechDetected && now - lastSpeechAt > SILENCE_MS) {
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
      }, 80);
      rafRef.current = intervalId as unknown as number;
    } catch {
      toast.error("Microphone access denied.");
      setStatus("Mic blocked — enable microphone access");
    }
  };

  const handlePause = () => {
    setPaused(true);
    stopPlayback();
    if (mediaRef.current?.state === "recording") mediaRef.current.stop();
    cleanupAudio();
    setListening(false);
    setStatus("Paused");
  };

  const handleResume = async () => {
    setPaused(false);
    await unlock().catch(() => {});
    if (current?.sayText) {
      setStatus("Speaking…");
      play(current.sayText)
        .catch((e) => {
          console.error("TTS play failed", e);
          setPaused(true);
          setStatus("Audio blocked — tap resume");
          toast.error("Audio blocked — tap resume");
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

  // Boot must be triggered by a user gesture (mobile autoplay policy).
  const handleStart = async () => {
    if (bootedRef.current || !sessionQ.data) return;
    bootedRef.current = true;
    setStarted(true);
    try {
      await unlock();
    } catch (e) {
      console.error("Audio unlock failed", e);
      toast.error("Audio blocked — tap start again");
      bootedRef.current = false;
      setStarted(false);
      setStatus("Tap start to begin");
      return;
    }
    const messages = sessionQ.data.messages;
    const lastAvatar = [...messages].reverse().find((m) => m.role === "avatar");
    const lastCustomer = [...messages].reverse().find((m) => m.role === "customer");
    const hasOpenQuestion =
      lastAvatar && (!lastCustomer || new Date(lastAvatar.created_at) > new Date(lastCustomer.created_at));
    if (hasOpenQuestion) {
      const sec = sessionQ.data.session.current_section as Section;
      const idx = sessionQ.data.session.current_question_index;
      setCurrent({
        done: false,
        section: sec,
        sectionTitle: sec,
        questionIndex: idx,
        questionsInSection: 5,
        fieldKey: "resume",
        fieldLabel: "",
        sayText: lastAvatar!.text,
      });
      setStatus("Speaking…");
      play(lastAvatar!.text)
        .then(() => {
          if (!pausedRef.current && !doneRef.current) startListening();
        })
        .catch((e) => {
          console.error("TTS play failed", e);
          setPaused(true);
          setStatus("Audio blocked — tap resume");
          toast.error("Audio blocked — tap resume");
        });
    } else {
      callStep("");
    }
  };

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
                {current?.sayText ?? (thinking ? "Preparing your first question…" : "")}
              </p>
              <p className="text-sm text-muted-foreground">
                {transcribing ? "Transcribing…" : thinking ? "Thinking…" : status}
              </p>
              <div className="flex gap-2">
                {!started ? (
                  <Button onClick={handleStart} size="lg" className="rounded-full">
                    <Play className="w-4 h-4 mr-2" /> Start interview
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
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
