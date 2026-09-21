import { TenantAppLink as Link } from "@/components/tenant/TenantAppLink";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { FileText, MessageSquare, Mic } from "lucide-react";
import { listMyCases, listMySessions } from "@/lib/sessions.functions";

type CustomerPortalPreviewProps = {
  viewAsCustomerUserId: string;
  customerName: string;
};

export function CustomerPortalPreview({
  viewAsCustomerUserId,
  customerName,
}: CustomerPortalPreviewProps) {
  const sessionsFn = useServerFn(listMySessions);
  const casesFn = useServerFn(listMyCases);
  const viewAsPayload = { viewAsCustomerUserId };

  const sessionsQ = useQuery({
    queryKey: ["customer-view-sessions", viewAsCustomerUserId],
    queryFn: () => sessionsFn({ data: viewAsPayload }),
  });
  const casesQ = useQuery({
    queryKey: ["customer-view-cases", viewAsCustomerUserId],
    queryFn: () => casesFn({ data: viewAsPayload }),
  });

  const sessions = sessionsQ.data ?? [];
  const cases = casesQ.data ?? [];
  const inProgress = sessions.find((s) => s.status === "in_progress");

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-card border p-6 sm:p-8">
        <h3 className="text-xl font-semibold">
          {inProgress ? "Continue fact-find" : "Customer journey"}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Preview of <strong>{customerName}</strong>&apos;s home — Talk, Type, Book, and case
          summary as they see it. Open links to review their sessions in detail.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-5">
          {inProgress && (
            <>
              <Link
                to="/interview/$sessionId"
                params={{ sessionId: inProgress.id }}
                className="rounded-2xl border p-5 hover:border-primary hover:bg-muted/40 transition block"
              >
                <div className="flex items-center gap-3">
                  <Mic className="w-5 h-5 text-primary" />
                  <div>
                    <div className="font-semibold text-sm">Talk (in progress)</div>
                    <div className="text-xs text-muted-foreground">Voice fact-find session</div>
                  </div>
                </div>
              </Link>
              <Link
                to="/chat/$sessionId"
                params={{ sessionId: inProgress.id }}
                className="rounded-2xl border p-5 hover:border-primary hover:bg-muted/40 transition block"
              >
                <div className="flex items-center gap-3">
                  <MessageSquare className="w-5 h-5 text-primary" />
                  <div>
                    <div className="font-semibold text-sm">Type (in progress)</div>
                    <div className="text-xs text-muted-foreground">Chat fact-find session</div>
                  </div>
                </div>
              </Link>
            </>
          )}
          {cases.length > 0 && (
            <Link
              to="/cases"
              className="rounded-2xl border p-5 hover:border-primary hover:bg-muted/40 transition block"
            >
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-primary" />
                <div>
                  <div className="font-semibold text-sm">Your summary</div>
                  <div className="text-xs text-muted-foreground">
                    {cases.length} case{cases.length === 1 ? "" : "s"} on journey
                  </div>
                </div>
              </div>
            </Link>
          )}
        </div>
      </div>

      <section className="rounded-2xl border bg-card divide-y">
        <div className="p-4 font-medium text-sm">Fact-finds & sessions</div>
        {sessionsQ.isLoading && (
          <div className="p-6 text-sm text-muted-foreground">Loading sessions…</div>
        )}
        {!sessionsQ.isLoading && sessions.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground">No sessions yet.</div>
        )}
        {sessions.map((s) => (
          <Link
            key={s.id}
            to="/sessions/$sessionId"
            params={{ sessionId: s.id }}
            className="flex items-center justify-between gap-3 p-4 hover:bg-muted/30 transition"
          >
            <div className="min-w-0">
              <p className="font-medium text-sm truncate">
                {(s as { case_ref?: string | null }).case_ref || "Fact-find"}
              </p>
              <p className="text-xs text-muted-foreground">
                {s.status === "submitted" ? "Submitted" : "In progress"} ·{" "}
                {format(new Date(s.started_at), "d MMM yyyy")}
              </p>
            </div>
          </Link>
        ))}
      </section>

      {cases.length > 0 && (
        <section className="rounded-2xl border bg-card divide-y">
          <div className="p-4 font-medium text-sm">Cases</div>
          {cases.map((c) => (
            <div key={c.id} className="p-4 text-sm space-y-1">
              <p className="font-medium">{c.case_ref}</p>
              <p className="text-xs text-muted-foreground">
                Journey {c.journey.completed}/{c.journey.total}
                {c.appointment
                  ? ` · Appt ${format(new Date(c.appointment.startsAt), "d MMM yyyy")}`
                  : ""}
              </p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
