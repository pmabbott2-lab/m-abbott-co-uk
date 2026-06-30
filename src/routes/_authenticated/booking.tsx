import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppShell } from "@/components/AppShell";
import { createAppointmentAuth, getAvailableSlots, requestCallbackAuth } from "@/lib/booking.functions";
import { CALLBACK_WINDOW_OPTIONS, CALLBACK_WINDOW_RANGES } from "@/components/PostCompletionBooking";
import { getReferralSlug } from "@/lib/referral";
import { supabase } from "@/integrations/supabase/client";
import { CalendarCheck, CheckCircle2, PhoneCall } from "lucide-react";

export const Route = createFileRoute("/_authenticated/booking")({
  component: DirectBookingPage,
});

function DirectBookingPage() {
  const slotsFn = useServerFn(getAvailableSlots);
  const bookFn = useServerFn(createAppointmentAuth);
  const callbackFn = useServerFn(requestCallbackAuth);

  const [mode, setMode] = useState<"appointment" | "callback">("appointment");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [callbackWindow, setCallbackWindow] = useState<"9-12" | "12-4" | "4-8" | null>(null);
  const [booked, setBooked] = useState(false);
  const [bookedAt, setBookedAt] = useState<Date | null>(null);
  const [callbackDone, setCallbackDone] = useState(false);

  useQuery({
    queryKey: ["profile-for-booking"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, email, phone")
        .eq("id", user.id)
        .maybeSingle();
      if (profile?.full_name) setCustomerName(profile.full_name);
      if (profile?.email) setCustomerEmail(profile.email);
      const phone = profile?.phone ?? (user.user_metadata?.phone as string | undefined);
      if (phone) setCustomerPhone(phone);
      return profile;
    },
  });

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
          channel: "direct_booking",
          customerName,
          customerPhone,
          customerEmail,
          startsAt: selectedSlot!,
          slug: getReferralSlug() ?? undefined,
        },
      }),
    onSuccess: () => {
      setBookedAt(selectedSlot ? new Date(selectedSlot) : null);
      setBooked(true);
    },
  });

  const callback = useMutation({
    mutationFn: () =>
      callbackFn({
        data: {
          customerName,
          customerPhone,
          customerEmail,
          window: callbackWindow!,
        },
      }),
    onSuccess: () => setCallbackDone(true),
  });

  if (callbackDone) {
    return (
      <AppShell title="Direct booking">
        <div className="max-w-md mx-auto text-center space-y-4 py-12">
          <CheckCircle2 className="w-12 h-12 mx-auto text-accent" />
          <h1 className="text-2xl font-semibold">Call back requested</h1>
          <p className="text-muted-foreground text-sm">
            We&apos;ll call you between{" "}
            <strong>{callbackWindow ? CALLBACK_WINDOW_RANGES[callbackWindow] : "your chosen window"}</strong>.
            You&apos;ll receive a text confirmation if SMS is enabled.
          </p>
          <div className="flex justify-center pt-2">
            <Link to="/home"><Button>Back to home</Button></Link>
          </div>
        </div>
      </AppShell>
    );
  }

  if (booked && bookedAt) {
    return (
      <AppShell title="Direct booking">
        <div className="max-w-md mx-auto text-center space-y-4 py-12">
          <CheckCircle2 className="w-12 h-12 mx-auto text-accent" />
          <h1 className="text-2xl font-semibold">Appointment booked</h1>
          <p className="text-muted-foreground text-sm">
            Your appointment is confirmed for{" "}
            <strong>{format(bookedAt, "EEE d MMM yyyy, HH:mm")}</strong>.
            You&apos;ll receive a text confirmation if SMS is enabled.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <Link to="/home"><Button>Back to home</Button></Link>
            <Link to="/home"><Button variant="outline">Start a fact-find</Button></Link>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Direct booking">
      <div className="max-w-3xl mx-auto space-y-8">
        <div>
          <div className="flex items-center gap-2 font-semibold text-lg">
            <CalendarCheck className="w-5 h-5" />
            Speak with your advisor
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Pick a time to speak with your advisor, or ask them to call you back. You can complete the
            fact-find before or after your call.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 max-w-md">
          <button
            type="button"
            onClick={() => setMode("appointment")}
            className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-medium transition ${mode === "appointment" ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}
          >
            <CalendarCheck className="w-4 h-4" /> Book an appointment
          </button>
          <button
            type="button"
            onClick={() => setMode("callback")}
            className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-medium transition ${mode === "callback" ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}
          >
            <PhoneCall className="w-4 h-4" /> Request a call back
          </button>
        </div>

        {mode === "callback" ? (
          <div className="max-w-md space-y-6">
            <div className="rounded-2xl border bg-card p-4 space-y-3">
              <h2 className="font-medium">When should we call?</h2>
              <p className="text-xs text-muted-foreground">Pick the time window that suits you best.</p>
              <div className="grid gap-2">
                {CALLBACK_WINDOW_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer text-sm ${callbackWindow === opt.value ? "border-primary bg-primary/5" : ""}`}
                  >
                    <input
                      type="radio"
                      name="callback-window"
                      checked={callbackWindow === opt.value}
                      onChange={() => setCallbackWindow(opt.value)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border bg-card p-4 space-y-4">
              <h2 className="font-medium">Your details</h2>
              <div className="space-y-2">
                <Label htmlFor="cb-name">Full name</Label>
                <Input id="cb-name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cb-phone">Mobile number</Label>
                <Input id="cb-phone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cb-email">Email (optional)</Label>
                <Input id="cb-email" type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
              </div>
              <Button
                className="w-full"
                disabled={!callbackWindow || !customerName || !customerPhone || callback.isPending}
                onClick={() => callback.mutate()}
              >
                {callback.isPending ? "Requesting…" : "Request call back"}
              </Button>
              {callback.isError && (
                <p className="text-sm text-destructive">{(callback.error as Error).message}</p>
              )}
            </div>
          </div>
        ) : (
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
        )}
      </div>
    </AppShell>
  );
}
