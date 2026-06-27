import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createAppointment, getAvailableSlots, getLeadForBooking } from "@/lib/booking.functions";
import { resolveReferralSlug } from "@/lib/introducer.functions";
import { setReferralCookie } from "@/lib/referral";
import { CalendarCheck, CheckCircle2 } from "lucide-react";

type BookSearch = {
  lead?: string;
};

export const Route = createFileRoute("/book/$slug")({
  validateSearch: (search: Record<string, unknown>): BookSearch => ({
    lead: typeof search.lead === "string" ? search.lead : undefined,
  }),
  component: DirectBookingPage,
});

function DirectBookingPage() {
  const { slug } = Route.useParams();
  const { lead: leadId } = Route.useSearch();
  const resolveFn = useServerFn(resolveReferralSlug);
  const slotsFn = useServerFn(getAvailableSlots);
  const leadFn = useServerFn(getLeadForBooking);
  const bookFn = useServerFn(createAppointment);

  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [booked, setBooked] = useState(false);

  const introducerQ = useQuery({
    queryKey: ["introducer-slug", slug],
    queryFn: () => resolveFn({ data: { slug } }),
  });

  useEffect(() => {
    if (introducerQ.data?.slug) setReferralCookie(introducerQ.data.slug);
  }, [introducerQ.data?.slug]);

  const leadQ = useQuery({
    queryKey: ["lead-for-booking", leadId, slug],
    queryFn: () => (leadId ? leadFn({ data: { leadId, slug } }) : null),
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
    queryKey: ["available-slots", dateKey],
    queryFn: () => slotsFn({ data: { date: dateKey! } }),
    enabled: Boolean(dateKey),
  });

  const book = useMutation({
    mutationFn: () =>
      bookFn({
        data: {
          slug,
          leadId,
          customerName,
          customerPhone,
          customerEmail,
          startsAt: selectedSlot!,
        },
      }),
    onSuccess: () => setBooked(true),
  });

  if (introducerQ.isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  }

  if (!introducerQ.data) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center space-y-3">
          <h1 className="text-xl font-semibold">Booking link not found</h1>
          <p className="text-sm text-muted-foreground">This link may be invalid or inactive.</p>
          <Link to="/"><Button variant="outline">Go home</Button></Link>
        </div>
      </div>
    );
  }

  const introducer = introducerQ.data;

  if (booked) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="max-w-md text-center space-y-4">
          <CheckCircle2 className="w-12 h-12 mx-auto text-accent" />
          <h1 className="text-2xl font-semibold">Appointment booked</h1>
          <p className="text-muted-foreground text-sm">
            You&apos;ll receive a text confirmation if SMS is enabled. Your advisor will call you at the
            scheduled time.
          </p>
          <Link to="/"><Button>Done</Button></Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-4 max-w-3xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold">
          <CalendarCheck className="w-5 h-5" />
          Book an appointment
        </div>
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">Home</Link>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        <div>
          <p className="text-sm text-muted-foreground">Referred by</p>
          <h1 className="text-2xl font-semibold">{introducer.company_name}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pick a date and time — no fact-find required. You can complete that later if you prefer.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          <div className="rounded-2xl border bg-card p-4">
            <h2 className="font-medium mb-3">Choose a date</h2>
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(d) => {
                setSelectedDate(d);
                setSelectedSlot(null);
              }}
              disabled={{ before: new Date() }}
            />
          </div>

          <div className="space-y-6">
            <div>
              <h2 className="font-medium mb-3">Available times</h2>
              {!selectedDate && (
                <p className="text-sm text-muted-foreground">Select a date to see available slots.</p>
              )}
              {selectedDate && slotsQ.isLoading && (
                <p className="text-sm text-muted-foreground">Loading slots…</p>
              )}
              {selectedDate && slotsQ.data?.slots.length === 0 && (
                <p className="text-sm text-muted-foreground">No slots available on this day.</p>
              )}
              <div className="grid grid-cols-2 gap-2">
                {(slotsQ.data?.slots ?? []).map((slot) => (
                  <Button
                    key={slot}
                    type="button"
                    variant={selectedSlot === slot ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedSlot(slot)}
                  >
                    {format(new Date(slot), "HH:mm")}
                  </Button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border bg-card p-4 space-y-4">
              <h2 className="font-medium">Your details</h2>
              <div className="space-y-2">
                <Label htmlFor="name">Full name</Label>
                <Input id="name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Mobile number</Label>
                <Input id="phone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email (optional)</Label>
                <Input id="email" type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
              </div>
              <Button
                className="w-full"
                disabled={!selectedSlot || !customerName || !customerPhone || book.isPending}
                onClick={() => book.mutate()}
              >
                {book.isPending ? "Booking…" : "Confirm appointment"}
              </Button>
              {book.isError && (
                <p className="text-sm text-destructive">{(book.error as Error).message}</p>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
