import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getSession, submitSession } from "@/lib/sessions.functions";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { PostCompletionBooking } from "@/components/PostCompletionBooking";
import { ArrowLeft, Send } from "lucide-react";
import { toast } from "sonner";
import { totalQuestions, questionIndexGlobal, getQuestion, findSection, prevStep, type Section, type AnswersMap } from "@/lib/interview-script";

export const Route = createFileRoute("/_authenticated/text/$sessionId")({
  component: TextInterviewPage,
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

function buildPromptText(section: Section, index: number) {
  const sectionDef = findSection(section);
  const question = getQuestion(section, index);
  if (!sectionDef || !question) return "";
  if (section === "personal" && index === 0) {
    return `Hi, I'm Susan. I'll guide you through a quick fact-find for your mortgage application. ${sectionDef.intro} ${question.prompt}`;
  }
  return `${sectionDef.intro} ${question.prompt}`;
}

function TextInterviewPage() {
  const { sessionId } = Route.useParams();
  const navigate = useNavigate();
  const getSessionFn = useServerFn(getSession);
  const submitFn = useServerFn(submitSession);
  const setPositionFn = useServerFn(setSessionPosition);

  const sessionQ = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => getSessionFn({ data: { sessionId } }),
  });

  const [current, setCurrent] = useState<StepResp | null>(null);
  const [thinking, setThinking] = useState(false);
  const [done, setDone] = useState(false);
  const [started, setStarted] = useState(false);
  const [answer, setAnswer] = useState("");
  const bootedRef = useRef(false);

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
        return;
      }
      setCurrent(data);
      setAnswer("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setThinking(false);
    }
  };

  const handleStart = async () => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    setStarted(true);
    await callStep("");
  };

  useEffect(() => {
    if (!sessionQ.data || started || done) return;
    void handleStart();
  }, [sessionQ.data, started, done]);

  const answersMap = (() => {
    const m: AnswersMap = {};
    (sessionQ.data?.answers ?? []).forEach((a: { section: string; field_key: string; value: string | null }) => {
      m[`${a.section}:${a.field_key}`] = a.value ?? "";
    });
    return m;
  })();

  const defaultName = answersMap["personal:full_name"] ?? "";
  const defaultEmail = answersMap["personal:email"] ?? "";

  const progress = done
    ? 100
    : current?.section && current.questionIndex != null
      ? Math.round((questionIndexGlobal(current.section, current.questionIndex, answersMap) / Math.max(1, totalQuestions(answersMap))) * 100)
      : 0;

  const goToSummary = async () => {
    try {
      await submitFn({ data: { sessionId } });
      navigate({ to: "/sessions/$sessionId", params: { sessionId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to continue");
    }
  };

  if (sessionQ.isLoading) {
    return <AppShell title="Text interview"><div className="py-16 text-center text-muted-foreground">Loading…</div></AppShell>;
  }

  return (
    <AppShell
      title="Text interview"
      action={
        <Button variant="outline" size="sm" onClick={() => navigate({ to: "/home" })}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
      }
    >
      <div className="max-w-2xl mx-auto">
        {!done && (
          <div className="mb-6">
            <Progress value={progress} className="h-2" />
            <div className="flex justify-between text-xs text-muted-foreground mt-2">
              <span>{current?.sectionTitle ?? "Starting…"}</span>
              <span>{progress}%</span>
            </div>
          </div>
        )}

        <div className="bg-card rounded-3xl border p-6 sm:p-10 space-y-6">
          {done ? (
            <PostCompletionBooking
              sessionId={sessionId}
              channel="text"
              defaultName={defaultName}
              defaultEmail={defaultEmail}
              onComplete={goToSummary}
            />
          ) : (
            <>
              <p className="text-lg font-medium leading-snug min-h-[3rem]">
                {current?.sayText ?? current?.prompt ?? (thinking ? "Preparing your first question…" : "")}
              </p>
              <Textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Type your answer here…"
                rows={4}
                disabled={thinking || !current}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (answer.trim() && !thinking) void callStep(answer.trim());
                  }
                }}
              />
              <Button
                size="lg"
                disabled={!answer.trim() || thinking}
                onClick={() => void callStep(answer.trim())}
              >
                <Send className="w-4 h-4 mr-2" />
                {thinking ? "Sending…" : "Send answer"}
              </Button>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
