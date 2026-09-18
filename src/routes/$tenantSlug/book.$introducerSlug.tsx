import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createAppointment, getAvailableSlots, getLeadForBooking } from "@/lib/booking.functions";
import { bookingCalendarDisabled } from "@/lib/booking-calendar";
import {
  BookingAdvisorPicker,
  advisorChoiceToPayload,
  type AdvisorChoice,
} from "@/components/BookingAdvisorPicker";
import { resolveReferralSlug } from "@/lib/introducer.functions";
import { setReferralCookie } from "@/lib/referral";
import { CalendarCheck, CheckCircle2 } from "lucide-react";
import { useRequiredTenantUi } from "@/lib/tenant-ui";
import { TenantPublicShell } from "@/components/tenant/TenantPublicShell";

type BookSearch = { lead?: string };

export const Route = createFileRoute("/$tenantSlug/book/$introducerSlug")({
  validateSearch: (search: Record<string, unknown>): BookSearch => ({
    lead: typeof search.lead === "string" ? search.lead : undefined,
  }),
  beforeLoad: ({ context }) => {
    const tenant = context.tenant;
    if (!tenant) throw redirect({ to: "/" });
    if (!tenant.features?.appointment_booking) {
      throw redirect({ to: "/$tenantSlug", params: { tenantSlug: tenant.slug } });
    }
  },
  component: TenantDirectBookingPage,
});

function TenantDirectBookingPage() {
  const tenant = useRequiredTenantUi();
  const { introducerSlug } = Route.useParams();
  const { lead: leadId } = Route.useSearch();
  const resolveFn = useServerFn(resolveReferralSlug);
  const slotsFn = useServerFn(getAvailableSlots);
  const leadFn = useServerFn(getLeadForBooking);
  const bookFn = useServerFn(createAppointment);

  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [advisorChoice, setAdvisorChoice] = useState<AdvisorChoice>("any");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [booked, setBooked] = useState(false);

  const introducerQ = useQuery({
    queryKey: ["introducer-slug", introducerSlug, tenant.slug],
    queryFn: () => resolveFn({ data: { slug: introducerSlug, tenantSlug: tenant.slug } as never }),
  });

  useEffect(() => {
    if (introducerQ.data?.slug) setReferralCookie(introducerQ.data.slug);
  }, [introducerQ.data?.slug]);

  const leadQ = useQuery({
    queryKey: ["lead-for-booking", leadId, introducerSlug],
    queryFn: () => (leadId ? leadFn({ data: { leadId, slug: introducerSlug } }) : null),
    enabled: Boolean(leadId),
  });

  useEffect(() => {
    if (leadQ.data) {
      setCustomerName(leadQ.data.customerName);
      setCustomerPhone(leadQ.data.customerPhone);
      setCustomerEmail(leadQ.data.customerEmail);
    }
  }, [leadQ.data]);

  const dateKey = selectedDate ? format(selectedDate, "yyyy-MM-dd") : null;
  const slotsQ = useQuery({
    queryKey: ["available-slots", dateKey, "pool", tenant.slug],
    queryFn: () => slotsFn({ data: { date: dateKey!, pool: true, tenantSlug: tenant.slug } }),
    enabled: Boolean(dateKey),
  });
  const advisorsForSlot =
    selectedSlot && slotsQ.data?.advisorsBySlot
      ? (slotsQ.data.advisorsBySlot[selectedSlot] ?? [])
      : [];

  const bookMut = useMutation({
    mutationFn: async () => {
      if (!selectedSlot) throw new Error("Choose a time");
      const payload = advisorChoiceToPayload(advisorChoice);
      return bookFn({
        data: {
          slug: introducerSlug,
          tenantSlug: tenant.slug,
          leadId,
          customerName,
          customerPhone,
          customerEmail,
          startsAt: selectedSlot,
          preferAnyAdvisor: payload.preferAnyAdvisor,
          advisorId: payload.advisorId,
          channel: "direct_booking",
          sendSms: true,
        },
      });
    },
    onSuccess: () => setBooked(true),
  });

  if (booked) {
    return (
      <TenantPublicShell tenant={tenant}>
        <div className="mx-auto max-w-lg space-y-4 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-primary" />
          <h1 className="text-2xl font-semibold">Appointment booked</h1>
          <p className="text-muted-foreground">
            You will receive a confirmation shortly from {tenant.tradingName || tenant.companyName}.
          </p>
          <Link to="/$tenantSlug" params={{ tenantSlug: tenant.slug }} className="text-primary underline">
            Back to {tenant.tradingName || tenant.companyName}
          </Link>
        </div>
      </TenantPublicShell>
    );
  }

  return (
    <TenantPublicShell tenant={tenant}>
      <div className="mx-auto max-w-xl space-y-6">
        <div className="flex items-center gap-2">
          <CalendarCheck className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold">Book an appointment</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Booking with {tenant.tradingName || tenant.companyName}
          {introducerQ.data?.company_name ? ` via ${introducerQ.data.company_name}` : ""}.
        </p>
        {introducerQ.isError ? (
          <p className="text-sm text-destructive">This booking link is not valid for this firm.</p>
        ) : (
          <>
            <div className="space-y-2">
              <Label>Your name</Label>
              <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Mobile</Label>
              <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email (optional)</Label>
              <Input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
            </div>
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(d) => {
                setSelectedDate(d);
                setSelectedSlot(null);
              }}
              disabled={bookingCalendarDisabled}
            />
            {dateKey && (
              <div className="flex flex-wrap gap-2">
                {(slotsQ.data?.slots ?? []).map((slot) => (
                  <Button
                    key={slot}
                    type="button"
                    size="sm"
                    variant={selectedSlot === slot ? "default" : "outline"}
                    onClick={() => setSelectedSlot(slot)}
                  >
                    {format(new Date(slot), "HH:mm")}
                  </Button>
                ))}
              </div>
            )}
            {selectedSlot ? (
              <BookingAdvisorPicker
                advisors={advisorsForSlot}
                value={advisorChoice}
                onChange={setAdvisorChoice}
              />
            ) : null}
            <Button
              disabled={!selectedSlot || !customerName || !customerPhone || bookMut.isPending}
              onClick={() => bookMut.mutate()}
            >
              {bookMut.isPending ? "Booking…" : "Confirm booking"}
            </Button>
            {bookMut.isError ? (
              <p className="text-sm text-destructive">
                {(bookMut.error as Error)?.message || "Booking failed"}
              </p>
            ) : null}
          </>
        )}
      </div>
    </TenantPublicShell>
  );
}
