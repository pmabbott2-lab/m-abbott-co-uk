import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/AppShell";
import { listAdvisorAppointments } from "@/lib/booking.functions";
import { getMyRole } from "@/lib/sessions.functions";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/diary")({
  component: AdvisorDiary,
});

function AdvisorDiary() {
  const roleFn = useServerFn(getMyRole);
  const apptsFn = useServerFn(listAdvisorAppointments);

  const roleQ = useQuery({ queryKey: ["my-role"], queryFn: () => roleFn() });
  const apptsQ = useQuery({
    queryKey: ["advisor-appointments"],
    queryFn: () => apptsFn(),
    enabled: roleQ.data?.isAdvisor === true,
  });

  if (roleQ.isLoading) {
    return (
      <AppShell title="Diary">
        <div className="py-16 text-center text-muted-foreground">Loading…</div>
      </AppShell>
    );
  }

  if (!roleQ.data?.isAdvisor) {
    throw redirect({ to: "/home" });
  }

  const appointments = apptsQ.data ?? [];

  return (
    <AppShell title="Diary">
      <h2 className="text-2xl font-semibold mb-2">Upcoming appointments</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Bookings from direct booking and introducer portal. The voice fact-find app is unchanged.
      </p>
      <div className="rounded-2xl border bg-card divide-y">
        {appointments.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground">No upcoming appointments.</div>
        )}
        {appointments.map((appt) => (
          <div key={appt.id} className="p-4">
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
        ))}
      </div>
    </AppShell>
  );
}
