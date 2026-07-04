import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format, formatDistanceToNow } from "date-fns";
import { ArrowRight, CalendarCheck, FileText, MapPin } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { TabPageNav } from "@/components/TabPageNav";
import { listMyCases } from "@/lib/sessions.functions";
import { getSessionBooking } from "@/lib/booking.functions";
import { Button } from "@/components/ui/button";
import { PostCompletionBooking, CALLBACK_WINDOW_RANGES } from "@/components/PostCompletionBooking";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/cases")({
  component: CasesPage,
});

function CasesPage() {
  const casesFn = useServerFn(listMyCases);
  const casesQ = useQuery({ queryKey: ["my-cases"], queryFn: () => casesFn() });

  return (
    <AppShell title="Your cases">
      <div className="max-w-3xl mx-auto space-y-6">
        <TabPageNav backTo="/home" backLabel="Home" />
        <div>
          <h2 className="text-2xl font-semibold">Your summary</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Each case opens when an appointment is booked. Fact-finds without an appointment stay under
            your customer record until then — amending a booking does not create a new case.
          </p>
        </div>

        {casesQ.isLoading && (
          <p className="text-sm text-muted-foreground py-8 text-center">Loading your cases…</p>
        )}

        {!casesQ.isLoading && (casesQ.data ?? []).length === 0 && (
          <div className="rounded-2xl border bg-card p-8 text-center space-y-3">
            <FileText className="w-10 h-10 mx-auto text-muted-foreground" />
            <p className="text-muted-foreground text-sm">
              No cases yet. Start a fact-find or book an appointment from the home page.
            </p>
            <Link to="/home">
              <Button variant="outline">Back to home</Button>
            </Link>
          </div>
        )}

        <div className="space-y-4">
          {(casesQ.data ?? []).map((c) => (
            <CaseCard key={c.id} caseItem={c} />
          ))}
        </div>
      </div>
    </AppShell>
  );
}

type CaseItem = {
  id: string;
  case_ref: string | null;
  status: string;
  started_at: string;
  summary: string | null;
  appointment: { startsAt: string; advisorName: string; status: string } | null;
  journey: { completed: number; total: number };
};

function CaseCard({ caseItem }: { caseItem: CaseItem }) {
  const bookingFn = useServerFn(getSessionBooking);
  const bookingQ = useQuery({
    queryKey: ["session-booking", caseItem.id],
    queryFn: () => bookingFn({ data: { sessionId: caseItem.id } }),
  });
  const [editingBooking, setEditingBooking] = useState(false);

  const appt = bookingQ.data?.appointment ?? caseItem.appointment;
  const callback = bookingQ.data?.callback ?? null;
  const journeyPct =
    caseItem.journey.total > 0
      ? Math.round((caseItem.journey.completed / caseItem.journey.total) * 100)
      : 0;

  return (
    <div className="rounded-2xl border bg-card overflow-hidden">
      <Link
        to="/sessions/$sessionId"
        params={{ sessionId: caseItem.id }}
        className="block p-5 hover:bg-muted/30 transition"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-semibold text-lg">
              {caseItem.case_ref ?? "Case pending ref"}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {caseItem.status === "submitted" ? "Submitted" : "In progress"} · Started{" "}
              {formatDistanceToNow(new Date(caseItem.started_at), { addSuffix: true })}
            </div>
          </div>
          <span className="text-xs text-primary flex items-center gap-1 shrink-0">
            Open case <ArrowRight className="w-4 h-4" />
          </span>
        </div>
        {caseItem.summary && (
          <p className="text-sm text-muted-foreground mt-3 line-clamp-2">{caseItem.summary}</p>
        )}
      </Link>

      <div className="border-t px-5 py-4 space-y-4 bg-muted/20">
        <div>
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5" />
            Journey progress
          </h4>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${journeyPct}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground shrink-0">
              {caseItem.journey.completed}/{caseItem.journey.total}
            </span>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <CalendarCheck className="w-3.5 h-3.5" />
              Next steps
            </h4>
            {!editingBooking && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditingBooking(true)}>
                {appt || callback ? "Amend" : "Book"}
              </Button>
            )}
          </div>

          {editingBooking ? (
            <div className="rounded-xl border bg-background p-4">
              <PostCompletionBooking
                sessionId={caseItem.id}
                channel="text"
                onComplete={() => setEditingBooking(false)}
              />
            </div>
          ) : (
            <>
              {appt && (
                <div className="rounded-xl border bg-background p-3 text-sm">
                  <div className="font-medium">Appointment booked</div>
                  <div className="text-muted-foreground text-xs mt-1">
                    {format(new Date(appt.startsAt), "EEE d MMM yyyy, HH:mm")} · {appt.advisorName}
                  </div>
                </div>
              )}
              {callback && callback.status !== "closed" && (
                <div className="rounded-xl border bg-background p-3 text-sm mt-2">
                  <div className="font-medium">Call-back requested</div>
                  <div className="text-muted-foreground text-xs mt-1">
                    Window:{" "}
                    {CALLBACK_WINDOW_RANGES[callback.preferredWindow as "9-12" | "12-4" | "4-8"] ??
                      callback.preferredWindow}
                  </div>
                </div>
              )}
              {!appt && !callback && (
                <p className="text-sm text-muted-foreground">No appointment or call-back yet.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
