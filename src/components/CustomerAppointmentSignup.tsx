import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CalendarCheck, CheckCircle2, MessageSquare, Mic } from "lucide-react";
import {
  customerAppointmentSignup,
  getAvailableSlots,
} from "@/lib/booking.functions";
import {
  BookingAdvisorPicker,
  advisorChoiceToPayload,
  type AdvisorChoice,
} from "@/components/BookingAdvisorPicker";
import { verifyAppointmentSignupSms } from "@/lib/auth.functions";
import { getReferralSlug } from "@/lib/referral";
import { isValidUkMobile, normaliseUkPhone } from "@/lib/phone";
import { markLoginSmsVerified } from "@/lib/auth-sms-session";
import { supabase } from "@/integrations/supabase/client";
import type { PostAuthStart } from "@/lib/post-auth-journey";
import { toast } from "sonner";

type Journey = PostAuthStart;

const JOURNEY_HINT: Record<Journey, { icon: typeof Mic; label: string; detail: string }> = {
  voice: {
    icon: Mic,
    label: "Spoken fact-find",
    detail: "After your appointment is booked, Susan will guide you through a short spoken interview.",
  },
  chat: {
    icon: MessageSquare,
    label: "Text fact-find",
    detail: "After your appointment is booked, you can answer the same questions in a quiet typed chat.",
  },
  book: {
    icon: CalendarCheck,
    label: "Appointment only",
    detail: "Pick a time to speak with your advisor — you can complete a fact-find before or after your call.",
  },
};

export function CustomerAppointmentSignup({
  journey = "book",
  onComplete,
  onSwitchSignIn,
}: {
  journey?: Journey;
  onComplete: () => void;
  onSwitchSignIn: () => void;
}) {
  const slotsFn = useServerFn(getAvailableSlots);
  const signupFn = useServerFn(customerAppointmentSignup);
  const verifyAppointmentSmsFn = useServerFn(verifyAppointmentSignupSms);

  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [advisorChoice, setAdvisorChoice] = useState<AdvisorChoice>("any");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [password, setPassword] = useState("");
  const [bookedAt, setBookedAt] = useState<Date | null>(null);
  const [smsCode, setSmsCode] = useState("");
  const [smsSent, setSmsSent] = useState(false);
  const [status, setStatus] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const hint = JOURNEY_HINT[journey];
  const HintIcon = hint.icon;

  const dateKey = selectedDate ? format(selectedDate, "yyyy-MM-dd") : null;
  const slotsQ = useQuery({
    queryKey: ["appointment-signup-slots", dateKey, "pool"],
    queryFn: () => slotsFn({ data: { date: dateKey!, pool: true } }),
    enabled: Boolean(dateKey),
  });
  const advisorsForSlot =
    selectedSlot && slotsQ.data?.advisorsBySlot
      ? (slotsQ.data.advisorsBySlot[selectedSlot] ?? [])
      : [];

  const finishSession = async (session: { access_token: string; refresh_token: string; user?: { id: string } }) => {
    const { error } = await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    if (error) throw error;
    markLoginSmsVerified(session as import("@supabase/supabase-js").Session);
    onComplete();
  };

  const verifySms = useMutation({
    mutationFn: async () => {
      const result = await verifyAppointmentSmsFn({
        data: {
          phone: normaliseUkPhone(customerPhone),
          code: smsCode.trim(),
        },
      });
      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: result.tokenHash,
        type: "magiclink",
      });
      if (error) throw error;
      if (!data.session) throw new Error("Sign-in did not complete — try again.");
      await finishSession(data.session);
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Invalid code";
      setStatus({ type: "error", text: msg });
      toast.error(msg);
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!selectedSlot) throw new Error("Choose a date and time for your appointment.");
      if (!customerName.trim() || customerName.trim().length < 2) {
        throw new Error("Enter your full name.");
      }
      if (!isValidUkMobile(customerPhone)) {
        throw new Error("Enter a valid UK mobile number (e.g. 07123 456789).");
      }
      const emailTrim = customerEmail.trim();
      const passwordTrim = password.trim();
      if (passwordTrim && passwordTrim.length < 6) {
        throw new Error("Password must be at least 6 characters, or leave it blank.");
      }
      if (passwordTrim && !emailTrim) {
        throw new Error("Enter your email if you want to set a password — or leave password blank.");
      }

      const adv = advisorChoiceToPayload(advisorChoice);
      const result = await signupFn({
        data: {
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          customerEmail: emailTrim,
          startsAt: selectedSlot,
          password: passwordTrim || undefined,
          journey,
          slug: getReferralSlug() ?? undefined,
          ...adv,
        },
      });

      setBookedAt(new Date(selectedSlot));

      if (result.signInEmail && passwordTrim) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: result.signInEmail,
          password: passwordTrim,
        });
        if (error) throw error;
        if (!data.session) throw new Error("Sign-in did not complete — try again.");
        await finishSession(data.session);
        return;
      }

      if (result.needsSmsCode) {
        setSmsSent(true);
        setStatus({
          type: "success",
          text: "Appointment booked. Enter the 6-digit code we texted you to continue.",
        });
        return;
      }

      onComplete();
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Could not book appointment";
      setStatus({ type: "error", text: msg });
      toast.error(msg);
    },
  });

  if (bookedAt && smsSent) {
    return (
      <div className="max-w-md mx-auto space-y-6 py-4">
        <div className="text-center space-y-3">
          <CheckCircle2 className="w-12 h-12 mx-auto text-accent" />
          <h2 className="text-2xl font-semibold">Appointment confirmed</h2>
          <p className="text-sm text-muted-foreground">
            Your call is booked for <strong>{format(bookedAt, "EEE d MMM yyyy, HH:mm")}</strong>.
            We&apos;ve texted you a confirmation and a one-time sign-in code.
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            verifySms.mutate();
          }}
          className="space-y-3 rounded-2xl border bg-card p-5"
        >
          <Label htmlFor="sms-code">6-digit code</Label>
          <Input
            id="sms-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
            value={smsCode}
            onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, ""))}
            required
          />
          <Button type="submit" className="w-full" disabled={verifySms.isPending}>
            {verifySms.isPending ? "Verifying…" : "Continue"}
          </Button>
        </form>
      </div>
    );
  }

  if (bookedAt && !smsSent) {
    return (
      <div className="max-w-md mx-auto text-center space-y-4 py-8">
        <CheckCircle2 className="w-12 h-12 mx-auto text-accent" />
        <h2 className="text-2xl font-semibold">Appointment confirmed</h2>
        <p className="text-sm text-muted-foreground">
          Your call is booked for <strong>{format(bookedAt, "EEE d MMM yyyy, HH:mm")}</strong>.
        </p>
        <Button onClick={onComplete}>Continue</Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-primary font-semibold">
            <CalendarCheck className="w-5 h-5" />
            Book your appointment
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Pick a time with your mortgage advisor
          </h1>
          <p className="text-sm text-muted-foreground max-w-xl">
            Choose a slot and enter your details — this books your call, not just an account.
            Password is optional; we can text you a sign-in code instead.
          </p>
        </div>
        <button
          type="button"
          onClick={onSwitchSignIn}
          className="text-sm text-muted-foreground hover:text-foreground hover:underline shrink-0"
        >
          Already booked? Sign in
        </button>
      </div>

      <div className="rounded-2xl border bg-muted/30 p-4 flex gap-3 items-start">
        <span className="inline-flex w-10 h-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <HintIcon className="w-5 h-5" />
        </span>
        <div>
          <p className="font-medium text-sm">{hint.label}</p>
          <p className="text-sm text-muted-foreground mt-0.5">{hint.detail}</p>
        </div>
      </div>

      {status && (
        <div
          role="alert"
          className={`rounded-lg border px-3 py-2 text-sm ${
            status.type === "error"
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-primary/30 bg-primary/10 text-foreground"
          }`}
        >
          {status.text}
        </div>
      )}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-8">
        <div className="rounded-2xl border bg-card p-4 sm:p-5 space-y-4">
          <h2 className="font-medium">Choose a date</h2>
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={(d) => {
              setSelectedDate(d);
              setSelectedSlot(null);
              setAdvisorChoice("any");
            }}
            disabled={{ before: new Date() }}
            className="mx-auto"
          />
          <div>
            <h3 className="font-medium mb-2 text-sm">Available times</h3>
            {!selectedDate && (
              <p className="text-sm text-muted-foreground">Select a date to see available slots.</p>
            )}
            {selectedDate && slotsQ.isLoading && (
              <p className="text-sm text-muted-foreground">Loading slots…</p>
            )}
            {selectedDate && slotsQ.data?.slots.length === 0 && (
              <p className="text-sm text-muted-foreground">No slots on this day — try another date.</p>
            )}
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {(slotsQ.data?.slots ?? []).map((slot) => (
                <Button
                  key={slot}
                  type="button"
                  variant={selectedSlot === slot ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setSelectedSlot(slot);
                    setAdvisorChoice("any");
                  }}
                >
                  {format(new Date(slot), "HH:mm")}
                </Button>
              ))}
            </div>
          </div>
          <BookingAdvisorPicker
            selectedSlot={selectedSlot}
            advisorsForSlot={advisorsForSlot}
            value={advisorChoice}
            onChange={setAdvisorChoice}
          />
        </div>

        <div className="rounded-2xl border bg-card p-4 sm:p-5 space-y-4">
          <h2 className="font-medium">Your details</h2>
          <p className="text-xs text-muted-foreground">
            Same information we use for all appointment bookings — your advisor needs these to confirm your call.
          </p>
          <div className="space-y-2">
            <Label htmlFor="appt-name">Full name</Label>
            <Input
              id="appt-name"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="As you'd like us to call you"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="appt-phone">Mobile number</Label>
            <Input
              id="appt-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="07…"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="appt-email">Email (optional)</Label>
            <Input
              id="appt-email"
              type="email"
              autoComplete="email"
              placeholder="For confirmation email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="appt-password">Password (optional)</Label>
            <Input
              id="appt-password"
              type="password"
              autoComplete="new-password"
              placeholder="Leave blank to sign in with a text code"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
            />
            <p className="text-xs text-muted-foreground">
              Optional — skip this if you prefer a one-time text code when you return.
            </p>
          </div>
          <Button
            type="button"
            className="w-full"
            size="lg"
            disabled={
              !selectedSlot ||
              !customerName.trim() ||
              !customerPhone.trim() ||
              submit.isPending
            }
            onClick={() => submit.mutate()}
          >
            {submit.isPending ? "Booking…" : "Confirm appointment"}
          </Button>
        </div>
      </div>
    </div>
  );
}
