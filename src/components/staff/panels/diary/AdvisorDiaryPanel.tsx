import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { AppointmentAmendDialog } from "@/components/AppointmentAmendDialog";
import { TeamsCalendarLinkCard } from "@/components/TeamsCalendarLinkCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listAdvisorAppointments } from "@/lib/booking.functions";
import { listAdvisors } from "@/lib/sessions.functions";
import { safeFormat } from "@/lib/safe-format";

type AppointmentRow = {
  id: string;
  starts_at: string;
  status: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string | null;
  lead_source?: string | null;
  referral_channel?: string | null;
  notes?: string | null;
  ms_join_url?: string | null;
};

export type AdvisorDiaryPanelProps = {
  /** Load a specific advisor's diary (view-as or admin filter selection). */
  viewAsAdvisorId?: string;
  /** Admin diary: pick advisor by name or code. */
  allowAdvisorFilter?: boolean;
  /** Own diary only — Teams calendar connect card. */
  showTeamsLink?: boolean;
  title?: string;
  description?: string;
  teamsSearch?: Record<string, unknown>;
};

export function AdvisorDiaryPanel({
  viewAsAdvisorId: fixedAdvisorId,
  allowAdvisorFilter = false,
  showTeamsLink = false,
  title = "Upcoming appointments",
  description = "Customer bookings from your portal. Use amend to reschedule a confirmed appointment. When your Teams diary is linked, new and amended appointments sync as Teams meetings.",
  teamsSearch,
}: AdvisorDiaryPanelProps) {
  const apptsFn = useServerFn(listAdvisorAppointments);
  const advisorsFn = useServerFn(listAdvisors);

  const [filterAdvisorId, setFilterAdvisorId] = useState("");
  const [advisorSearch, setAdvisorSearch] = useState("");
  const [amendId, setAmendId] = useState<string | null>(null);

  const effectiveAdvisorId = fixedAdvisorId ?? (allowAdvisorFilter ? filterAdvisorId || undefined : undefined);

  const advisorsQ = useQuery({
    queryKey: ["advisors-list"],
    queryFn: () => advisorsFn(),
    enabled: allowAdvisorFilter && !fixedAdvisorId,
    retry: 1,
  });

  const filteredAdvisors = useMemo(() => {
    const advisors = advisorsQ.data ?? [];
    const q = advisorSearch.trim().toLowerCase();
    if (!q) return advisors;
    return advisors.filter((a) => {
      const haystack = [a.full_name, a.email, a.code].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [advisorsQ.data, advisorSearch]);

  const apptsQ = useQuery({
    queryKey: ["advisor-appointments", effectiveAdvisorId ?? "own"],
    queryFn: () => apptsFn({ data: { viewAsAdvisorId: effectiveAdvisorId } }),
    enabled: !allowAdvisorFilter || Boolean(fixedAdvisorId) || Boolean(filterAdvisorId),
    retry: 1,
  });

  const appointments = (apptsQ.data ?? []) as AppointmentRow[];
  const amendAppt = appointments.find((a) => a.id === amendId);
  const selectedAdvisor = (advisorsQ.data ?? []).find((a) => a.id === filterAdvisorId);

  const needsAdvisorPick = allowAdvisorFilter && !fixedAdvisorId && !filterAdvisorId;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-lg flex items-center gap-2">
          <CalendarDays className="w-5 h-5" />
          {title}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>

      {allowAdvisorFilter && !fixedAdvisorId && advisorsQ.isError && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Could not load advisors:{" "}
          {advisorsQ.error instanceof Error ? advisorsQ.error.message : "Unknown error"}
          <Button size="sm" variant="outline" className="ml-3" onClick={() => advisorsQ.refetch()}>
            Retry
          </Button>
        </div>
      )}

      {allowAdvisorFilter && !fixedAdvisorId && (
        <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Filter by advisor name or reference code to view their upcoming appointments.
          </p>
          <div className="grid sm:grid-cols-2 gap-3 max-w-2xl">
            <div className="space-y-1">
              <Label className="text-xs">Search name or code</Label>
              <Input
                placeholder="Name, email, or advisor code…"
                value={advisorSearch}
                onChange={(e) => setAdvisorSearch(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Advisor</Label>
              <select
                className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                value={filterAdvisorId}
                onChange={(e) => setFilterAdvisorId(e.target.value)}
                disabled={advisorsQ.isLoading}
              >
                <option value="">
                  {advisorsQ.isLoading ? "Loading advisors…" : "Select an advisor…"}
                </option>
                {filteredAdvisors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.full_name || a.email || a.id}
                    {a.code ? ` · ${a.code}` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {selectedAdvisor && (
            <p className="text-xs text-muted-foreground">
              Showing diary for{" "}
              <span className="font-medium text-foreground">
                {selectedAdvisor.full_name || selectedAdvisor.email}
              </span>
              {selectedAdvisor.code ? (
                <>
                  {" "}
                  · <span className="font-mono">{selectedAdvisor.code}</span>
                </>
              ) : null}
            </p>
          )}
        </div>
      )}

      {showTeamsLink && <TeamsCalendarLinkCard search={teamsSearch} />}

      {needsAdvisorPick && (
        <p className="text-sm text-muted-foreground">Select an advisor to load their diary.</p>
      )}

      {apptsQ.isError && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Could not load appointments:{" "}
          {apptsQ.error instanceof Error ? apptsQ.error.message : "Unknown error"}
          <Button size="sm" variant="outline" className="ml-3" onClick={() => apptsQ.refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!needsAdvisorPick && (
        <div className="rounded-2xl border bg-card divide-y">
          {apptsQ.isLoading && (
            <div className="p-6 text-sm text-muted-foreground">Loading appointments…</div>
          )}
          {!apptsQ.isLoading && appointments.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground">No upcoming appointments.</div>
          )}
          {appointments.map((appt) => {
            const joinUrl = appt.ms_join_url ?? null;
            return (
              <div
                key={appt.id}
                className="p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3"
              >
                <div>
                  <div className="font-medium">{appt.customer_name}</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {safeFormat(appt.starts_at, "EEEE d MMMM, HH:mm")} · {appt.customer_phone}
                    {appt.customer_email ? ` · ${appt.customer_email}` : ""}
                  </div>
                  {appt.lead_source && (
                    <div className="text-xs text-muted-foreground mt-1">
                      Source: {appt.lead_source.replace("_", " ")}
                      {appt.referral_channel ? ` · ${appt.referral_channel.replace("_", " ")}` : ""}
                    </div>
                  )}
                  {joinUrl && (
                    <a
                      href={joinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary underline mt-1 inline-block"
                    >
                      Open Teams meeting
                    </a>
                  )}
                  {appt.notes && <p className="text-sm mt-2">{appt.notes}</p>}
                </div>
                <Button size="sm" variant="outline" onClick={() => setAmendId(appt.id)}>
                  Amend
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {amendAppt && (
        <AppointmentAmendDialog
          appointment={{
            id: amendAppt.id,
            startsAt: amendAppt.starts_at,
            status: amendAppt.status,
            advisorName: "",
            customerName: amendAppt.customer_name,
            customerPhone: amendAppt.customer_phone,
            customerEmail: amendAppt.customer_email,
          }}
          open={Boolean(amendId)}
          onOpenChange={(open) => {
            if (!open) setAmendId(null);
          }}
          onAmended={() => apptsQ.refetch()}
        />
      )}
    </div>
  );
}
