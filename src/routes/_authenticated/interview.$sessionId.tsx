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
import { Mic, Square, Send } from "lucide-react";
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

function InterviewPage() {
  const { sessionId } = Route.useParams();
  const navigate = useNavigate();
  const getSessionFn = useServerFn(getSession);
  const submitFn = useServerFn(submitSession);
  const { play, playing } = useAudioPlayback();

  const sessionQ = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => getSessionFn({ data: { sessionId } }),
  });

  const [current, setCurrent] = useState<StepResp | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [pendingTranscript, setPendingTranscript] = useState("");
  const [thinking, setThinking] = useState(false);
  const [done, setDone] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const bootedRef = useRef(false);

  const callStep = async (transcript: string) => {
    setThinking(true);
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
      setPendingTranscript("");
      if (data.done) {
        setDone(true);
        setCurrent(null);
        return;
      }
      setCurrent(data);
      if (data.sayText) play(data.sayText).catch((e) => console.error(e));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setThinking(false);
    }
  };

  // Boot: ask first question (or resume). Use existing transcript to decide.
  useEffect(() => {
    if (bootedRef.current || !sessionQ.data) return;
    bootedRef.current = true;
    // Always call step with empty transcript — backend serves current pending question (or first).
    // To avoid duplicating an avatar message, only call if there's no recent avatar question without a customer reply.
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
      play(lastAvatar!.text).catch(() => {});
    } else {
      callStep("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionQ.data]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = ["audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) || "audio/webm";
      const mr = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      mr.onstop = async () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType });
        if (blob.size < 1024) {
          toast.error("That was too short — try again.");
          return;
        }
        setTranscribing(true);
        try {
          const ext = mr.mimeType.includes("mp4") ? "mp4" : "webm";
          const form = new FormData();
          form.append("file", blob, `recording.${ext}`);
          const res = await fetch("/api/stt", { method: "POST", body: form });
          if (!res.ok) throw new Error("Transcription failed");
          const { text } = (await res.json()) as { text: string };
          setPendingTranscript(text);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Transcription failed");
        } finally {
          setTranscribing(false);
        }
      };
      mr.start();
      mediaRef.current = mr;
      setRecording(true);
    } catch {
      toast.error("Microphone access denied.");
    }
  };

  const stopRecording = () => {
    mediaRef.current?.stop();
    setRecording(false);
  };

  const handleSubmit = async () => {
    if (!pendingTranscript.trim()) return;
    await callStep(pendingTranscript.trim());
  };

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
    <AppShell title="Interview">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <Progress value={progress} className="h-2" />
          <div className="flex justify-between text-xs text-muted-foreground mt-2">
            <span>{current?.sectionTitle ?? (done ? "Finished" : "Starting…")}</span>
            <span>{progress}%</span>
          </div>
        </div>

        <div className="flex flex-col items-center text-center gap-6 bg-card rounded-3xl border p-6 sm:p-10">
          <Avatar speaking={playing} listening={recording} />
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

              {pendingTranscript ? (
                <div className="w-full">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Your answer</div>
                  <textarea
                    className="w-full rounded-xl border bg-background p-3 text-sm min-h-[80px]"
                    value={pendingTranscript}
                    onChange={(e) => setPendingTranscript(e.target.value)}
                  />
                  <div className="flex gap-2 mt-3 justify-center">
                    <Button variant="outline" onClick={() => setPendingTranscript("")}>Re-record</Button>
                    <Button onClick={handleSubmit} disabled={thinking}>
                      <Send className="w-4 h-4 mr-2" />{thinking ? "Saving…" : "Next question"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  {!recording ? (
                    <Button
                      size="lg"
                      className="rounded-full w-20 h-20"
                      onClick={startRecording}
                      disabled={thinking || transcribing || playing}
                    >
                      <Mic className="w-7 h-7" />
                    </Button>
                  ) : (
                    <Button size="lg" variant="destructive" className="rounded-full w-20 h-20" onClick={stopRecording}>
                      <Square className="w-7 h-7" />
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {transcribing ? "Transcribing…" : recording ? "Recording — tap to stop" : playing ? "Listening to the question…" : "Tap to answer"}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
