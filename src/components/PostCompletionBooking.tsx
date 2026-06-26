import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CalendarCheck } from "lucide-react";
import { bookSessionAppointment, getAvailableSlots } from "@/lib/booking.functions";

type Props = {
  sessionId: string;
  channel: "voice" | "text";
  defaultName?: string;
  defaultEmail?: string;
  onComplete: () => void;
};

export function PostCompletionBooking({
  sessionId,
  channel,
  defaultName = "",
  defaultEmail = "",
  onComplete,
}: Props) {
  const slotsFn = useServerFn(getAvailableSlots);
  const bookFn = useServerFn(bookSessionAppointment);

  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState(defaultName);
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState(defaultEmail);

  useEffect(() => {
    if (defaultName) setCustomerName(defaultName);
    if (defaultEmail) setCustomerEmail(defaultEmail);
  }, [defaultName, defaultEmail]);

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
          sessionId,
          channel,
          customerName,
          customerPhone,
          customerEmail,
          startsAt: selectedSlot!,
        },
      }),
    onSuccess: () => onComplete(),
  });

  return (
    <div className="w-full space-y-6 text-left">
      <div className="text-center space-y-2">
        <CalendarCheck className="w-10 h-10 mx-auto text-accent" />
        <h2 className="text-2xl font-semibold">Thank you for completing</h2>
        <p className="text-muted-foreground">
          We can now book you an appointment with your advisor. Pick a time below, or skip to review your
          answers first.
        </p>
      </div>

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
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Button
          size="lg"
          disabled={!selectedSlot || !customerName || !customerPhone || book.isPending}
          onClick={() => book.mutate()}
        >
          {book.isPending ? "Booking…" : "Book appointment"}
        </Button>
        <Button size="lg" variant="outline" onClick={onComplete}>
          Skip for now — review summary
        </Button>
      </div>
      {book.isError && (
        <p className="text-sm text-destructive text-center">{(book.error as Error).message}</p>
      )}
    </div>
  );
}
