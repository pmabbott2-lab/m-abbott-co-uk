import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CalendarCheck, PhoneCall, CheckCircle2 } from "lucide-react";
import {
  bookSessionAppointment,
  getAvailableSlots,
  requestSessionCallback,
} from "@/lib/booking.functions";
import { getReferralSlug } from "@/lib/referral";

type Props = {
  sessionId: string;
  channel: "voice" | "text";
  defaultName?: string;
  defaultEmail?: string;
  onComplete: () => void;
  initialMode?: "appointment" | "callback";
  hideModeToggle?: boolean;
  compact?: boolean;
};

export const CALLBACK_WINDOW_OPTIONS: Array<{ value: "9-12" | "12-4" | "4-8"; label: string }> = [
  { value: "9-12", label: "Morning · 9am – 12pm" },
  { value: "12-4", label: "Afternoon · 12pm – 4pm" },
  { value: "4-8", label: "Evening · 4pm – 8pm" },
];

// "between …" phrasing for call-back confirmation screens.
export const CALLBACK_WINDOW_RANGES: Record<"9-12" | "12-4" | "4-8", string> = {
  "9-12": "9am and 12pm",
  "12-4": "12pm and 4pm",
  "4-8": "4pm and 8pm",
};

export function PostCompletionBooking({
  sessionId,
  channel,
  defaultName = "",
  defaultEmail = "",
  onComplete,
  initialMode = "appointment",
  hideModeToggle = false,
  compact = false,
}: Props) {
  const slotsFn = useServerFn(getAvailableSlots);
  const bookFn = useServerFn(bookSessionAppointment);
  const callbackFn = useServerFn(requestSessionCallback);

  const [mode, setMode] = useState<"appointment" | "callback">(initialMode);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState(defaultName);
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState(defaultEmail);
  const [callbackWindow, setCallbackWindow] = useState<"9-12" | "12-4" | "4-8" | null>(null);
  const [callbackDone, setCallbackDone] = useState(false);

  useEffect(() => {
    if (defaultName) setCustomerName(defaultName);
    if (defaultEmail) setCustomerEmail(defaultEmail);
  }, [defaultName, defaultEmail]);

  const dateKey = selectedDate ? format(selectedDate, "yyyy-MM-dd") : null;
  const slotsQ = useQuery({
    queryKey: ["available-slots", dateKey],
    queryFn: () => slotsFn({ data: { date: dateKey! } }),
    enabled: Boolean(dateKey) && mode === "appointment",
  });

  const book = useMutation({
    mutationFn: () =>
      bookFn({
        data: {
          sessionId,
          channel,
          customerName,
          customerPhone,
          customerEmail,
          startsAt: selectedSlot!,
          slug: getReferralSlug() ?? undefined,
        },
      }),
    onSuccess: () => onComplete(),
  });

  const callback = useMutation({
    mutationFn: () =>
      callbackFn({
        data: {
          sessionId,
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
      <div className="max-w-md mx-auto text-center space-y-4 py-6">
        <CheckCircle2 className="w-12 h-12 mx-auto text-accent" />
        <h2 className="text-2xl font-semibold">Call back requested</h2>
        <p className="text-muted-foreground text-sm">
          Thanks {customerName.split(" ")[0] || "for that"} — we&apos;ll call you between{" "}
          <strong>{callbackWindow ? CALLBACK_WINDOW_RANGES[callbackWindow] : "your chosen window"}</strong>.
          You&apos;ll receive a text confirmation if SMS is enabled.
        </p>
        <Button size="lg" onClick={onComplete}>
          View your summary &amp; next steps
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6 text-left">
      {!compact && (
        <div className="text-center space-y-2">
          <CalendarCheck className="w-10 h-10 mx-auto text-accent" />
          <h2 className="text-2xl font-semibold">What would you like to do next?</h2>
          <p className="text-muted-foreground">
            You can book an appointment with your advisor now, or ask them to call you back at a time
            that suits you.
          </p>
        </div>
      )}

      {!hideModeToggle && (
        <div className="grid grid-cols-2 gap-2 max-w-md mx-auto">
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
      )}

      {mode === "appointment" ? (
        <div className="grid md:grid-cols-2 gap-6">
          <div className="rounded-2xl border bg-background p-4">
            <h3 className="font-medium mb-3">Choose a date</h3>
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

          <div className="space-y-4">
            <div>
              <h3 className="font-medium mb-3">Available times</h3>
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

            <DetailsFields
              customerName={customerName}
              setCustomerName={setCustomerName}
              customerPhone={customerPhone}
              setCustomerPhone={setCustomerPhone}
              customerEmail={customerEmail}
              setCustomerEmail={setCustomerEmail}
            />
          </div>
        </div>
      ) : (
        <div className="max-w-md mx-auto space-y-4">
          <div className="rounded-2xl border bg-background p-4 space-y-3">
            <h3 className="font-medium">When should we call?</h3>
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
          <DetailsFields
            customerName={customerName}
            setCustomerName={setCustomerName}
            customerPhone={customerPhone}
            setCustomerPhone={setCustomerPhone}
            customerEmail={customerEmail}
            setCustomerEmail={setCustomerEmail}
          />
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        {mode === "appointment" ? (
          <Button
            size="lg"
            disabled={!selectedSlot || !customerName || !customerPhone || book.isPending}
            onClick={() => book.mutate()}
          >
            {book.isPending ? "Booking…" : "Book appointment"}
          </Button>
        ) : (
          <Button
            size="lg"
            disabled={!callbackWindow || !customerName || !customerPhone || callback.isPending}
            onClick={() => callback.mutate()}
          >
            {callback.isPending ? "Requesting…" : "Request call back"}
          </Button>
        )}
        <Button size="lg" variant="outline" onClick={onComplete}>
          Skip for now — review summary
        </Button>
      </div>
      {book.isError && (
        <p className="text-sm text-destructive text-center">{(book.error as Error).message}</p>
      )}
      {callback.isError && (
        <p className="text-sm text-destructive text-center">{(callback.error as Error).message}</p>
      )}
    </div>
  );
}

function DetailsFields({
  customerName,
  setCustomerName,
  customerPhone,
  setCustomerPhone,
  customerEmail,
  setCustomerEmail,
}: {
  customerName: string;
  setCustomerName: (v: string) => void;
  customerPhone: string;
  setCustomerPhone: (v: string) => void;
  customerEmail: string;
  setCustomerEmail: (v: string) => void;
}) {
  return (
    <div className="rounded-2xl border bg-background p-4 space-y-3">
      <h3 className="font-medium">Your details</h3>
      <div className="space-y-2">
        <Label htmlFor="booking-name">Full name</Label>
        <Input id="booking-name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="booking-phone">Mobile number</Label>
        <Input id="booking-phone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="booking-email">Email (optional)</Label>
        <Input
          id="booking-email"
          type="email"
          value={customerEmail}
          onChange={(e) => setCustomerEmail(e.target.value)}
        />
      </div>
    </div>
  );
}
