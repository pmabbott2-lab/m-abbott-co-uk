import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  getSession,
  submitSession,
  updateAnswer,
  getMyRole,
  addAdvisorNote,
  generateLenderExample,
  getContactTracking,
  markContacted,
  setNextContact,
  listContactHistory,
  getCustomerJourney,
  confirmJourneyMilestone,
} from "@/lib/sessions.functions";
import { SECTIONS } from "@/lib/interview-script";
import { mergeKeyFacts, formatGBP as fmtGBP } from "@/lib/structured-answers";
import {
  getAppointmentForSession,
  getSessionBooking,
  logCallbackAttempt,
  resolveCallback,
  markContactOpened,
} from "@/lib/booking.functions";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { CalendarCheck, Check, Clock, History, MapPin, PhoneCall, StickyNote } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/sessions/$sessionId")({
  component: SessionDetail,
});

function SessionDetail() {
  const { sessionId } = Route.useParams();
  const qc = useQueryClient();
  const getFn = useServerFn(getSession);
  const submitFn = useServerFn(submitSession);
  const updateFn = useServerFn(updateAnswer);
  const roleFn = useServerFn(getMyRole);

  const apptFn = useServerFn(getAppointmentForSession);

  const q = useQuery({ queryKey: ["session", sessionId], queryFn: () => getFn({ data: { sessionId } }) });
  const roleQ = useQuery({ queryKey: ["my-role"], queryFn: () => roleFn() });
  const apptQ = useQuery({ queryKey: ["appointment", sessionId], queryFn: () => apptFn({ data: { sessionId } }) });

  const submit = useMutation({
    mutationFn: () => submitFn({ data: { sessionId } }),
    onSuccess: () => {
      toast.success("Submitted to your advisor");
      qc.invalidateQueries({ queryKey: ["session", sessionId] });
      qc.invalidateQueries({ queryKey: ["my-sessions"] });
    },
  });

  if (q.isLoading || !q.data) {
    return <AppShell title="Session"><div className="py-16 text-center text-muted-foreground">Loading…</div></AppShell>;
  }

  const { session, answers, messages, customer } = q.data;
  const isAdvisor = roleQ.data?.isAdvisor ?? false;
  const answerMap = new Map(answers.map((a) => [`${a.section}:${a.field_key}`, a]));
  const keyFacts = mergeKeyFacts(answers);

  const onEdit = async (section: string, fieldKey: string, fieldLabel: string, value: string) => {
    try {
      await updateFn({ data: { sessionId, section, fieldKey, fieldLabel, value } });
      qc.invalidateQueries({ queryKey: ["session", sessionId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };

  return (
    <AppShell title={isAdvisor ? "Customer fact-find" : "Your fact-find"}>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-2xl font-semibold">Fact-find summary</h2>
            <p className="text-sm text-muted-foreground">
              Started {format(new Date(session.started_at), "PPP")} ·{" "}
              <span className="font-medium">{session.status === "submitted" ? "Submitted" : "In progress"}</span>
            </p>
          </div>
          {!isAdvisor && session.status !== "submitted" && (
            <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
              {submit.isPending ? "Submitting…" : "Submit to advisor"}
            </Button>
          )}
        </div>

        <Tabs defaultValue={isAdvisor ? "contact" : "journey"} className="w-full">
          <TabsList className="flex flex-wrap h-auto gap-1 w-full justify-start">
            {isAdvisor && (
              <>
                <TabsTrigger value="contact">Contact</TabsTrigger>
                <TabsTrigger value="notes">Notes &amp; history</TabsTrigger>
                <TabsTrigger value="factfind">Fact find</TabsTrigger>
              </>
            )}
            <TabsTrigger value="journey">Customer journey</TabsTrigger>
            {!isAdvisor && <TabsTrigger value="factfind">Your answers</TabsTrigger>}
          </TabsList>

          {isAdvisor && (
            <TabsContent value="contact" className="space-y-6 mt-4">
              <ContactCard customer={customer} />
              <AppointmentCallbackCard sessionId={sessionId} customer={customer} />
              <ContactTrackingCard sessionId={sessionId} />
            </TabsContent>
          )}

          {isAdvisor && (
            <TabsContent value="notes" className="space-y-6 mt-4">
              <AdvisorNoteInput sessionId={sessionId} />
              <ContactHistoryCard sessionId={sessionId} />
            </TabsContent>
          )}

          <TabsContent value="journey" className="space-y-6 mt-4">
            <CustomerJourneyTab sessionId={sessionId} isAdvisor={isAdvisor} />
          </TabsContent>

          <TabsContent value="factfind" className="space-y-6 mt-4">
            {!isAdvisor && apptQ.data && (
              <div className="rounded-2xl border bg-card p-5">
                <div className="flex items-center gap-2 font-semibold mb-2">
                  <CalendarCheck className="w-4 h-4 text-accent" />
                  Appointment booked
                </div>
                <dl className="grid sm:grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Date &amp; time</dt>
                    <dd className="font-medium">{format(new Date(apptQ.data.starts_at), "EEE d MMM yyyy, HH:mm")}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Duration</dt>
                    <dd className="font-medium">30 minutes</dd>
                  </div>
                </dl>
              </div>
            )}

            {isAdvisor && <LenderExampleCard sessionId={sessionId} />}
            <KeyFactsCard facts={keyFacts} />

            {(session as { summary?: string | null }).summary && (
              <div className="rounded-2xl border bg-card p-5">
                <h3 className="font-semibold mb-2">AI summary for the advisor</h3>
                <div className="text-sm whitespace-pre-wrap leading-relaxed">
                  {(session as { summary?: string | null }).summary}
                </div>
              </div>
            )}

            {SECTIONS.map((sec) => (
              <div key={sec.id} className="rounded-2xl border bg-card p-5">
                <h3 className="font-semibold mb-4">{sec.title}</h3>
                <dl className="divide-y">
                  {sec.questions.map((qst) => {
                    const a = answerMap.get(`${sec.id}:${qst.key}`);
                    return (
                      <div key={qst.key} className="py-3 grid grid-cols-1 sm:grid-cols-3 gap-2 items-start">
                        <dt className="text-sm text-muted-foreground">{qst.label}</dt>
                        <dd className="sm:col-span-2">
                          {isAdvisor || session.status === "submitted" ? (
                            <span className="text-sm">{a?.value || <em className="text-muted-foreground">No answer</em>}</span>
                          ) : (
                            <EditableValue
                              value={a?.value ?? ""}
                              onSave={(v) => onEdit(sec.id, qst.key, qst.label, v)}
                            />
                          )}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            ))}

            {messages.length > 0 && isAdvisor && (
              <div className="rounded-2xl border bg-card p-5">
                <h3 className="font-semibold mb-3">Interview transcript</h3>
                <p className="text-xs text-muted-foreground mb-4">
                  Full conversation record — useful for checking context behind the structured answers.
                </p>
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className={`text-sm rounded-lg p-3 ${m.role === "avatar" ? "bg-muted/50" : "bg-background border"}`}
                    >
                      <div className="text-xs font-medium text-muted-foreground mb-1">
                        {m.role === "avatar" ? "Susan" : "Customer"} · {format(new Date(m.created_at), "PPp")}
                      </div>
                      {m.text}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

const HISTORY_LABELS: Record<string, string> = {
  contact: "Contacted",
  note: "Note added",
  next_contact_set: "Next contact updated",
  appointment: "Appointment",
  callback: "Call-back",
  sms: "SMS",
  fact_find: "Fact-find",
  journey_milestone: "Journey",
};

const CALLBACK_WINDOW_LABELS: Record<string, string> = {
  "9-12": "9am–12pm",
  "12-4": "12pm–4pm",
  "4-8": "4pm–8pm",
};

const CALLBACK_STATUS_LABELS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  closed: "Closed",
};

// Format a timestamp in Europe/London (consistent with the rest of the app).
function formatLondon(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

// Advisor/admin-only: the appointment + call-back picture for this customer,
// directly below "Contact details". Shows appointment date/advisor/status with
// an Amend/Book action (routes to the booking flow as the calendar isn't fully
// live), plus any call-back request with a quick status update. Seeing a
// call-back here marks it opened so the Contacts-tab highlight clears.
function AppointmentCallbackCard({
  sessionId,
  customer,
}: {
  sessionId: string;
  customer: { full_name: string | null; email: string | null; phone: string | null } | null;
}) {
  const qc = useQueryClient();
  const getFn = useServerFn(getSessionBooking);
  const attemptFn = useServerFn(logCallbackAttempt);
  const resolveFn = useServerFn(resolveCallback);
  const openedFn = useServerFn(markContactOpened);

  const bookingQ = useQuery({
    queryKey: ["session-booking", sessionId],
    queryFn: () => getFn({ data: { sessionId } }),
  });

  const appointment = bookingQ.data?.appointment ?? null;
  const callback = bookingQ.data?.callback ?? null;

  // Mark the call-back as opened (clears the Contacts-tab "new" highlight).
  useEffect(() => {
    if (!callback) return;
    openedFn({ data: { contactType: "callback", contactId: callback.id } })
      .then(() => qc.invalidateQueries({ queryKey: ["advisor-contacts"] }))
      .catch(() => {});
  }, [callback, openedFn, qc]);

  const invalidateAfterAction = () => {
    qc.invalidateQueries({ queryKey: ["session-booking", sessionId] });
    qc.invalidateQueries({ queryKey: ["contact-history", sessionId] });
    qc.invalidateQueries({ queryKey: ["contact-tracking", sessionId] });
    qc.invalidateQueries({ queryKey: ["advisor-contacts"] });
    qc.invalidateQueries({ queryKey: ["advisor-customers"] });
    qc.invalidateQueries({ queryKey: ["all-sessions"] });
  };

  const logAttempt = useMutation({
    mutationFn: () => attemptFn({ data: { sessionId } }),
    onSuccess: () => {
      toast.success("Attempt logged");
      invalidateAfterAction();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not log attempt"),
  });

  const spokeTo = useMutation({
    mutationFn: () => resolveFn({ data: { callbackId: callback!.id, sessionId } }),
    onSuccess: () => {
      toast.success("Call-back resolved");
      invalidateAfterAction();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not update"),
  });

  const callbackResolved = callback?.status === "closed";
  const actionPending = logAttempt.isPending || spokeTo.isPending;

  return (
    <div className="rounded-2xl border bg-card p-5 space-y-4">
      <h3 className="font-semibold flex items-center gap-2">
        <CalendarCheck className="w-4 h-4 text-muted-foreground" />
        Appointment &amp; call-back
      </h3>

      <div className="rounded-lg border bg-background p-4 space-y-3">
        {bookingQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : appointment ? (
          <>
            <dl className="grid sm:grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Date &amp; time</dt>
                <dd className="font-medium">{formatLondon(appointment.startsAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Advisor</dt>
                <dd className="font-medium">{appointment.advisorName}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Status</dt>
                <dd className="font-medium capitalize">{appointment.status}</dd>
              </div>
            </dl>
            <Link to="/booking">
              <Button size="sm" variant="outline">Amend appointment</Button>
            </Link>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">No appointment booked for this customer yet.</p>
            <Link to="/booking">
              <Button size="sm">Book appointment</Button>
            </Link>
          </div>
        )}
      </div>

      {callback ? (
        <div className={`rounded-lg border bg-background p-4 space-y-3 ${callbackResolved ? "opacity-60" : ""}`}>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <PhoneCall className="w-3 h-3" /> Call-back requested
          </div>
          <dl className="grid sm:grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Preferred window</dt>
              <dd className="font-medium">{CALLBACK_WINDOW_LABELS[callback.preferredWindow] ?? callback.preferredWindow}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Requested</dt>
              <dd className="font-medium">{formatLondon(callback.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd className="font-medium">{CALLBACK_STATUS_LABELS[callback.status] ?? callback.status}</dd>
            </div>
          </dl>
          {callbackResolved ? (
            <p className="text-xs text-muted-foreground">Resolved — logged in History below.</p>
          ) : (
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="outline" disabled={actionPending} onClick={() => logAttempt.mutate()}>
                {logAttempt.isPending ? "Logging…" : "Log attempt"}
              </Button>
              <Button size="sm" disabled={actionPending} onClick={() => spokeTo.mutate()}>
                {spokeTo.isPending ? "Saving…" : "Spoke to customer"}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No call-back requested.</p>
      )}

      {customer?.phone && (
        <p className="text-xs text-muted-foreground">Customer mobile: {customer.phone}</p>
      )}
    </div>
  );
}

// Advisor-only: "Last contacted" stamp button + editable "Next contact" field.
function ContactTrackingCard({ sessionId }: { sessionId: string }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getContactTracking);
  const markFn = useServerFn(markContacted);
  const setNextFn = useServerFn(setNextContact);

  const trackingQ = useQuery({
    queryKey: ["contact-tracking", sessionId],
    queryFn: () => getFn({ data: { sessionId } }),
  });

  const [nextInput, setNextInput] = useState("");
  const [dirty, setDirty] = useState(false);

  const next = trackingQ.data?.nextContactAt ?? null;
  const last = trackingQ.data?.lastContactedAt ?? null;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["contact-tracking", sessionId] });
    qc.invalidateQueries({ queryKey: ["contact-history", sessionId] });
    qc.invalidateQueries({ queryKey: ["all-sessions"] });
  };

  const mark = useMutation({
    mutationFn: () => markFn({ data: { sessionId } }),
    onSuccess: (result) => {
      // Reflect the persisted timestamp immediately, then refetch to stay in sync.
      qc.setQueryData(["contact-tracking", sessionId], (old: typeof trackingQ.data) => ({
        lastContactedAt: result.lastContactedAt ?? old?.lastContactedAt ?? null,
        nextContactAt: old?.nextContactAt ?? null,
      }));
      toast.success("Marked as contacted");
      invalidate();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not update"),
  });

  const saveNext = useMutation({
    mutationFn: (value: string | null) =>
      setNextFn({ data: { sessionId, nextContactAt: value } }),
    onSuccess: () => {
      toast.success("Next contact saved");
      setDirty(false);
      invalidate();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  // Seed the datetime-local input from the saved value (once loaded).
  const seeded = next ? toLocalInput(new Date(next)) : "";

  return (
    <div className="rounded-2xl border bg-card p-5 space-y-4">
      <h3 className="font-semibold flex items-center gap-2">
        <PhoneCall className="w-4 h-4 text-muted-foreground" />
        Contact tracking
      </h3>
      <div className="space-y-4">
        <div className="rounded-lg border bg-background p-4 space-y-2">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" /> Last contacted
          </div>
          <div className="text-sm font-medium">
            {last ? format(new Date(last), "PPp") : <span className="text-muted-foreground">Not contacted yet</span>}
          </div>
          <Button size="sm" variant="outline" onClick={() => mark.mutate()} disabled={mark.isPending}>
            {mark.isPending ? "Saving…" : "Mark contacted now"}
          </Button>
        </div>
        <div className="rounded-lg border bg-background p-4 space-y-2">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <CalendarCheck className="w-3 h-3" /> Next contact
          </div>
          <Input
            type="datetime-local"
            value={dirty ? nextInput : seeded}
            onChange={(e) => {
              setNextInput(e.target.value);
              setDirty(true);
            }}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={saveNext.isPending}
              onClick={() => {
                const value = dirty ? nextInput : seeded;
                saveNext.mutate(value ? new Date(value).toISOString() : null);
              }}
            >
              {saveNext.isPending ? "Saving…" : "Save"}
            </Button>
            {(next || (dirty && nextInput)) && (
              <Button
                size="sm"
                variant="ghost"
                disabled={saveNext.isPending}
                onClick={() => {
                  setNextInput("");
                  setDirty(true);
                  saveNext.mutate(null);
                }}
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Advisor-only: chronological history (contact events, notes, next-contact
// changes, appointments and call-backs) — all timestamped.
function ContactHistoryCard({ sessionId }: { sessionId: string }) {
  const historyFn = useServerFn(listContactHistory);
  const historyQ = useQuery({
    queryKey: ["contact-history", sessionId],
    queryFn: () => historyFn({ data: { sessionId } }),
  });
  const entries = historyQ.data ?? [];

  return (
    <div className="rounded-2xl border bg-card p-5 space-y-3">
      <h3 className="font-semibold flex items-center gap-2">
        <History className="w-4 h-4 text-muted-foreground" />
        History
      </h3>
      <p className="text-xs text-muted-foreground">
        Full audit (newest first) — fact-find milestones, texts sent/received, appointments,
        call-backs, advisor notes, contact events and next-contact changes. All times Europe/London.
      </p>
      {historyQ.isLoading && <p className="text-sm text-muted-foreground">Loading history…</p>}
      {!historyQ.isLoading && entries.length === 0 && (
        <p className="text-sm text-muted-foreground">No history yet.</p>
      )}
      <div className="space-y-2">
        {entries.map((e) => (
          <div key={e.id} className="flex items-start gap-3 text-sm border-l-2 border-muted pl-3 py-1">
            <span className="text-xs px-2 py-0.5 rounded-full bg-muted shrink-0 mt-0.5">
              {HISTORY_LABELS[e.type] ?? e.type}
            </span>
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">{format(new Date(e.occurredAt), "PPp")}</div>
              {e.body && <div>{e.body}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Advisor-only: append-only note entry. Input only — each committed note is
// timestamped and surfaces in the History below (no separate notes panel).
function AdvisorNoteInput({ sessionId }: { sessionId: string }) {
  const qc = useQueryClient();
  const noteFn = useServerFn(addAdvisorNote);
  const [note, setNote] = useState("");

  const addNote = useMutation({
    mutationFn: (text: string) => noteFn({ data: { sessionId, note: text } }),
    onSuccess: () => {
      setNote("");
      toast.success("Note added");
      qc.invalidateQueries({ queryKey: ["contact-history", sessionId] });
      qc.invalidateQueries({ queryKey: ["all-sessions"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save note"),
  });

  return (
    <div className="rounded-2xl border bg-card p-5 space-y-3">
      <h3 className="font-semibold flex items-center gap-2">
        <StickyNote className="w-4 h-4 text-muted-foreground" />
        Advisor notes
      </h3>
      <p className="text-xs text-muted-foreground">
        Each note is committed as a timestamped entry and appears in the History below.
      </p>
      <textarea
        className="w-full border rounded-lg p-2 text-sm bg-background"
        placeholder="Add a note for the file…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
      />
      <Button size="sm" onClick={() => note.trim() && addNote.mutate(note.trim())} disabled={addNote.isPending}>
        {addNote.isPending ? "Saving…" : "Add note"}
      </Button>
    </div>
  );
}

// Format a Date as a value for <input type="datetime-local"> (local time, no TZ).
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function CustomerJourneyTab({
  sessionId,
  isAdvisor,
}: {
  sessionId: string;
  isAdvisor: boolean;
}) {
  const qc = useQueryClient();
  const journeyFn = useServerFn(getCustomerJourney);
  const confirmFn = useServerFn(confirmJourneyMilestone);

  const journeyQ = useQuery({
    queryKey: ["customer-journey", sessionId],
    queryFn: () => journeyFn({ data: { sessionId } }),
  });

  const confirm = useMutation({
    mutationFn: (milestoneKey: string) =>
      confirmFn({ data: { sessionId, milestoneKey: milestoneKey as "appointment_seen" | "id_confirmed" | "aip_completed" } }),
    onSuccess: () => {
      toast.success("Milestone confirmed");
      qc.invalidateQueries({ queryKey: ["customer-journey", sessionId] });
      qc.invalidateQueries({ queryKey: ["contact-history", sessionId] });
      qc.invalidateQueries({ queryKey: ["all-sessions"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not confirm"),
  });

  const milestones = journeyQ.data?.milestones ?? [];

  return (
    <div className="rounded-2xl border bg-card p-5 space-y-4">
      <h3 className="font-semibold flex items-center gap-2">
        <MapPin className="w-4 h-4 text-muted-foreground" />
        Customer journey
      </h3>
      <p className="text-xs text-muted-foreground">
        {isAdvisor
          ? "Confirm each milestone as the customer progresses. The customer is texted when you tick a step."
          : "Track where you are in your mortgage journey with your advisor."}
      </p>
      {journeyQ.isLoading && <p className="text-sm text-muted-foreground">Loading journey…</p>}
      <div className="space-y-2">
        {milestones.map((m) => {
          const done = !!m.completedAt;
          return (
            <button
              key={m.key}
              type="button"
              disabled={!isAdvisor || done || confirm.isPending}
              onClick={() => isAdvisor && !done && confirm.mutate(m.key)}
              className={`w-full flex items-center gap-3 rounded-lg border p-4 text-left transition ${
                done ? "bg-muted/40 opacity-90" : isAdvisor ? "hover:bg-muted/30 cursor-pointer" : ""
              }`}
            >
              <div
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                  done ? "bg-primary border-primary text-primary-foreground" : "bg-background"
                }`}
              >
                {done && <Check className="w-3.5 h-3.5" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm">{m.label}</div>
                {m.completedAt && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Completed {format(new Date(m.completedAt), "PPp")}
                  </div>
                )}
              </div>
            </button>
          );
        })}
        {!journeyQ.isLoading && milestones.length === 0 && (
          <p className="text-sm text-muted-foreground">Journey tracking will appear once the database migration is applied.</p>
        )}
      </div>
    </div>
  );
}

function ContactCard({
  customer,
}: {
  customer: { full_name: string | null; email: string | null; phone: string | null } | null;
}) {
  const items: Array<{ label: string; value: string }> = [];
  if (customer?.full_name) items.push({ label: "Name", value: customer.full_name });
  if (customer?.email) items.push({ label: "Email", value: customer.email });
  if (customer?.phone) items.push({ label: "Mobile", value: customer.phone });
  if (items.length === 0) return null;
  return (
    <div className="rounded-2xl border bg-card p-5">
      <h3 className="font-semibold mb-1">Contact details</h3>
      <p className="text-xs text-muted-foreground mb-4">From the account used for this fact-find.</p>
      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {items.map((it) => (
          <div key={it.label}>
            <dt className="text-xs text-muted-foreground">{it.label}</dt>
            <dd className="text-sm font-medium break-words">{it.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function KeyFactsCard({ facts }: { facts: ReturnType<typeof mergeKeyFacts> }) {
  const items: Array<{ label: string; value: string }> = [];
  if (facts.address) items.push({ label: "Address", value: facts.address });
  if (facts.property_price_gbp) items.push({ label: "Property price / value", value: fmtGBP(facts.property_price_gbp) });
  if (facts.deposit_gbp) items.push({ label: "Deposit", value: fmtGBP(facts.deposit_gbp) });
  if (facts.amount_owed_gbp) items.push({ label: "Balance owed", value: fmtGBP(facts.amount_owed_gbp) });
  if (facts.equity_gbp) items.push({ label: "Equity", value: fmtGBP(facts.equity_gbp) });
  if (facts.loan_amount_gbp) items.push({ label: "Loan required", value: fmtGBP(facts.loan_amount_gbp) });
  if (facts.annual_income_gbp) items.push({ label: "Annual income", value: fmtGBP(facts.annual_income_gbp) });
  if (facts.monthly_essentials_gbp) items.push({ label: "Monthly essentials", value: fmtGBP(facts.monthly_essentials_gbp) });
  if (facts.monthly_credit_gbp != null) items.push({ label: "Monthly credit payments", value: fmtGBP(facts.monthly_credit_gbp) });
  if (facts.credit_balance_gbp) items.push({ label: "Credit balances", value: fmtGBP(facts.credit_balance_gbp) });
  if (facts.mortgage_term_years) items.push({ label: "Term", value: `${facts.mortgage_term_years} years` });
  if (facts.employment_status) items.push({ label: "Employment", value: facts.employment_status });
  if (facts.purpose) items.push({ label: "Purpose", value: facts.purpose });
  if (facts.property_type) items.push({ label: "Property type", value: facts.property_type });
  if (facts.postcode && !facts.address) items.push({ label: "Postcode", value: facts.postcode });
  if (facts.adverse_credit != null) {
    items.push({ label: "Adverse credit", value: facts.adverse_credit ? "Yes — see detail below" : "None declared" });
  }
  if (items.length === 0) return null;

  return (
    <div className="rounded-2xl border bg-card p-5">
      <h3 className="font-semibold mb-3">Key figures</h3>
      <p className="text-xs text-muted-foreground mb-4">Extracted automatically from the customer&apos;s answers.</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {items.map((item) => (
          <div key={item.label} className="rounded-lg border bg-background p-3">
            <div className="text-xs text-muted-foreground">{item.label}</div>
            <div className="text-sm font-semibold">{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EditableValue({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  if (!editing) {
    return (
      <div className="flex items-start gap-2">
        <span className="text-sm flex-1">{value || <em className="text-muted-foreground">No answer</em>}</span>
        <button className="text-xs text-accent-foreground underline" onClick={() => { setVal(value); setEditing(true); }}>
          Edit
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <textarea
        className="w-full border rounded-md bg-background p-2 text-sm"
        value={val}
        onChange={(e) => setVal(e.target.value)}
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => { onSave(val); setEditing(false); }}>Save</Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
      </div>
    </div>
  );
}

function formatGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n);
}

function LenderExampleCard({ sessionId }: { sessionId: string }) {
  const genFn = useServerFn(generateLenderExample);
  const mut = useMutation({
    mutationFn: () => genFn({ data: { sessionId } }),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not generate example"),
  });
  const result = mut.data;

  return (
    <div className="rounded-2xl border bg-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold">Illustrative lender example</h3>
          <p className="text-sm text-muted-foreground">
            AI-generated illustration using the captured fact-find. Not a quote.
          </p>
        </div>
        <Button size="sm" onClick={() => mut.mutate()} disabled={mut.isPending}>
          {mut.isPending ? "Calculating…" : result ? "Recalculate" : "Generate example"}
        </Button>
      </div>

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label={result.inputs.isRemortgage ? "Value" : "Property"} value={formatGBP(result.inputs.price)} />
            {result.inputs.isRemortgage ? (
              <Stat label="Equity" value={formatGBP(result.inputs.equity ?? result.inputs.deposit)} />
            ) : (
              <Stat label="Deposit" value={formatGBP(result.inputs.deposit)} />
            )}
            <Stat label={result.inputs.isRemortgage ? "Balance owed" : "Loan"} value={formatGBP(result.inputs.loan)} />
            <Stat label="LTV" value={`${result.inputs.ltv.toFixed(1)}%`} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Product" value={result.illustration.product} />
            <Stat label="Rate" value={`${result.illustration.rate.toFixed(2)}%`} />
            <Stat label="Term" value={`${result.inputs.term} yrs`} />
            <Stat label="Monthly" value={formatGBP(result.illustration.monthly)} highlight />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Total payable" value={formatGBP(result.illustration.totalPayable)} />
            {result.illustration.incomeMultiple != null && (
              <Stat label="Income multiple" value={`${result.illustration.incomeMultiple.toFixed(1)}×`} />
            )}
          </div>
          {result.illustration.note && (
            <div className="text-sm bg-muted/40 rounded-lg p-3 leading-relaxed">
              {result.illustration.note}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "bg-primary/10 border-primary/30" : "bg-background"}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold ${highlight ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}

