import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
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
  bookNewCustomerAsIntroducer,
  getAvailableSlots,
  getStaffBookingAdvisorId,
  sendIntroducerCustomerBookingLink,
} from "@/lib/booking.functions";
import { CalendarCheck, CheckCircle2, Mail, MessageSquare } from "lucide-react";
import { toast } from "sonner";

export function IntroducerCustomerBookingCard({ onBooked }: { onBooked?: () => void }) {
  const slotsFn = useServerFn(getAvailableSlots);
  const advisorFn = useServerFn(getStaffBookingAdvisorId);
  const bookFn = useServerFn(bookNewCustomerAsIntroducer);
  const linkFn = useServerFn(sendIntroducerCustomerBookingLink);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"book" | "link">("book");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [bookedAt, setBookedAt] = useState<Date | null>(null);
  const [sentLink, setSentLink] = useState<string | null>(null);

  const advisorQ = useQuery({
    queryKey: ["introducer-booking-advisor"],
    queryFn: () => advisorFn(),
    enabled: open,
  });
  const advisorId = advisorQ.data?.advisorId;

  const dateKey = selectedDate ? format(selectedDate, "yyyy-MM-dd") : null;
  const slotsQ = useQuery({
    queryKey: ["introducer-new-slots", dateKey, advisorId],
    queryFn: () => slotsFn({ data: { date: dateKey!, advisorId } }),
    enabled: open && mode === "book" && Boolean(dateKey) && Boolean(advisorId),
  });

  const resetForm = () => {
    setSelectedDate(undefined);
    setSelectedSlot(null);
    setBookedAt(null);
    setSentLink(null);
  };

  const book = useMutation({
    mutationFn: () =>
      bookFn({
        data: {
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
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not book appointment"),
  });

  const sendLink = useMutation({
    mutationFn: (channel: "sms" | "email") =>
      linkFn({
        data: {
          customerName: name,
          customerPhone: phone,
          customerEmail: email,
          sendSms: channel === "sms",
        },
      }),
    onSuccess: (res) => {
      setSentLink(res.bookUrl);
      if (sendLink.variables === "email" && res.mailto) {
        window.location.href = res.mailto;
      }
      toast.success(sendLink.variables === "sms" ? "Booking link sent by text" : "Email draft opened");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not send link"),
  });

  const canSubmit = name.trim().length >= 2 && phone.trim().length >= 7 && email.includes("@");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <CalendarCheck className="w-4 h-4 mr-2" />
          Customer booking
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        {bookedAt ? (
          <div className="text-center space-y-4 py-4">
            <CheckCircle2 className="w-12 h-12 mx-auto text-accent" />
            <DialogHeader className="text-center">
              <DialogTitle>Appointment booked</DialogTitle>
              <DialogDescription>
                Referral recorded for {name}. Confirmed for{" "}
                <strong>{format(bookedAt, "EEE d MMM yyyy, HH:mm")}</strong>. The customer receives
                a text and email confirmation with options to complete the fact-find or confirm
                attendance.
              </DialogDescription>
            </DialogHeader>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </div>
        ) : sentLink ? (
          <div className="space-y-4 py-2">
            <DialogHeader>
              <DialogTitle>Booking link ready</DialogTitle>
              <DialogDescription>
                Share this link with {name} if they still need to pick a time.
              </DialogDescription>
            </DialogHeader>
            <Input readOnly value={sentLink} className="font-mono text-xs" />
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(sentLink);
                toast.success("Link copied");
              }}
            >
              Copy link
            </Button>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Customer booking</DialogTitle>
              <DialogDescription>
                Book an appointment or send a self-booking link. Name, email and mobile are required.
                The referral is credited to you.
              </DialogDescription>
            </DialogHeader>

            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={mode === "book" ? "secondary" : "ghost"}
                onClick={() => setMode("book")}
              >
                Book now
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "link" ? "secondary" : "ghost"}
                onClick={() => setMode("link")}
              >
                Send link
              </Button>
            </div>

            <div className="rounded-xl border p-3 space-y-3">
              <div className="space-y-2">
                <Label htmlFor="intro-book-name">Full name</Label>
                <Input id="intro-book-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="intro-book-email">Email</Label>
                  <Input
                    id="intro-book-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="intro-book-phone">Mobile</Label>
                  <Input
                    id="intro-book-phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {mode === "book" && (
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
                <div>
                  <h4 className="text-sm font-medium mb-2">Time</h4>
                  {!selectedDate && (
                    <p className="text-sm text-muted-foreground">Select a date first.</p>
                  )}
                  {selectedDate && slotsQ.isLoading && (
                    <p className="text-sm text-muted-foreground">Loading slots…</p>
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
              </div>
            )}

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              {mode === "book" ? (
                <Button
                  disabled={!canSubmit || !selectedSlot || book.isPending}
                  onClick={() => book.mutate()}
                >
                  {book.isPending ? "Booking…" : "Confirm & book"}
                </Button>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    disabled={!canSubmit || sendLink.isPending}
                    onClick={() => sendLink.mutate("sms")}
                  >
                    <MessageSquare className="w-4 h-4 mr-1.5" />
                    Text link
                  </Button>
                  <Button
                    disabled={!canSubmit || sendLink.isPending}
                    onClick={() => sendLink.mutate("email")}
                  >
                    <Mail className="w-4 h-4 mr-1.5" />
                    Email link
                  </Button>
                </>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
