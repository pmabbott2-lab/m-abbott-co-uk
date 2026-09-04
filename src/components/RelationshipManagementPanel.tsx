import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { useEffect, useState } from "react";
import {
  listRelationshipPipeline,
  refreshRelationshipActionableDates,
  type RelationshipPipelineRow,
} from "@/lib/relationship.functions";
import {
  bookCaseFollowUpAppointment,
  getAvailableSlots,
} from "@/lib/booking.functions";
import { prepareBrowserCall } from "@/lib/telephony.functions";
import { BrowserSoftphone } from "@/components/BrowserSoftphone";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReportTableScroll } from "@/components/ReportTableScroll";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import { CalendarCheck } from "lucide-react";

function formatPence(pence: number | null) {
  if (pence == null) return "—";
  return `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function RelationshipManagementPanel({ canRefresh }: { canRefresh: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listRelationshipPipeline);
  const refreshFn = useServerFn(refreshRelationshipActionableDates);
  const prepareFn = useServerFn(prepareBrowserCall);
  const slotsFn = useServerFn(getAvailableSlots);
  const bookFn = useServerFn(bookCaseFollowUpAppointment);

  const [selected, setSelected] = useState<RelationshipPipelineRow | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [bookName, setBookName] = useState("");
  const [bookPhone, setBookPhone] = useState("");
  const [bookEmail, setBookEmail] = useState("");

  const q = useQuery({
    queryKey: ["relationship-pipeline"],
    queryFn: () => listFn({ data: { withinDays: 365 } }),
  });

  const refresh = useMutation({
    mutationFn: () => refreshFn(),
    onSuccess: (r) => {
      toast.success(`Refreshed actionable dates for ${r.updated} case(s)`);
      qc.invalidateQueries({ queryKey: ["relationship-pipeline"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Refresh failed"),
  });

  useEffect(() => {
    if (!selected || !bookingOpen) return;
    setBookName(selected.customerName);
    setBookPhone(selected.customerPhone ?? "");
    setBookEmail(selected.customerEmail ?? "");
    setSelectedDate(undefined);
    setSelectedSlot(null);
  }, [selected, bookingOpen]);

  const advisorId = selected?.advisorIds[0];
  const dateKey = selectedDate ? format(selectedDate, "yyyy-MM-dd") : null;
  const slotsQ = useQuery({
    queryKey: ["relationship-slots", dateKey, advisorId, selected?.sessionId],
    queryFn: () => slotsFn({ data: { date: dateKey!, advisorId } }),
    enabled: bookingOpen && Boolean(dateKey) && Boolean(advisorId || selected),
  });

  const book = useMutation({
    mutationFn: () => {
      if (!selected?.customerId || !selectedSlot) throw new Error("Missing booking details");
      return bookFn({
        data: {
          sessionId: selected.sessionId,
          customerId: selected.customerId,
          advisorId: advisorId,
          customerName: bookName,
          customerPhone: bookPhone,
          customerEmail: bookEmail || undefined,
          startsAt: selectedSlot,
        },
      });
    },
    onSuccess: () => {
      toast.success("Appointment booked into advisor diary");
      setBookingOpen(false);
      qc.invalidateQueries({ queryKey: ["relationship-pipeline"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Booking failed"),
  });

  const rows = q.data?.rows ?? [];

  if (q.data?.migrationRequired) {
    return (
      <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
        Run <code className="text-xs">supabase/RUN_JOURNEY_FINANCE_CASE.sql</code> then add case details on
        customer cases.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-lg">Relationship management</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Renewals pipeline by product expiry. Click a lead to view details, soft-call, or book into an
            advisor diary. Actionable dates use lender lead times (indicative only).
          </p>
        </div>
        {canRefresh && (
          <Button
            variant="outline"
            size="sm"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            {refresh.isPending ? "Refreshing…" : "Refresh lender windows"}
          </Button>
        )}
      </div>

      <ReportTableScroll visibleRows={12}>
        {q.isLoading && <div className="p-6 text-sm text-muted-foreground">Loading…</div>}
        {!q.isLoading && rows.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground">
            No cases with product expiry in the next 12 months. Add case details on customer cases.
          </div>
        )}
        {rows.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="p-3 font-medium">Customer</th>
                <th className="p-3 font-medium">Case</th>
                <th className="p-3 font-medium">Lender</th>
                <th className="p-3 font-medium">Expiry</th>
                <th className="p-3 font-medium">Actionable from</th>
                <th className="p-3 font-medium">Journey</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr
                  key={row.sessionId}
                  className="cursor-pointer hover:bg-muted/40 transition-colors"
                  onClick={() => {
                    setSelected(row);
                    setBookingOpen(false);
                  }}
                >
                  <td className="p-3 font-medium">{row.customerName}</td>
                  <td className="p-3">
                    <Link
                      to="/sessions/$sessionId"
                      params={{ sessionId: row.sessionId }}
                      className="text-primary hover:underline font-mono text-xs"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {row.caseRef}
                    </Link>
                  </td>
                  <td className="p-3">{row.currentLender ?? "—"}</td>
                  <td className="p-3 whitespace-nowrap">
                    {row.productExpiryDate
                      ? format(new Date(row.productExpiryDate), "d MMM yyyy")
                      : "—"}
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    {row.actionableFromDate
                      ? format(new Date(row.actionableFromDate), "d MMM yyyy")
                      : "—"}
                  </td>
                  <td className="p-3 text-muted-foreground">{row.journeyStage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportTableScroll>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.customerName}</SheetTitle>
                <SheetDescription>
                  Case {selected.caseRef ?? "—"} · {selected.journeyStage}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Phone</dt>
                    <dd className="font-medium">{selected.customerPhone || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Email</dt>
                    <dd className="font-medium break-all">{selected.customerEmail || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Lender</dt>
                    <dd className="font-medium">{selected.currentLender || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Monthly payment</dt>
                    <dd className="font-medium">{formatPence(selected.monthlyPaymentPence)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Product expiry</dt>
                    <dd className="font-medium">
                      {selected.productExpiryDate
                        ? format(new Date(selected.productExpiryDate), "d MMM yyyy")
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Actionable from</dt>
                    <dd className="font-medium">
                      {selected.actionableFromDate
                        ? format(new Date(selected.actionableFromDate), "d MMM yyyy")
                        : "—"}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-xs text-muted-foreground">Advisor(s)</dt>
                    <dd className="font-medium">
                      {selected.advisorNames.length ? selected.advisorNames.join(", ") : "Unallocated"}
                    </dd>
                  </div>
                  {selected.actionableNote && (
                    <div className="col-span-2">
                      <dt className="text-xs text-muted-foreground">Note</dt>
                      <dd className="text-sm text-muted-foreground">{selected.actionableNote}</dd>
                    </div>
                  )}
                </dl>

                <div className="rounded-xl border p-4 space-y-3">
                  <h4 className="text-sm font-semibold">Soft call</h4>
                  <p className="text-xs text-muted-foreground">
                    Call from the browser — the customer sees the office number. Use this for renewal
                    outreach before booking into an advisor diary.
                  </p>
                  {selected.customerPhone ? (
                    <BrowserSoftphone
                      customerName={selected.customerName}
                      customerPhone={selected.customerPhone}
                      onCall={async () =>
                        prepareFn({
                          data: {
                            sessionId: selected.sessionId,
                            customerPhone: selected.customerPhone!,
                          },
                        })
                      }
                      onCallComplete={() => {
                        qc.invalidateQueries({ queryKey: ["relationship-pipeline"] });
                      }}
                    />
                  ) : (
                    <p className="text-sm text-amber-700 dark:text-amber-400">
                      Add a phone number on the customer profile to enable soft calling.
                    </p>
                  )}
                </div>

                <div className="rounded-xl border p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-semibold">Book appointment</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Books into{" "}
                        {selected.advisorNames[0]
                          ? `${selected.advisorNames[0]}’s diary`
                          : "your booking diary"}
                        .
                      </p>
                    </div>
                    {!bookingOpen && (
                      <Button size="sm" onClick={() => setBookingOpen(true)}>
                        <CalendarCheck className="w-4 h-4 mr-1.5" />
                        Book
                      </Button>
                    )}
                  </div>

                  {bookingOpen && (
                    <div className="space-y-4 pt-1">
                      <div className="grid sm:grid-cols-2 gap-3">
                        <div className="rounded-lg border p-2">
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
                        <div className="space-y-3">
                          <div>
                            <h5 className="text-xs font-medium mb-2">Time</h5>
                            {!selectedDate && (
                              <p className="text-xs text-muted-foreground">Select a date first.</p>
                            )}
                            {selectedDate && slotsQ.isLoading && (
                              <p className="text-xs text-muted-foreground">Loading slots…</p>
                            )}
                            <div className="grid grid-cols-2 gap-1.5">
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
                          <div className="space-y-2">
                            <Label htmlFor="rel-book-name">Name</Label>
                            <Input
                              id="rel-book-name"
                              value={bookName}
                              onChange={(e) => setBookName(e.target.value)}
                            />
                            <Label htmlFor="rel-book-phone">Phone</Label>
                            <Input
                              id="rel-book-phone"
                              value={bookPhone}
                              onChange={(e) => setBookPhone(e.target.value)}
                            />
                            <Label htmlFor="rel-book-email">Email</Label>
                            <Input
                              id="rel-book-email"
                              type="email"
                              value={bookEmail}
                              onChange={(e) => setBookEmail(e.target.value)}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setBookingOpen(false)}>
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          disabled={
                            !selectedSlot ||
                            !bookName.trim() ||
                            !bookPhone.trim() ||
                            !selected.customerId ||
                            book.isPending
                          }
                          onClick={() => book.mutate()}
                        >
                          {book.isPending ? "Booking…" : "Confirm appointment"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                <Link
                  to="/sessions/$sessionId"
                  params={{ sessionId: selected.sessionId }}
                  className="text-sm text-primary hover:underline"
                >
                  Open full case →
                </Link>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
