import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  bookCustomerAppointmentAsStaff,
  getAvailableSlots,
  getStaffBookingAdvisorId,
} from "@/lib/booking.functions";
import type { CustomerHubFactFind } from "@/lib/sessions.functions";
import { CalendarCheck, CheckCircle2 } from "lucide-react";

type Props = {
  customerId: string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  factFinds: CustomerHubFactFind[];
  /** Pre-select a fact-find to attach the appointment to. */
  sessionId?: string;
  triggerLabel?: string;
  triggerVariant?: "default" | "outline" | "secondary";
  onBooked?: () => void;
};

export function CustomerHubBookingDialog({
  customerId,
  customerName,
  customerEmail,
  customerPhone,
  factFinds,
  sessionId: initialSessionId,
  triggerLabel = "Book appointment",
  triggerVariant = "default",
  onBooked,
}: Props) {
  const slotsFn = useServerFn(getAvailableSlots);
  const advisorFn = useServerFn(getStaffBookingAdvisorId);
  const bookFn = useServerFn(bookCustomerAppointmentAsStaff);

  const [open, setOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [name, setName] = useState(customerName);
  const [phone, setPhone] = useState(customerPhone ?? "");
  const [email, setEmail] = useState(customerEmail ?? "");
  const [sessionId, setSessionId] = useState(initialSessionId ?? "");
  const [bookedAt, setBookedAt] = useState<Date | null>(null);

  const advisorQ = useQuery({
    queryKey: ["staff-booking-advisor"],
    queryFn: () => advisorFn(),
    enabled: open,
  });
  const advisorId = advisorQ.data?.advisorId;

  useEffect(() => {
    if (!open) return;
    setName(customerName);
    setPhone(customerPhone ?? "");
    setEmail(customerEmail ?? "");
    setSessionId(initialSessionId ?? "");
    setSelectedDate(undefined);
    setSelectedSlot(null);
    setBookedAt(null);
  }, [open, customerName, customerPhone, customerEmail, initialSessionId]);

  const dateKey = selectedDate ? format(selectedDate, "yyyy-MM-dd") : null;
  const slotsQ = useQuery({
    queryKey: ["available-slots", dateKey, advisorId],
    queryFn: () => slotsFn({ data: { date: dateKey!, advisorId } }),
    enabled: open && Boolean(dateKey) && Boolean(advisorId),
  });

  const bookableFactFinds = factFinds.filter((ff) => !ff.hasAppointment);

  const book = useMutation({
    mutationFn: () =>
      bookFn({
        data: {
          customerId,
          sessionId: sessionId || undefined,
          customerName: name,
          customerPhone: phone,
          customerEmail: email,
          startsAt: selectedSlot!,
        },
      }),
    onSuccess: () => {
      setBookedAt(selectedSlot ? new Date(selectedSlot) : null);
      onBooked?.();
    },
  });

  const handleClose = (next: boolean) => {
    setOpen(next);
    if (!next && bookedAt) {
      setBookedAt(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size="sm">
          <CalendarCheck className="w-4 h-4 mr-1.5" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        {bookedAt ? (
          <div className="text-center space-y-4 py-4">
            <CheckCircle2 className="w-12 h-12 mx-auto text-accent" />
            <DialogHeader className="text-center">
              <DialogTitle>Appointment booked</DialogTitle>
              <DialogDescription>
                Case opened for {name}. Appointment confirmed for{" "}
                <strong>{format(bookedAt, "EEE d MMM yyyy, HH:mm")}</strong>.
                The customer will receive a text if SMS is enabled.
              </DialogDescription>
            </DialogHeader>
            <Button onClick={() => handleClose(false)}>Done</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Book appointment for {customerName}</DialogTitle>
              <DialogDescription>
                Opens a case for this customer — links to an existing fact-find when selected, or
                creates a new case if none apply.
              </DialogDescription>
            </DialogHeader>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="rounded-xl border p-3">
                <h4 className="text-sm font-medium mb-2">Date</h4>
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
                  <h4 className="text-sm font-medium mb-2">Time</h4>
                  {!selectedDate && (
                    <p className="text-sm text-muted-foreground">Select a date first.</p>
                  )}
                  {selectedDate && slotsQ.isLoading && (
                    <p className="text-sm text-muted-foreground">Loading slots…</p>
                  )}
                  {selectedDate && slotsQ.data?.slots.length === 0 && (
                    <p className="text-sm text-muted-foreground">No slots on this day.</p>
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

                {bookableFactFinds.length > 0 && (
                  <div className="space-y-1.5">
                    <Label htmlFor="hub-book-session">Link to fact-find (optional)</Label>
                    <select
                      id="hub-book-session"
                      className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                      value={sessionId}
                      onChange={(e) => setSessionId(e.target.value)}
                    >
                      <option value="">New case / auto-pick latest fact-find</option>
                      {bookableFactFinds.map((ff) => (
                        <option key={ff.id} value={ff.id}>
                          {ff.status === "submitted" ? "Submitted" : "In progress"} ·{" "}
                          {format(new Date(ff.startedAt), "d MMM yyyy")}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="rounded-xl border p-3 space-y-3">
                  <h4 className="text-sm font-medium">Customer details</h4>
                  <div className="space-y-2">
                    <Label htmlFor="hub-book-name">Full name</Label>
                    <Input id="hub-book-name" value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="hub-book-phone">Mobile</Label>
                    <Input id="hub-book-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="hub-book-email">Email (optional)</Label>
                    <Input
                      id="hub-book-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>

            {book.isError && (
              <p className="text-sm text-destructive">{(book.error as Error).message}</p>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button
                disabled={!selectedSlot || !name.trim() || !phone.trim() || book.isPending}
                onClick={() => book.mutate()}
              >
                {book.isPending ? "Booking…" : "Confirm & open case"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
