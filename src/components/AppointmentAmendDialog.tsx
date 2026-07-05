import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getAvailableSlots,
  getStaffBookingAdvisorId,
  rescheduleAppointment,
  type SessionBookingDetails,
} from "@/lib/booking.functions";
import { CalendarCheck } from "lucide-react";
import { toast } from "sonner";

type Props = {
  appointment: NonNullable<SessionBookingDetails["appointment"]>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAmended?: () => void;
};

export function AppointmentAmendDialog({ appointment, open, onOpenChange, onAmended }: Props) {
  const slotsFn = useServerFn(getAvailableSlots);
  const advisorFn = useServerFn(getStaffBookingAdvisorId);
  const amendFn = useServerFn(rescheduleAppointment);

  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  const advisorQ = useQuery({
    queryKey: ["staff-booking-advisor"],
    queryFn: () => advisorFn(),
    enabled: open,
  });
  const advisorId = advisorQ.data?.advisorId;

  useEffect(() => {
    if (!open) return;
    setSelectedDate(undefined);
    setSelectedSlot(null);
  }, [open, appointment.id]);

  const dateKey = selectedDate ? format(selectedDate, "yyyy-MM-dd") : null;
  const slotsQ = useQuery({
    queryKey: ["amend-slots", dateKey, advisorId, appointment.id],
    queryFn: () => slotsFn({ data: { date: dateKey!, advisorId } }),
    enabled: open && Boolean(dateKey) && Boolean(advisorId),
  });

  const amend = useMutation({
    mutationFn: () =>
      amendFn({
        data: {
          appointmentId: appointment.id,
          startsAt: selectedSlot!,
        },
      }),
    onSuccess: () => {
      toast.success("Appointment updated");
      onOpenChange(false);
      onAmended?.();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not amend appointment"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarCheck className="w-5 h-5" />
            Amend appointment
          </DialogTitle>
          <DialogDescription>
            Reschedule for {appointment.customerName}. Current time:{" "}
            {format(new Date(appointment.startsAt), "EEE d MMM yyyy, HH:mm")}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-xl border p-3">
            <h4 className="text-sm font-medium mb-2">New date</h4>
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
            <h4 className="text-sm font-medium mb-2">New time</h4>
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!selectedSlot || amend.isPending} onClick={() => amend.mutate()}>
            {amend.isPending ? "Saving…" : "Confirm new time"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
