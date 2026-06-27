import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getSession, submitSession } from "@/lib/sessions.functions";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, Mic, Send } from "lucide-react";
import { toast } from "sonner";
import avatarImg from "@/assets/avatar.png";
import {
  totalQuestions,
  questionIndexGlobal,
  getQuestion,
  findSection,
  firstNameFromFullName,
  type Section,
  type AnswersMap,
} from "@/lib/interview-script";
import {
  CREDIT_TYPES,
  parseCount,
  buildCreditSummary,
  ordinal,
  buildDependantsSummary,
  type CreditFlow,
  type DependantFlow,
} from "@/lib/interview-wizards";

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

interface ChatMsg {
  id: string;
  role: "assistant" | "customer";
  text: string;
}

let bubbleSeq = 0;
const nextId = () => `m-${Date.now()}-${bubbleSeq++}`;

function getStepOptions(step: StepResp | null) {
  if (!step || step.done || !step.section || step.questionIndex == null) return null;
  const q = getQuestion(step.section, step.questionIndex);
  if (!q?.options?.length) return null;
  return {
    options: q.options,
    allowOther: q.allowOther ?? false,
    otherLabel: q.otherLabel ?? "Other",
    otherPrompt: q.otherPrompt ?? "No problem — please describe it in your own words.",
  };
}

const PLACEHOLDER_EXAMPLES: Record<string, string> = {
  date_of_birth: "e.g. 15 March 1980",
  home_postcode: "e.g. SW1A 1AA",
  home_house: "e.g. 42, or Rose Cottage",
  home_duration: "e.g. 3 years",
  employer: "e.g. Acme Ltd",
  job_title: "e.g. Software engineer",
  income: "e.g. £45,000 a year",
  retirement_income: "e.g. £20,000 a year",
  monthly_essentials: "e.g. £1,200 a month",
  property_price: "e.g. £300,000",
  deposit: "e.g. £30,000",
  amount_owed: "e.g. £150,000",
  mortgage_term: "e.g. 25 years",
};

function placeholderForStep(step: StepResp | null): string {
  const key = step?.fieldKey;
  if (key && PLACEHOLDER_EXAMPLES[key]) return PLACEHOLDER_EXAMPLES[key];
  return "Type your answer…";
}

function normaliseStep(data: StepResp): StepResp {
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
}

export function ChatInterview({ sessionId }: { sessionId: string }) {
  const navigate = useNavigate();
  const getSessionFn = useServerFn(getSession);
  const submitFn = useServerFn(submitSession);

  const sessionQ = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => getSessionFn({ data: { sessionId } }),
  });

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [current, setCurrent] = useState<StepResp | null>(null);
  const [done, setDone] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [input, setInput] = useState("");
  const [optionsActive, setOptionsActive] = useState(false);
  const [credit, setCredit] = useState<CreditFlow | null>(null);
  const [dependants, setDependants] = useState<DependantFlow | null>(null);
  const [textPlaceholder, setTextPlaceholder] = useState("Type your answer…");
  // When set, the next typed message is delivered here (wizard sub-answers,
  // "Other" free-text) instead of being POSTed as a normal step answer.
  const [textHandlerActive, setTextHandlerActive] = useState(false);

  const bootedRef = useRef(false);
  const creditRef = useRef<CreditFlow | null>(null);
  const dependantsRef = useRef<DependantFlow | null>(null);
  const textHandlerRef = useRef<((text: string) => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const profileFirstName = firstNameFromFullName(sessionQ.data?.customer?.full_name);

  const appendAssistant = useCallback((text: string) => {
    if (!text.trim()) return;
    setMessages((prev) => [...prev, { id: nextId(), role: "assistant", text: text.trim() }]);
  }, []);

  const appendCustomer = useCallback((text: string) => {
    if (!text.trim()) return;
    setMessages((prev) => [...prev, { id: nextId(), role: "customer", text: text.trim() }]);
  }, []);

  const setTextHandler = (handler: ((text: string) => void) | null, placeholder?: string) => {
    textHandlerRef.current = handler;
    setTextHandlerActive(handler !== null);
    if (placeholder) setTextPlaceholder(placeholder);
    if (handler) requestAnimationFrame(() => inputRef.current?.focus());
  };

  // Auto-scroll to the newest message / typing indicator.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking, optionsActive, credit, dependants, done]);

  const callStep = useCallback(
    async (transcript: string) => {
      setOptionsActive(false);
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
          appendAssistant("That's everything I need — thank you! Tap below to review your answers and send them to your adviser.");
          return;
        }
        setCurrent(data);
        appendAssistant([data.ack, data.sayText].filter(Boolean).join(" "));
        beginInputForStep(data);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        setThinking(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, appendAssistant],
  );

  /** Append the customer's answer bubble and POST it as a normal step answer. */
  const submitAnswer = (transcript: string, displayText?: string) => {
    appendCustomer(displayText ?? transcript);
    void callStep(transcript);
  };

  const beginInputForStep = (step: StepResp | null) => {
    setTextHandler(null);
    if (!step || step.done) return;
    if (step.wizard === "credit") {
      startCreditSelect();
    } else if (step.wizard === "dependants") {
      startDependants();
    } else if (getStepOptions(step)) {
      setOptionsActive(true);
    } else {
      // Free-text question — the bottom input is shown automatically. Reset the
      // placeholder so a stale example from a previous wizard step (e.g. the
      // credit or dependants flow) doesn't linger on later questions.
      setTextPlaceholder(placeholderForStep(step));
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  // ---- Options ----
  const chooseOption = (value: string, label: string) => {
    if (thinking) return;
    setOptionsActive(false);
    submitAnswer(value, label);
  };

  const chooseOther = (otherPrompt: string) => {
    if (thinking) return;
    setOptionsActive(false);
    appendAssistant(otherPrompt);
    setTextHandler((text) => submitAnswer(text), "Type your answer…");
  };

  // ---- Credit-commitments wizard ----
  const setCreditState = (next: CreditFlow | null) => {
    creditRef.current = next;
    setCredit(next);
  };

  const startCreditSelect = () => {
    setOptionsActive(false);
    setTextHandler(null);
    setCreditState({ phase: "select", selected: [], typeIdx: 0, count: 0, itemIdx: 0, entries: [] });
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
    submitAnswer("No ongoing credit commitments.", "None of these");
  };

  const creditLabelFor = (key: string) =>
    key === "other" ? "Other" : CREDIT_TYPES.find((x) => x.key === key)?.label ?? key;

  const creditContinue = () => {
    const c = creditRef.current;
    if (!c) return;
    if (!c.selected.length) return creditNone();
    appendCustomer(c.selected.map(creditLabelFor).join(", "));
    setCreditState({ ...c, typeIdx: 0, entries: [] });
    askCreditCount();
  };

  const askCreditCount = () => {
    const c = creditRef.current;
    if (!c) return;
    const key = c.selected[c.typeIdx];
    if (key === "other") return askCreditOther();
    const t = CREDIT_TYPES.find((x) => x.key === key);
    setCreditState({ ...c, phase: "count" });
    appendAssistant(`You've told me you have a ${t?.noun ?? "commitment"}. How many ${t?.plural ?? "of those"} do you have?`);
  };

  const onCreditCount = (n: number) => {
    const c = creditRef.current;
    if (!c) return;
    appendCustomer(`${n}`);
    setCreditState({ ...c, phase: "amount", count: n, itemIdx: 1 });
    askCreditAmount();
  };

  const creditCountMore = () => {
    appendAssistant("How many exactly?");
    setTextHandler((text) => onCreditCount(parseCount(text) ?? 1), "Type a number…");
  };

  const askCreditAmount = () => {
    const c = creditRef.current;
    if (!c) return;
    const key = c.selected[c.typeIdx];
    const t = CREDIT_TYPES.find((x) => x.key === key);
    const label = c.count > 1 ? `${t?.noun ?? "commitment"} number ${c.itemIdx}` : `the ${t?.noun ?? "commitment"}`;
    appendAssistant(`What's the monthly payment, and the balance left, on ${label}?`);
    setTextHandler((text) => onCreditAmount(text), "e.g. £120 a month, £3,000 left");
  };

  const onCreditAmount = (text: string) => {
    const c = creditRef.current;
    if (!c) return;
    const key = c.selected[c.typeIdx];
    const t = CREDIT_TYPES.find((x) => x.key === key);
    const entries = [...c.entries, { typeKey: key, label: t?.label ?? "Other", index: c.itemIdx, detail: text }];
    if (c.itemIdx < c.count) {
      setCreditState({ ...c, entries, itemIdx: c.itemIdx + 1 });
      askCreditAmount();
    } else {
      setCreditState({ ...c, entries, typeIdx: c.typeIdx + 1, count: 0, itemIdx: 0 });
      nextCreditType();
    }
  };

  const nextCreditType = () => {
    const c = creditRef.current;
    if (!c) return;
    if (c.typeIdx < c.selected.length) return askCreditCount();
    return finishCredit();
  };

  const askCreditOther = () => {
    const c = creditRef.current;
    if (!c) return;
    setCreditState({ ...c, phase: "other" });
    appendAssistant("Please describe the other credit, including the monthly payment and the balance left.");
    setTextHandler((text) => {
      const cc = creditRef.current;
      if (!cc) return;
      const entries = [...cc.entries, { typeKey: "other", label: "Other", index: 1, detail: text }];
      setCreditState({ ...cc, entries, typeIdx: cc.typeIdx + 1 });
      nextCreditType();
    }, "Describe the other credit…");
  };

  const finishCredit = () => {
    const c = creditRef.current;
    if (!c) return;
    const summary = buildCreditSummary(c.entries);
    setCreditState(null);
    setTextHandler(null);
    void callStep(summary);
  };

  // ---- Dependants wizard ----
  const setDependantsState = (next: DependantFlow | null) => {
    dependantsRef.current = next;
    setDependants(next);
  };

  const startDependants = () => {
    setOptionsActive(false);
    setTextHandler(null);
    setDependantsState({ phase: "count", count: 0, itemIdx: 0, entries: [] });
  };

  const dependantsNone = () => {
    setDependantsState(null);
    submitAnswer("No dependants.", "None");
  };

  const onDependantCount = (n: number) => {
    if (n <= 0) return dependantsNone();
    appendCustomer(`${n}`);
    setDependantsState({ phase: "detail", count: n, itemIdx: 1, entries: [] });
    askDependantDetail();
  };

  const dependantCountMore = () => {
    appendAssistant("How many exactly?");
    setTextHandler((text) => onDependantCount(parseCount(text) ?? 1), "Type a number…");
  };

  const askDependantDetail = () => {
    const d = dependantsRef.current;
    if (!d) return;
    const who = d.count > 1 ? `your ${ordinal(d.itemIdx)} child or dependant` : "your child or dependant";
    appendAssistant(`What's the name and age of ${who}?`);
    setTextHandler((text) => onDependantDetail(text), "e.g. Maya, 7");
  };

  const onDependantDetail = (text: string) => {
    const d = dependantsRef.current;
    if (!d) return;
    const entries = [...d.entries, { index: d.itemIdx, detail: text }];
    if (d.itemIdx < d.count) {
      setDependantsState({ ...d, entries, itemIdx: d.itemIdx + 1 });
      askDependantDetail();
    } else {
      setDependantsState(null);
      setTextHandler(null);
      void callStep(buildDependantsSummary(entries));
    }
  };

  // ---- Sending typed input ----
  const handleSend = () => {
    const text = input.trim();
    if (!text || thinking) return;
    setInput("");
    const handler = textHandlerRef.current;
    if (handler) {
      setTextHandler(null);
      appendCustomer(text);
      handler(text);
    } else {
      submitAnswer(text);
    }
  };

  // ---- Bootstrap (fresh seed or resume from saved position) ----
  useEffect(() => {
    if (!sessionQ.data || bootedRef.current) return;
    bootedRef.current = true;
    const msgs = sessionQ.data.messages ?? [];
    if (msgs.length === 0) {
      void callStep("");
      return;
    }
    setMessages(
      msgs.map((m) => ({
        id: m.id,
        role: m.role === "customer" ? "customer" : "assistant",
        text: m.text,
      })),
    );
    const section = (sessionQ.data.session.current_section as Section) || "personal";
    const index = sessionQ.data.session.current_question_index ?? 0;
    const step = normaliseStep({ done: false, section, questionIndex: index });
    setCurrent(step);
    beginInputForStep(step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionQ.data]);

  const handleFinish = async () => {
    setSubmitting(true);
    try {
      await submitFn({ data: { sessionId } });
      navigate({ to: "/sessions/$sessionId", params: { sessionId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to submit");
      setSubmitting(false);
    }
  };

  const answersMap: AnswersMap = (() => {
    const m: AnswersMap = {};
    (sessionQ.data?.answers ?? []).forEach((a: { section: string; field_key: string; value: string | null }) => {
      m[`${a.section}:${a.field_key}`] = a.value ?? "";
    });
    return m;
  })();

  if (sessionQ.isLoading) {
    return (
      <AppShell title="Chat fact-find">
        <div className="py-16 text-center text-muted-foreground">Loading…</div>
      </AppShell>
    );
  }

  const sec = (current?.section ?? "personal") as Section;
  const qi = current?.questionIndex ?? 0;
  const progress = done
    ? 100
    : Math.round((questionIndexGlobal(sec, qi, answersMap) / Math.max(1, totalQuestions(answersMap))) * 100);

  const stepOpts = getStepOptions(current);
  const showOptions = Boolean(stepOpts) && optionsActive && !done && !thinking;
  const showCreditSelect = credit?.phase === "select" && !done && !thinking;
  const showCreditCount = credit?.phase === "count" && !done && !thinking;
  const showDependantsCount = dependants?.phase === "count" && !done && !thinking;
  const showTextInput =
    !done &&
    Boolean(current) &&
    (textHandlerActive || (!credit && !dependants && !optionsActive && !stepOpts));

  return (
    <AppShell
      title="Chat fact-find"
      action={
        <Button variant="outline" size="sm" onClick={() => navigate({ to: "/home" })}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
      }
    >
      <div className="max-w-2xl mx-auto">
        <div className="mb-4">
          <Progress value={progress} className="h-2" />
          <div className="flex justify-between text-xs text-muted-foreground mt-2">
            <span>{current?.sectionTitle ?? (done ? "Finished" : "Starting…")}</span>
            <span>{progress}%</span>
          </div>
        </div>

        <div className="flex flex-col bg-card rounded-3xl border overflow-hidden" style={{ height: "min(70vh, 640px)" }}>
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b bg-card/60">
            <img src={avatarImg} alt="Susan" width={40} height={40} className="rounded-full" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold leading-tight">Susan</div>
              <div className="text-xs text-muted-foreground">Your mortgage fact-find assistant</div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full"
              onClick={() => navigate({ to: "/interview/$sessionId", params: { sessionId } })}
              title="Switch to the spoken assistant"
            >
              <Mic className="w-4 h-4 mr-1.5" /> Switch to voice
            </Button>
          </div>

          {/* Conversation */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.map((m) =>
              m.role === "assistant" ? (
                <div key={m.id} className="flex items-end gap-2">
                  <img src={avatarImg} alt="" width={28} height={28} className="rounded-full shrink-0" />
                  <div className="max-w-[80%] rounded-2xl rounded-bl-sm bg-muted px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
                    {m.text}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
                    {m.text}
                  </div>
                </div>
              ),
            )}

            {thinking && (
              <div className="flex items-end gap-2">
                <img src={avatarImg} alt="" width={28} height={28} className="rounded-full shrink-0" />
                <div className="rounded-2xl rounded-bl-sm bg-muted px-4 py-3">
                  <span className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-bounce [animation-delay:-0.3s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-bounce [animation-delay:-0.15s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-bounce" />
                  </span>
                </div>
              </div>
            )}

            {/* Inline controls */}
            {showOptions && stepOpts && (
              <div className="flex flex-wrap justify-end gap-2 pt-1">
                {stepOpts.options.map((o) => (
                  <Button key={o.value} variant="outline" size="sm" className="rounded-full" onClick={() => chooseOption(o.value, o.label)}>
                    {o.label}
                  </Button>
                ))}
                {stepOpts.allowOther && (
                  <Button variant="ghost" size="sm" className="rounded-full border border-dashed" onClick={() => chooseOther(stepOpts.otherPrompt)}>
                    {stepOpts.otherLabel}
                  </Button>
                )}
              </div>
            )}

            {showCreditSelect && credit && (
              <div className="space-y-2 pt-1">
                <div className="flex flex-wrap justify-end gap-2">
                  {CREDIT_TYPES.map((t) => {
                    const on = credit.selected.includes(t.key);
                    return (
                      <Button key={t.key} variant={on ? "default" : "outline"} size="sm" className="rounded-full" onClick={() => toggleCreditType(t.key)}>
                        {t.label}
                      </Button>
                    );
                  })}
                  <Button
                    variant={credit.selected.includes("other") ? "default" : "ghost"}
                    size="sm"
                    className="rounded-full border border-dashed"
                    onClick={() => toggleCreditType("other")}
                  >
                    Other
                  </Button>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" className="rounded-full" onClick={creditNone}>
                    None of these
                  </Button>
                  <Button size="sm" className="rounded-full" disabled={!credit.selected.length} onClick={creditContinue}>
                    Continue
                  </Button>
                </div>
              </div>
            )}

            {showCreditCount && credit && (
              <div className="flex flex-wrap justify-end gap-2 pt-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Button key={n} variant="outline" size="sm" className="rounded-full w-12" onClick={() => onCreditCount(n)}>
                    {n}
                  </Button>
                ))}
                <Button variant="ghost" size="sm" className="rounded-full border border-dashed" onClick={creditCountMore}>
                  6+
                </Button>
              </div>
            )}

            {showDependantsCount && dependants && (
              <div className="flex flex-wrap justify-end gap-2 pt-1">
                <Button variant="outline" size="sm" className="rounded-full" onClick={dependantsNone}>
                  None
                </Button>
                {[1, 2, 3, 4].map((n) => (
                  <Button key={n} variant="outline" size="sm" className="rounded-full w-12" onClick={() => onDependantCount(n)}>
                    {n}
                  </Button>
                ))}
                <Button variant="ghost" size="sm" className="rounded-full border border-dashed" onClick={dependantCountMore}>
                  5+
                </Button>
              </div>
            )}

            {done && (
              <div className="flex justify-center pt-3">
                <Button size="lg" onClick={handleFinish} disabled={submitting}>
                  {submitting ? "Submitting…" : "Review & submit"}
                </Button>
              </div>
            )}
          </div>

          {/* Input bar */}
          <div className="border-t p-3">
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
            >
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={!showTextInput || thinking}
                placeholder={
                  done
                    ? "Fact-find complete"
                    : showTextInput
                      ? textPlaceholder
                      : thinking
                        ? "Susan is typing…"
                        : "Tap an option above to continue"
                }
                className="flex-1 rounded-full border bg-background px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                aria-label="Type your answer"
              />
              <Button type="submit" size="icon" className="rounded-full shrink-0" disabled={!showTextInput || thinking || !input.trim()} aria-label="Send">
                <Send className="w-4 h-4" />
              </Button>
            </form>
          </div>
        </div>

        <p className="text-xs text-muted-foreground text-center mt-3">
          Susan is an AI assistant. Your answers are saved for your mortgage adviser — this is assistive only, not mortgage advice.
        </p>
      </div>
    </AppShell>
  );
}
