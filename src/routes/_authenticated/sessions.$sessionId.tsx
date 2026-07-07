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
  reverseJourneyMilestone,
  amendContactHistoryEntry,
  updateCaseRef,
  promoteSessionToCaseAsStaff,
} from "@/lib/sessions.functions";
import {
  listSessionFees,
  upsertDraftFee,
  submitSessionFees,
  amendPostedFee,
  FEE_TYPE_LABELS,
} from "@/lib/finance.functions";
import { canAmend, canView, canAmendHistory } from "@/lib/admin-access";
import { SECTIONS } from "@/lib/interview-script";
import { mergeKeyFacts, formatGBP as fmtGBP } from "@/lib/structured-answers";
import {
  getSessionBooking,
  logCallbackAttempt,
  listSessionCrmContacts,
  getAppointmentForSession,
} from "@/lib/booking.functions";
import { MarkContactedButton } from "@/components/MarkContactedButton";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { CalendarCheck, Check, Clock, History, MapPin, PhoneCall, StickyNote } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PostCompletionBooking,
  CALLBACK_WINDOW_RANGES,
} from "@/components/PostCompletionBooking";
import { CustomerHubBookingDialog } from "@/components/CustomerHubBookingDialog";
import { CrmContactCard } from "@/components/CrmContactCard";
import { ReportExportBox } from "@/components/ReportExportBox";
import { ReportTableScroll } from "@/components/ReportTableScroll";
import { contactHistoryToSheet } from "@/lib/report-mappers";
import { PhoneCallDetailDialog } from "@/components/PhoneCallDetailDialog";

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

  const q = useQuery({ queryKey: ["session", sessionId], queryFn: () => getFn({ data: { sessionId } }) });
  const roleQ = useQuery({ queryKey: ["my-role"], queryFn: () => roleFn() });
  const bookingFn = useServerFn(getSessionBooking);
  const bookingQ = useQuery({
    queryKey: ["session-booking", sessionId],
    queryFn: () => bookingFn({ data: { sessionId } }),
    enabled: Boolean(q.data) && (roleQ.data?.isAdvisor ?? false),
  });
  const apptFn = useServerFn(getAppointmentForSession);
  const customerApptQ = useQuery({
    queryKey: ["session-appointment", sessionId],
    queryFn: () => apptFn({ data: { sessionId } }),
    enabled: Boolean(q.data) && !(roleQ.data?.isAdvisor ?? false),
  });

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
  const adminAccess = roleQ.data?.adminAccess ?? null;
  const isOwner = roleQ.data?.isOwner ?? false;
  const showFinance = canView(adminAccess, "finance_customer");
  const answerMap = new Map(answers.map((a) => [`${a.section}:${a.field_key}`, a]));
  const keyFacts = mergeKeyFacts(answers);
  const summary = (session as { summary?: string | null }).summary ?? null;
  const caseRef = (session as { case_ref?: string | null }).case_ref ?? null;
  const isCase = Boolean(caseRef);
  const customerId = (session as { customer_id?: string }).customer_id ?? customer?.id;
  const customerDisplayName = customer?.full_name || customer?.email || "Customer";
  const hasAppointment = Boolean(bookingQ.data?.appointment);

  const invalidateSession = () => {
    qc.invalidateQueries({ queryKey: ["session", sessionId] });
    qc.invalidateQueries({ queryKey: ["session-booking", sessionId] });
    qc.invalidateQueries({ queryKey: ["customer-hub", customerId] });
    qc.invalidateQueries({ queryKey: ["all-sessions"] });
  };

  const onEdit = async (section: string, fieldKey: string, fieldLabel: string, value: string) => {
    try {
      await updateFn({ data: { sessionId, section, fieldKey, fieldLabel, value } });
      qc.invalidateQueries({ queryKey: ["session", sessionId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };

  return (
    <AppShell
      title={isAdvisor ? "Customer fact-find" : "Your fact-find"}
      backTo={isAdvisor && customerId ? "/customers/$customerId" : isAdvisor ? "/home" : "/cases"}
      backParams={isAdvisor && customerId ? { customerId } : undefined}
      backLabel={isAdvisor ? "Customer" : "Your cases"}
    >
      <div className="max-w-3xl mx-auto space-y-6">

        {!isAdvisor && customerApptQ.data && session.status !== "submitted" && (
          <div className="rounded-2xl border bg-card p-5 space-y-3">
            <h3 className="font-semibold">Your upcoming appointment</h3>
            <p className="text-sm text-muted-foreground">
              Confirmed for{" "}
              {format(new Date(customerApptQ.data.starts_at), "EEE d MMM yyyy, HH:mm")}. Choose how
              you&apos;d like to prepare — or confirm attendance only.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" asChild>
                <Link to="/interview/$sessionId" params={{ sessionId }}>
                  Spoken fact-find
                </Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link to="/chat/$sessionId" params={{ sessionId }}>
                  Type fact-find
                </Link>
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => toast.success("Attendance confirmed — see you at your appointment")}
              >
                Confirm attendance only
              </Button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-2xl font-semibold">
              {isAdvisor
                ? isCase
                  ? "Case"
                  : "Fact-find review"
                : isCase
                  ? "Your case"
                  : "Your fact-find"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {caseRef && (
                <span className="font-mono font-medium text-foreground mr-2">{caseRef}</span>
              )}
              Started {format(new Date(session.started_at), "PPP")} ·{" "}
              <span className="font-medium">{session.status === "submitted" ? "Submitted" : "In progress"}</span>
            </p>
            {isAdvisor && customerId && (
              <Link
                to="/customers/$customerId"
                params={{ customerId }}
                className="text-xs text-primary hover:underline mt-1 inline-block"
              >
                View customer record (contact &amp; introducer)
              </Link>
            )}
          </div>
          {!isAdvisor && session.status !== "submitted" && (
            <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
              {submit.isPending ? "Submitting…" : "Submit to advisor"}
            </Button>
          )}
        </div>

        <Tabs defaultValue={isAdvisor ? (isCase ? "crm" : "factfind") : "factfind"} className="w-full">
          <TabsList className="flex flex-wrap h-auto gap-1 w-full justify-start">
            {isAdvisor && isCase ? (
              <>
                <TabsTrigger value="crm">CRM</TabsTrigger>
                <TabsTrigger value="notes">Notes &amp; history</TabsTrigger>
                <TabsTrigger value="factfind">Fact find</TabsTrigger>
                <TabsTrigger value="journey">Customer journey</TabsTrigger>
                {showFinance && <TabsTrigger value="finance">Finance</TabsTrigger>}
              </>
            ) : isAdvisor ? (
              <TabsTrigger value="factfind">Fact find</TabsTrigger>
            ) : (
              <>
                <TabsTrigger value="factfind">Fact find</TabsTrigger>
                {isCase && <TabsTrigger value="journey">Your journey</TabsTrigger>}
              </>
            )}
          </TabsList>

          {isAdvisor && isCase && (
            <TabsContent value="crm" className="space-y-6 mt-4">
              <CrmContactCard sessionId={sessionId} customer={customer} clickToCall />
              {customerId && (
                <Link to="/customers/$customerId" params={{ customerId }}>
                  <Button variant="outline" size="sm">Open customer record</Button>
                </Link>
              )}
              <CaseRefEditor
                sessionId={sessionId}
                caseRef={caseRef}
                canEdit={isOwner || canAmend(adminAccess, "customers")}
              />
              <AppointmentCallbackCard
                sessionId={sessionId}
                customerId={customerId ?? ""}
                customer={customer}
                onBookingChanged={invalidateSession}
              />
              <ContactTrackingCard sessionId={sessionId} />
            </TabsContent>
          )}

          {isAdvisor && isCase && (
            <TabsContent value="notes" className="space-y-6 mt-4">
              <AdvisorNoteInput sessionId={sessionId} />
              <ContactHistoryCard sessionId={sessionId} caseRef={caseRef} isOwner={isOwner} />
            </TabsContent>
          )}

          {(isCase || !isAdvisor) && (
            <TabsContent value="journey" className="space-y-6 mt-4">
              <CustomerJourneyTab
                sessionId={sessionId}
                isAdvisor={isAdvisor}
                canReverse={canAmend(adminAccess, "journey")}
              />
            </TabsContent>
          )}

          {showFinance && isCase && (
            <TabsContent value="finance" className="space-y-6 mt-4">
              <CustomerFinanceCard
                sessionId={sessionId}
                canAmendFees={canAmend(adminAccess, "finance_customer")}
              />
            </TabsContent>
          )}

          <TabsContent value="factfind" className="space-y-6 mt-4">
            {isAdvisor && !isCase && customerId && (
              <PreCaseOpenCaseActions
                customerId={customerId}
                sessionId={sessionId}
                customerName={customerDisplayName}
                customerEmail={customer?.email}
                customerPhone={customer?.phone}
                hasAppointment={hasAppointment}
                onChanged={invalidateSession}
              />
            )}
            {isAdvisor && !isCase && (
              <div className="rounded-xl border border-amber-200/80 bg-amber-50/80 dark:bg-amber-950/20 p-4 text-sm text-muted-foreground">
                Journey, CRM, finance and a case reference unlock once you book an appointment (or
                create a case from an existing appointment above).
              </div>
            )}
            <Tabs defaultValue="summary" className="w-full">
              <TabsList className="flex flex-wrap h-auto gap-1 w-full justify-start mb-4">
                <TabsTrigger value="summary">Summary</TabsTrigger>
                <TabsTrigger value="keyfacts">Key figures</TabsTrigger>
                <TabsTrigger value="illustration">Illustration</TabsTrigger>
                <TabsTrigger value="answers">Answers</TabsTrigger>
                {isAdvisor && messages.length > 0 && (
                  <TabsTrigger value="transcript">Transcript</TabsTrigger>
                )}
              </TabsList>

              <TabsContent value="summary" className="space-y-4">
                {summary ? (
                  <div className="rounded-2xl border bg-card p-5">
                    <h3 className="font-semibold mb-2">Fact-find summary</h3>
                    <p className="text-xs text-muted-foreground mb-3">
                      {isAdvisor
                        ? "AI overview of the customer's answers."
                        : "Overview of your answers — the same view your advisor sees."}
                    </p>
                    <div className="text-sm whitespace-pre-wrap leading-relaxed">{summary}</div>
                  </div>
                ) : (
                  <div className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
                    {isAdvisor
                      ? "Summary will appear once the customer submits or enough answers are captured."
                      : "Your summary is being prepared. Check back shortly or review your answers."}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="keyfacts">
                <KeyFactsCard facts={keyFacts} />
              </TabsContent>

              <TabsContent value="illustration">
                <LenderExampleCard sessionId={sessionId} />
              </TabsContent>

              <TabsContent value="answers" className="space-y-6">
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
              </TabsContent>

              {isAdvisor && messages.length > 0 && (
                <TabsContent value="transcript">
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
                </TabsContent>
              )}
            </Tabs>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

/** Customer-facing: appointment / call-back status + book or amend. */
function CustomerNextStepsCard({
  sessionId,
  booking,
  bookingLoading,
  customerName,
  customerEmail,
  onBookingChange,
}: {
  sessionId: string;
  booking:
    | {
        appointment: {
          id: string;
          startsAt: string;
          status: string;
          advisorName: string;
        } | null;
        callback: {
          id: string;
          preferredWindow: string;
          status: string;
          createdAt: string;
        } | null;
      }
    | undefined;
  bookingLoading: boolean;
  customerName: string;
  customerEmail: string;
  onBookingChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const appointment = booking?.appointment ?? null;
  const callback = booking?.callback ?? null;
  const callbackOpen = callback && callback.status === "new";

  if (editing) {
    return (
      <div className="rounded-2xl border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">Book or change your appointment</h3>
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
        <PostCompletionBooking
          sessionId={sessionId}
          channel="text"
          defaultName={customerName}
          defaultEmail={customerEmail}
          onComplete={() => {
            setEditing(false);
            onBookingChange();
            toast.success("Updated");
          }}
        />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-card p-5 space-y-4">
      <h3 className="font-semibold">Next steps</h3>
      {bookingLoading && <p className="text-sm text-muted-foreground">Loading your booking details…</p>}

      {!bookingLoading && appointment && (
        <div className="rounded-xl border bg-background p-4 space-y-2">
          <div className="flex items-center gap-2 font-medium text-sm">
            <CalendarCheck className="w-4 h-4 text-accent" />
            Appointment booked
          </div>
          <dl className="grid sm:grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Date &amp; time</dt>
              <dd className="font-medium">
                {format(new Date(appointment.startsAt), "EEE d MMM yyyy, HH:mm")}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Advisor</dt>
              <dd className="font-medium">{appointment.advisorName}</dd>
            </div>
          </dl>
        </div>
      )}

      {!bookingLoading && callbackOpen && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-2">
          <div className="flex items-center gap-2 font-medium text-sm">
            <PhoneCall className="w-4 h-4 text-primary" />
            Call-back requested
          </div>
          <dl className="grid sm:grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Preferred window</dt>
              <dd className="font-medium">
                {CALLBACK_WINDOW_LABELS[callback.preferredWindow] ??
                  (CALLBACK_WINDOW_RANGES[callback.preferredWindow as keyof typeof CALLBACK_WINDOW_RANGES]
                    ? `Between ${CALLBACK_WINDOW_RANGES[callback.preferredWindow as keyof typeof CALLBACK_WINDOW_RANGES]}`
                    : callback.preferredWindow)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Status</dt>
              <dd className="font-medium">
                {CALLBACK_STATUS_LABELS[callback.status] ?? callback.status}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Requested</dt>
              <dd className="font-medium">{format(new Date(callback.createdAt), "d MMM yyyy, HH:mm")}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            An advisor will call you in this window. You can still book a specific appointment below if you prefer.
          </p>
        </div>
      )}

      {!bookingLoading && !appointment && !callbackOpen && (
        <p className="text-sm text-muted-foreground">
          No appointment or call-back on file yet. Book a time or request a call-back when you&apos;re ready.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => setEditing(true)}>
          {appointment ? "Change appointment" : "Book an appointment"}
        </Button>
        <Button type="button" variant="outline" onClick={() => setEditing(true)}>
          {callbackOpen ? "Change call-back window" : "Request a call-back"}
        </Button>
      </div>
    </div>
  );
}

const HISTORY_LABELS: Record<string, string> = {
  contact: "Contacted",
  note: "Note added",
  next_contact_set: "Next contact updated",
  history_amend: "History amended",
  finance: "Finance",
  appointment: "Appointment",
  callback: "Call-back",
  phone_call: "Phone call",
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

function PreCaseOpenCaseActions({
  customerId,
  sessionId,
  customerName,
  customerEmail,
  customerPhone,
  hasAppointment,
  onChanged,
}: {
  customerId: string;
  sessionId: string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  hasAppointment: boolean;
  onChanged: () => void;
}) {
  const promoteFn = useServerFn(promoteSessionToCaseAsStaff);
  const promote = useMutation({
    mutationFn: () => promoteFn({ data: { sessionId, customerId } }),
    onSuccess: (result) => {
      toast.success(`Case opened — ${result.caseRef}`);
      onChanged();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not open case"),
  });

  return (
    <div className="rounded-2xl border-2 border-primary/20 bg-primary/5 p-5 space-y-3">
      <div className="flex items-start gap-3">
        <CalendarCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div className="space-y-1 min-w-0">
          <h3 className="font-semibold">Open a case for this customer</h3>
          <p className="text-sm text-muted-foreground">
            {hasAppointment
              ? "An appointment is already on file — create the case reference to unlock CRM, journey and finance."
              : "Book an appointment on their behalf. A case reference (MG-…) is assigned automatically."}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {hasAppointment ? (
          <Button disabled={promote.isPending} onClick={() => promote.mutate()}>
            {promote.isPending ? "Opening case…" : "Create case from appointment"}
          </Button>
        ) : (
          <CustomerHubBookingDialog
            customerId={customerId}
            customerName={customerName}
            customerEmail={customerEmail}
            customerPhone={customerPhone}
            factFinds={[]}
            sessionId={sessionId}
            triggerLabel="Book appointment & open case"
            triggerVariant="default"
            onBooked={onChanged}
          />
        )}
      </div>
    </div>
  );
}

// Advisor/admin-only: the appointment + call-back picture for this customer,
// directly below "Contact details". Shows appointment date/advisor/status with
// an Amend/Book action (routes to the booking flow as the calendar isn't fully
// live), plus any call-back request with a quick status update. Seeing a
// call-back here marks it opened so the Contacts-tab highlight clears.
function AppointmentCallbackCard({
  sessionId,
  customerId,
  customer,
  onBookingChanged,
}: {
  sessionId: string;
  customerId: string;
  customer: { full_name: string | null; email: string | null; phone: string | null } | null;
  onBookingChanged?: () => void;
}) {
  const qc = useQueryClient();
  const getFn = useServerFn(getSessionBooking);
  const crmContactsFn = useServerFn(listSessionCrmContacts);
  const attemptFn = useServerFn(logCallbackAttempt);
  const [detailCallId, setDetailCallId] = useState<string | null>(null);

  const bookingQ = useQuery({
    queryKey: ["session-booking", sessionId],
    queryFn: () => getFn({ data: { sessionId } }),
  });
  const crmContactsQ = useQuery({
    queryKey: ["session-crm-contacts", sessionId],
    queryFn: () => crmContactsFn({ data: { sessionId } }),
  });

  const appointment = bookingQ.data?.appointment ?? null;
  const crmItems = crmContactsQ.data ?? [];
  const openCallback = crmItems.find((i) => i.contactType === "callback" && !i.contacted);

  const invalidateAfterAction = () => {
    qc.invalidateQueries({ queryKey: ["session-booking", sessionId] });
    qc.invalidateQueries({ queryKey: ["session-crm-contacts", sessionId] });
    qc.invalidateQueries({ queryKey: ["contact-history", sessionId] });
    qc.invalidateQueries({ queryKey: ["contact-tracking", sessionId] });
    qc.invalidateQueries({ queryKey: ["advisor-contacts"] });
    qc.invalidateQueries({ queryKey: ["advisor-customers"] });
    qc.invalidateQueries({ queryKey: ["all-sessions"] });
    onBookingChanged?.();
  };

  const logAttempt = useMutation({
    mutationFn: () => attemptFn({ data: { sessionId } }),
    onSuccess: () => {
      toast.success("Attempt logged");
      invalidateAfterAction();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not log attempt"),
  });

  return (
    <div className="rounded-2xl border bg-card p-5 space-y-4">
      <h3 className="font-semibold flex items-center gap-2">
        <CalendarCheck className="w-4 h-4 text-muted-foreground" />
        Appointment &amp; contacts
      </h3>
      <p className="text-xs text-muted-foreground">
        Inbound voicemails, outbound calls, and call-backs. Press Contacted when handled — the item
        greys out, drops from Contacts after 24 hours, and stays in History.
      </p>

      {crmItems.length > 0 && (
        <div className="rounded-lg border bg-background divide-y">
          {crmItems.map((item) => (
            <div
              key={`${item.contactType}-${item.id}`}
              className={`flex flex-wrap items-center justify-between gap-3 p-4 text-sm ${
                item.contacted ? "opacity-60 bg-muted/30" : ""
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium flex items-center gap-2 flex-wrap">
                  {item.title}
                  {item.contacted && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                      Contacted
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{item.subtitle}</div>
                {item.summary && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.summary}</p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {item.phoneCallId && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setDetailCallId(item.phoneCallId!)}
                    disabled={item.aiStatus === "processing" || item.aiStatus === "pending"}
                  >
                    {item.aiStatus === "complete"
                      ? "View summary"
                      : item.aiStatus === "processing"
                        ? "Transcribing…"
                        : "View"}
                  </Button>
                )}
                <MarkContactedButton
                  contactType={item.contactType}
                  contactId={item.id}
                  sessionId={sessionId}
                  contacted={item.contacted}
                  onDone={invalidateAfterAction}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {crmContactsQ.isSuccess && crmItems.length === 0 && (
        <p className="text-xs text-muted-foreground">No open voicemails, calls, or call-backs for this case.</p>
      )}

      <PhoneCallDetailDialog
        callId={detailCallId}
        open={Boolean(detailCallId)}
        onOpenChange={(open) => !open && setDetailCallId(null)}
      />

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
            <Link to="/diary">
              <Button size="sm" variant="outline">View diary</Button>
            </Link>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">No appointment booked for this customer yet.</p>
            {customerId ? (
              <CustomerHubBookingDialog
                customerId={customerId}
                customerName={customer?.full_name || customer?.email || "Customer"}
                customerEmail={customer?.email}
                customerPhone={customer?.phone}
                factFinds={[]}
                sessionId={sessionId}
                triggerLabel="Book appointment"
                triggerVariant="default"
                onBooked={invalidateAfterAction}
              />
            ) : (
              <p className="text-xs text-muted-foreground">Customer link unavailable.</p>
            )}
          </div>
        )}
      </div>

      {openCallback && (
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" disabled={logAttempt.isPending} onClick={() => logAttempt.mutate()}>
            {logAttempt.isPending ? "Logging…" : "Log call attempt (no answer)"}
          </Button>
        </div>
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
// Owner can amend/delete contact-log rows only.
function ContactHistoryCard({
  sessionId,
  caseRef,
  isOwner,
}: {
  sessionId: string;
  caseRef: string | null;
  isOwner: boolean;
}) {
  const qc = useQueryClient();
  const historyFn = useServerFn(listContactHistory);
  const amendFn = useServerFn(amendContactHistoryEntry);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [historyCallId, setHistoryCallId] = useState<string | null>(null);

  const historyQ = useQuery({
    queryKey: ["contact-history", sessionId],
    queryFn: () => historyFn({ data: { sessionId } }),
  });
  const entries = historyQ.data ?? [];
  const exportSheet = contactHistoryToSheet(entries, HISTORY_LABELS);
  const exportFilename = `contact-history-${caseRef ?? sessionId.slice(0, 8)}`;

  const amend = useMutation({
    mutationFn: (vars: { entryId: string; body?: string; delete?: boolean }) =>
      amendFn({ data: { sessionId, ...vars } }),
    onSuccess: () => {
      setEditingId(null);
      toast.success("History updated");
      qc.invalidateQueries({ queryKey: ["contact-history", sessionId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not amend"),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border bg-card p-5 space-y-3">
        <h3 className="font-semibold flex items-center gap-2">
          <History className="w-4 h-4 text-muted-foreground" />
          History
        </h3>
        <p className="text-xs text-muted-foreground">
          Full audit (newest first) — fact-find milestones, texts sent/received, appointments,
          call-backs, advisor notes, contact events and next-contact changes. All times Europe/London.
          {isOwner && " As owner you can amend or delete contact-log entries."}
        </p>
        {historyQ.isLoading && <p className="text-sm text-muted-foreground">Loading history…</p>}
        {!historyQ.isLoading && entries.length === 0 && (
          <p className="text-sm text-muted-foreground">No history yet.</p>
        )}
        {entries.length > 0 && (
          <ReportTableScroll visibleRows={15} className="border-0">
            <div className="space-y-2 p-3">
              {entries.map((e) => (
                <div
                  key={e.id}
                  className={`flex items-start gap-3 text-sm border-l-2 pl-3 py-1 ${
                    e.deleted || e.amended ? "border-destructive/60" : "border-muted"
                  }`}
                >
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full shrink-0 mt-0.5 ${
                      e.deleted || e.amended ? "bg-destructive/15 text-destructive" : "bg-muted"
                    }`}
                  >
                    {HISTORY_LABELS[e.type] ?? e.type}
                    {e.deleted ? " · deleted" : e.amended ? " · amended" : ""}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-muted-foreground">{format(new Date(e.occurredAt), "PPp")}</div>
                    {editingId === e.id ? (
                      <div className="mt-1 space-y-2">
                        <Input value={editBody} onChange={(ev) => setEditBody(ev.target.value)} />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={amend.isPending}
                            onClick={() => amend.mutate({ entryId: e.id, body: editBody })}
                          >
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {e.body && (
                          <div className={e.deleted ? "text-destructive line-through" : e.amended ? "text-destructive" : ""}>
                            {e.body}
                          </div>
                        )}
                        {e.callId && e.hasAttachment && !e.deleted && (
                          <Button
                            type="button"
                            size="sm"
                            variant="link"
                            className="h-auto p-0 mt-1"
                            onClick={() => setHistoryCallId(e.callId!)}
                          >
                            View call summary
                          </Button>
                        )}
                      </>
                    )}
                    {isOwner && e.amendable && !e.deleted && editingId !== e.id && (
                      <div className="flex gap-2 mt-1">
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:underline"
                          onClick={() => {
                            setEditingId(e.id);
                            setEditBody(e.body ?? "");
                          }}
                        >
                          Amend
                        </button>
                        <button
                          type="button"
                          className="text-xs text-destructive hover:underline"
                          onClick={() => {
                            if (confirm("Soft-delete this history entry? (Owner only — leaves an audit trail.)")) {
                              amend.mutate({ entryId: e.id, delete: true });
                            }
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ReportTableScroll>
        )}
        <PhoneCallDetailDialog
          callId={historyCallId}
          open={Boolean(historyCallId)}
          onOpenChange={(open) => !open && setHistoryCallId(null)}
        />
      </div>
      <div className="self-start pt-1">
        <ReportExportBox
          filename={exportFilename}
          label="History"
          sheets={[exportSheet]}
          pdfTitle={`Contact history${caseRef ? ` — ${caseRef}` : ""}`}
        />
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
  canReverse = false,
}: {
  sessionId: string;
  isAdvisor: boolean;
  canReverse?: boolean;
}) {
  const qc = useQueryClient();
  const journeyFn = useServerFn(getCustomerJourney);
  const confirmFn = useServerFn(confirmJourneyMilestone);
  const reverseFn = useServerFn(reverseJourneyMilestone);

  const journeyQ = useQuery({
    queryKey: ["customer-journey", sessionId],
    queryFn: () => journeyFn({ data: { sessionId } }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["customer-journey", sessionId] });
    qc.invalidateQueries({ queryKey: ["contact-history", sessionId] });
    qc.invalidateQueries({ queryKey: ["all-sessions"] });
  };

  const confirm = useMutation({
    mutationFn: (milestoneKey: string) =>
      confirmFn({
        data: {
          sessionId,
          milestoneKey: milestoneKey as "appointment_seen" | "id_confirmed" | "aip_completed",
        },
      }),
    onSuccess: () => {
      toast.success("Milestone confirmed");
      invalidate();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not confirm"),
  });

  const reverse = useMutation({
    mutationFn: (milestoneKey: string) =>
      reverseFn({
        data: {
          sessionId,
          milestoneKey: milestoneKey as "appointment_seen" | "id_confirmed" | "aip_completed",
        },
      }),
    onSuccess: () => {
      toast.success("Milestone reversed");
      invalidate();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not reverse"),
  });

  const milestones = journeyQ.data?.milestones ?? [];
  const busy = confirm.isPending || reverse.isPending;

  return (
    <div className="rounded-2xl border bg-card p-5 space-y-4">
      <h3 className="font-semibold flex items-center gap-2">
        <MapPin className="w-4 h-4 text-muted-foreground" />
        Customer journey
      </h3>
      <p className="text-xs text-muted-foreground">
        {isAdvisor
          ? "Confirm each milestone as the customer progresses. The customer is texted when you tick a step. Only an admin can reverse a confirmed milestone."
          : "Track where you are in your mortgage journey with your advisor."}
      </p>
      {journeyQ.isLoading && <p className="text-sm text-muted-foreground">Loading journey…</p>}
      <div className="space-y-2">
        {milestones.map((m) => {
          const done = !!m.completedAt;
          return (
            <div
              key={m.key}
              className={`w-full flex items-center gap-3 rounded-lg border p-4 text-left ${
                done ? "bg-muted/40" : ""
              }`}
            >
              <button
                type="button"
                disabled={!isAdvisor || done || busy}
                onClick={() => isAdvisor && !done && confirm.mutate(m.key)}
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                  done ? "bg-primary border-primary text-primary-foreground" : "bg-background"
                } ${isAdvisor && !done ? "hover:ring-2 hover:ring-primary/30" : ""}`}
                aria-label={done ? m.label : `Confirm ${m.label}`}
              >
                {done && <Check className="w-3.5 h-3.5" />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm">{m.label}</div>
                {m.completedAt && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Completed {format(new Date(m.completedAt), "PPp")}
                  </div>
                )}
              </div>
              {done && canReverse && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => reverse.mutate(m.key)}
                >
                  Reverse
                </Button>
              )}
            </div>
          );
        })}
        {!journeyQ.isLoading && milestones.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Journey tracking will appear once the database migration is applied.
          </p>
        )}
      </div>
    </div>
  );
}

function CustomerFinanceCard({
  sessionId,
  canAmendFees,
}: {
  sessionId: string;
  canAmendFees: boolean;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listSessionFees);
  const upsertFn = useServerFn(upsertDraftFee);
  const submitFn = useServerFn(submitSessionFees);
  const amendFn = useServerFn(amendPostedFee);

  const [feeType, setFeeType] = useState<"fee" | "mortgage_fee" | "insurance_fee" | "other_fee">("fee");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const feesQ = useQuery({
    queryKey: ["session-fees", sessionId],
    queryFn: () => listFn({ data: { sessionId } }),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["session-fees", sessionId] });

  const addDraft = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          sessionId,
          feeType,
          amountPounds: Number(amount),
          note: note || undefined,
        },
      }),
    onSuccess: () => {
      setAmount("");
      setNote("");
      toast.success("Draft fee added");
      refresh();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not add fee"),
  });

  const submit = useMutation({
    mutationFn: () => submitFn({ data: { sessionId } }),
    onSuccess: (r) => {
      toast.success(`Submitted ${r.count} fee(s) — locked to ledger`);
      refresh();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not submit"),
  });

  const amend = useMutation({
    mutationFn: (vars: { lineId: string; amountPounds?: number; delete?: boolean }) =>
      amendFn({ data: vars }),
    onSuccess: () => {
      toast.success("Amendment recorded (red on ledger)");
      refresh();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not amend"),
  });

  const lines = feesQ.data?.lines ?? [];
  const drafts = lines.filter((l) => l.status === "draft");
  const posted = lines.filter((l) => l.status === "posted" || l.status === "amended");

  if (feesQ.data?.migrationRequired) {
    return (
      <div className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
        Run the admin/finance SQL migration to enable customer fees.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-card p-5 space-y-5">
      <div>
        <h3 className="font-semibold">Customer fees</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Add draft fees, then Submit to lock them. Amendments and deletions appear as red ledger
          transactions for the owner report.
        </p>
      </div>

      {canAmendFees && (
        <div className="grid sm:grid-cols-4 gap-3 items-end">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Type</label>
            <select
              className="w-full h-9 rounded-md border bg-background px-2 text-sm"
              value={feeType}
              onChange={(e) => setFeeType(e.target.value as typeof feeType)}
            >
              {(Object.keys(FEE_TYPE_LABELS) as Array<keyof typeof FEE_TYPE_LABELS>).map((k) => (
                <option key={k} value={k}>
                  {FEE_TYPE_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Amount (£)</label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1 sm:col-span-1">
            <label className="text-xs text-muted-foreground">Note</label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button
            disabled={!amount || addDraft.isPending}
            onClick={() => addDraft.mutate()}
          >
            Add draft
          </Button>
        </div>
      )}

      <div className="space-y-2">
        <h4 className="text-sm font-medium">Drafts</h4>
        {drafts.length === 0 && <p className="text-sm text-muted-foreground">No draft fees.</p>}
        {drafts.map((l) => (
          <div key={l.id} className="flex justify-between text-sm border rounded-lg px-3 py-2">
            <span>
              {FEE_TYPE_LABELS[l.fee_type as keyof typeof FEE_TYPE_LABELS] ?? l.fee_type}
              {l.note ? ` · ${l.note}` : ""}
            </span>
            <span className="font-medium">£{(l.amount_pence / 100).toFixed(2)}</span>
          </div>
        ))}
        {canAmendFees && drafts.length > 0 && (
          <Button disabled={submit.isPending} onClick={() => submit.mutate()}>
            {submit.isPending ? "Submitting…" : "Submit & lock fees"}
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium">Posted</h4>
        {posted.length === 0 && <p className="text-sm text-muted-foreground">No posted fees yet.</p>}
        {posted.map((l) => (
          <div
            key={l.id}
            className={`flex flex-wrap items-center justify-between gap-2 text-sm border rounded-lg px-3 py-2 ${
              l.status === "amended" ? "border-destructive/40 text-destructive" : ""
            }`}
          >
            <span>
              {FEE_TYPE_LABELS[l.fee_type as keyof typeof FEE_TYPE_LABELS] ?? l.fee_type}
              {l.status === "amended" ? " (amended)" : ""}
              {l.note ? ` · ${l.note}` : ""}
            </span>
            <div className="flex items-center gap-2">
              <span className="font-medium">£{(l.amount_pence / 100).toFixed(2)}</span>
              {canAmendFees && l.status === "posted" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive"
                  disabled={amend.isPending}
                  onClick={() => {
                    const next = prompt("New amount (£) — leave blank to delete", String(l.amount_pence / 100));
                    if (next === null) return;
                    if (next.trim() === "") {
                      amend.mutate({ lineId: l.id, delete: true });
                    } else {
                      amend.mutate({ lineId: l.id, amountPounds: Number(next) });
                    }
                  }}
                >
                  Amend
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
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

function CaseRefEditor({
  sessionId,
  caseRef,
  canEdit,
}: {
  sessionId: string;
  caseRef: string | null;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const updateFn = useServerFn(updateCaseRef);
  const [value, setValue] = useState(caseRef ?? "");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setValue(caseRef ?? "");
  }, [caseRef]);

  const save = useMutation({
    mutationFn: () => updateFn({ data: { sessionId, caseRef: value.trim() } }),
    onSuccess: () => {
      toast.success("Case reference updated");
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["session", sessionId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not update reference"),
  });

  if (!canEdit && !caseRef) return null;

  return (
    <div className="rounded-2xl border bg-card p-5 space-y-3">
      <h3 className="font-semibold text-sm">Case reference</h3>
      {canEdit && editing ? (
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[180px]">
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value.toUpperCase())}
              placeholder="MG-2026-0001"
              className="font-mono"
            />
          </div>
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || value.trim().length < 3}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-lg">{caseRef ?? "Not set"}</span>
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit reference
            </Button>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Align this with your provider or finance system. Introducers stay linked to the customer, not the case.
      </p>
    </div>
  );
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

