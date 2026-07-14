import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { AppointmentAmendDialog } from "@/components/AppointmentAmendDialog";
import { TeamsCalendarLinkCard } from "@/components/TeamsCalendarLinkCard";
import { getAdvisorView } from "@/lib/advisor-view";
import { listAdvisorAppointments } from "@/lib/booking.functions";
import { getMyRole } from "@/lib/sessions.functions";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/diary")({
  validateSearch: (search: Record<string, unknown>) => ({
    teams: typeof search.teams === "string" ? search.teams : undefined,
    reason: typeof search.reason === "string" ? search.reason : undefined,
  }),
  component: AdvisorDiary,
});

function AdvisorDiary() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const roleFn = useServerFn(getMyRole);
  const apptsFn = useServerFn(listAdvisorAppointments);
  const advisorViewId = getAdvisorView()?.advisorId;
  const [amendId, setAmendId] = useState<string | null>(null);

  const roleQ = useQuery({ queryKey: ["my-role"], queryFn: () => roleFn() });
  const canAccess =
    roleQ.data?.isAdvisor === true || roleQ.data?.isMainAdmin === true;

  const apptsQ = useQuery({
    queryKey: ["advisor-appointments", advisorViewId],
    queryFn: () => apptsFn({ data: { viewAsAdvisorId: advisorViewId } }),
    enabled: canAccess,
  });

  useEffect(() => {
    if (!roleQ.isSuccess) return;
    if (!roleQ.data?.isAdvisor && !roleQ.data?.isMainAdmin) {
      navigate({ to: "/home" });
    }
  }, [roleQ.isSuccess, roleQ.data, navigate]);

  if (roleQ.isLoading) {
    return (
      <AppShell title="Diary" backTo="/home" backLabel="Dashboard">
        <div className="py-16 text-center text-muted-foreground">Loading…</div>
      </AppShell>
    );
  }

  if (roleQ.isError) {
    return (
      <AppShell title="Diary" backTo="/home" backLabel="Dashboard">
        <div className="max-w-md mx-auto py-16 text-center space-y-3">
          <p className="text-sm text-destructive">
            Could not verify your access. Try refreshing the page.
          </p>
          <p className="text-xs text-muted-foreground">
            {roleQ.error instanceof Error ? roleQ.error.message : "Unknown error"}
          </p>
          <Button onClick={() => roleQ.refetch()}>Try again</Button>
        </div>
      </AppShell>
    );
  }

  if (!canAccess) {
    return (
      <AppShell title="Diary" backTo="/home" backLabel="Dashboard">
        <div className="py-16 text-center text-muted-foreground">Redirecting…</div>
      </AppShell>
    );
  }

  const appointments = apptsQ.data ?? [];
  const amendAppt = appointments.find((a) => a.id === amendId);

  return (
    <AppShell title="Diary" backTo="/home" backLabel="Dashboard">
      <h2 className="text-2xl font-semibold mb-2">Upcoming appointments</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Customer bookings from your portal. Use amend to reschedule a confirmed appointment.
        When your Teams diary is linked, new and amended appointments sync as Teams meetings.
      </p>

      <TeamsCalendarLinkCard search={search} />

      {apptsQ.isError && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 mb-4 text-sm text-destructive">
          Could not load appointments:{" "}
          {apptsQ.error instanceof Error ? apptsQ.error.message : "Unknown error"}
          <Button size="sm" variant="outline" className="ml-3" onClick={() => apptsQ.refetch()}>
            Retry
          </Button>
        </div>
      )}

      <div className="rounded-2xl border bg-card divide-y">
        {apptsQ.isLoading && (
          <div className="p-6 text-sm text-muted-foreground">Loading appointments…</div>
        )}
        {!apptsQ.isLoading && appointments.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground">No upcoming appointments.</div>
        )}
        {appointments.map((appt) => {
          const joinUrl =
            "ms_join_url" in appt
              ? ((appt as { ms_join_url?: string | null }).ms_join_url ?? null)
              : null;
          return (
            <div
              key={appt.id}
              className="p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3"
            >
              <div>
                <div className="font-medium">{appt.customer_name}</div>
                <div className="text-sm text-muted-foreground mt-1">
                  {format(new Date(appt.starts_at), "EEEE d MMMM, HH:mm")} · {appt.customer_phone}
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
    </AppShell>
  );
}
