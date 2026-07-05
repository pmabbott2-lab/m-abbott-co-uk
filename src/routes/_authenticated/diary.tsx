import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { AppointmentAmendDialog } from "@/components/AppointmentAmendDialog";
import { getAdvisorView } from "@/lib/advisor-view";
import { listAdvisorAppointments } from "@/lib/booking.functions";
import { getMyRole } from "@/lib/sessions.functions";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/diary")({
  component: AdvisorDiary,
});

function AdvisorDiary() {
  const roleFn = useServerFn(getMyRole);
  const apptsFn = useServerFn(listAdvisorAppointments);
  const advisorViewId = getAdvisorView()?.advisorId;
  const [amendId, setAmendId] = useState<string | null>(null);

  const roleQ = useQuery({ queryKey: ["my-role"], queryFn: () => roleFn() });
  const apptsQ = useQuery({
    queryKey: ["advisor-appointments", advisorViewId],
    queryFn: () => apptsFn({ data: { viewAsAdvisorId: advisorViewId } }),
    enabled: roleQ.data?.isAdvisor === true || roleQ.data?.isMainAdmin === true,
  });

  if (roleQ.isLoading) {
    return (
      <AppShell title="Diary" backTo="/home" backLabel="Dashboard">
        <div className="py-16 text-center text-muted-foreground">Loading…</div>
      </AppShell>
    );
  }

  if (!roleQ.data?.isAdvisor && !roleQ.data?.isMainAdmin) {
    throw redirect({ to: "/home" });
  }

  const appointments = apptsQ.data ?? [];
  const amendAppt = appointments.find((a) => a.id === amendId);

  return (
    <AppShell title="Diary" backTo="/home" backLabel="Dashboard">
      <h2 className="text-2xl font-semibold mb-2">Upcoming appointments</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Customer bookings from your portal. Use amend to reschedule a confirmed appointment.
      </p>
      <div className="rounded-2xl border bg-card divide-y">
        {appointments.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground">No upcoming appointments.</div>
        )}
        {appointments.map((appt) => (
          <div key={appt.id} className="p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
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
              {appt.notes && <p className="text-sm mt-2">{appt.notes}</p>}
            </div>
            <Button size="sm" variant="outline" onClick={() => setAmendId(appt.id)}>
              Amend
            </Button>
          </div>
        ))}
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
