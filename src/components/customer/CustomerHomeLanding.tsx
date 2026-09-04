import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type ReactNode } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  ArrowRight,
  CalendarCheck,
  FileText,
  Gift,
  Mail,
  MapPin,
  MessageSquare,
  Mic,
  PhoneCall,
  Copy,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { createSession, listMyCases } from "@/lib/sessions.functions";
import {
  ensureMyReferralLink,
  getPublicShareBaseUrl,
  listMyReferralActivity,
  sendMyReferralLink,
} from "@/lib/referrals.functions";
import { rafLinkForCode, rafShareMessage } from "@/lib/referral";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HubSubNav } from "@/components/ui/tabs";
import {
  PostCompletionBooking,
  CALLBACK_WINDOW_OPTIONS,
  CALLBACK_WINDOW_RANGES,
} from "@/components/PostCompletionBooking";
import { getSessionBooking, requestCallbackAuth } from "@/lib/booking.functions";
import { supabase } from "@/integrations/supabase/client";

const CARD =
  "group text-left rounded-2xl border bg-card p-5 hover:border-primary hover:shadow-sm transition disabled:opacity-60 h-full w-full";

function CopyLinkButton({ value, label = "Copy link" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success("Copied");
          setTimeout(() => setCopied(false), 2000);
        } catch {
          toast.error("Could not copy");
        }
      }}
    >
      {copied ? <Check className="w-4 h-4 mr-1.5" /> : <Copy className="w-4 h-4 mr-1.5" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

function JourneyCard({
  icon,
  title,
  description,
  onClick,
  disabled,
  active,
  cta,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  cta?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`${CARD} ${active ? "border-primary bg-primary/5" : ""}`}
    >
      <span className="inline-flex w-11 h-11 items-center justify-center rounded-full bg-primary/10 text-primary">
        {icon}
      </span>
      <h3 className="font-semibold text-base mt-3 flex items-center gap-1.5">
        {title}
        <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition shrink-0" />
      </h3>
      <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{description}</p>
      {cta && <p className="text-sm font-medium text-primary mt-3">{cta}</p>}
    </button>
  );
}

function CallbackBanner({
  expanded,
  onToggle,
  sessionId,
}: {
  expanded: boolean;
  onToggle: () => void;
  sessionId: string | null;
}) {
  const callbackFn = useServerFn(requestCallbackAuth);
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [callbackWindow, setCallbackWindow] = useState<"9-12" | "12-4" | "4-8" | null>(null);
  const [done, setDone] = useState(false);

  useQuery({
    queryKey: ["profile-for-home-callback"],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, email, phone")
        .eq("id", user.id)
        .maybeSingle();
      const name = profile?.full_name ?? "";
      const email = profile?.email ?? "";
      const phone = (profile as { phone?: string | null } | null)?.phone ?? "";
      if (name) {
        setProfileName(name);
        setCustomerName((p) => p || name);
      }
      if (email) {
        setProfileEmail(email);
        setCustomerEmail((p) => p || email);
      }
      if (phone) setCustomerPhone((p) => p || phone);
      return profile;
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
    onSuccess: () => {
      setDone(true);
      toast.success("Call-back requested");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not request call back"),
  });

  return (
    <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.06] to-transparent p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
        <span className="inline-flex w-12 h-12 items-center justify-center rounded-full bg-primary text-primary-foreground shrink-0">
          <PhoneCall className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-base">Prefer us to call you?</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Arrange a call back and an advisor will ring you in a window that suits — no need to start a
            fact-find first.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant={expanded ? "secondary" : "default"}
          className="shrink-0"
          onClick={onToggle}
        >
          {expanded ? "Close" : "Arrange a call back"}
        </Button>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-border/60 space-y-3">
          {sessionId ? (
            <PostCompletionBooking
              sessionId={sessionId}
              channel="text"
              defaultName={profileName}
              defaultEmail={profileEmail}
              initialMode="callback"
              hideModeToggle
              compact
              onComplete={() => {
                setDone(true);
                toast.success("Call-back requested");
              }}
            />
          ) : done ? (
            <p className="text-sm text-muted-foreground">
              Thanks — we&apos;ll call you
              {callbackWindow ? ` between ${CALLBACK_WINDOW_RANGES[callbackWindow]}` : ""}.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Pick a window and leave a number we can reach you on.
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                {CALLBACK_WINDOW_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer text-sm ${
                      callbackWindow === opt.value ? "border-primary bg-primary/5" : "bg-background"
                    }`}
                  >
                    <input
                      type="radio"
                      name="home-callback-window"
                      checked={callbackWindow === opt.value}
                      onChange={() => setCallbackWindow(opt.value)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="home-cb-name">Full name</Label>
                  <Input id="home-cb-name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="home-cb-phone">Mobile</Label>
                  <Input id="home-cb-phone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="home-cb-email">Email</Label>
                  <Input
                    id="home-cb-email"
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                  />
                </div>
              </div>
              <Button
                disabled={
                  !callbackWindow || !customerName.trim() || !customerPhone.trim() || callback.isPending
                }
                onClick={() => callback.mutate()}
              >
                {callback.isPending ? "Sending…" : "Request call back"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AppointmentJourneyCard({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  const qc = useQueryClient();
  const casesFn = useServerFn(listMyCases);
  const bookingFn = useServerFn(getSessionBooking);
  const casesQ = useQuery({ queryKey: ["my-cases"], queryFn: () => casesFn() });
  const [panel, setPanel] = useState<"none" | "amend">("none");
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");

  useQuery({
    queryKey: ["profile-for-home-booking"],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", user.id)
        .maybeSingle();
      if (profile?.full_name) setProfileName(profile.full_name);
      if (profile?.email) setProfileEmail(profile.email);
      return profile;
    },
  });

  const cases = casesQ.data ?? [];
  const withAppt = cases
    .filter((c) => c.appointment)
    .sort(
      (a, b) =>
        new Date(a.appointment!.startsAt).getTime() - new Date(b.appointment!.startsAt).getTime(),
    );
  const now = Date.now();
  const upcoming =
    withAppt.find((c) => new Date(c.appointment!.startsAt).getTime() >= now) ?? withAppt[0] ?? null;

  const bookingQ = useQuery({
    queryKey: ["landing-booking", upcoming?.id],
    queryFn: () => bookingFn({ data: { sessionId: upcoming!.id } }),
    enabled: Boolean(upcoming?.id),
  });

  if (casesQ.isLoading) {
    return <div className={`${CARD} text-sm text-muted-foreground flex items-center`}>Loading…</div>;
  }

  if (!upcoming?.appointment) {
    return (
      <Link to="/booking" className={`${CARD} block`}>
        <span className="inline-flex w-11 h-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CalendarCheck className="w-5 h-5" />
        </span>
        <h3 className="font-semibold text-base mt-3 flex items-center gap-1.5">
          Book an appointment
          <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition shrink-0" />
        </h3>
        <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
          Prefer to speak to an advisor first? Choose a time that suits you — we&apos;ll confirm by text.
        </p>
        <p className="text-sm font-medium text-primary mt-3">Pick a time →</p>
      </Link>
    );
  }

  const appt = upcoming.appointment;
  const callback = bookingQ.data?.callback ?? null;
  const callbackOpen = callback && callback.status !== "closed";

  return (
    <>
      <JourneyCard
        icon={<CalendarCheck className="w-5 h-5" />}
        title="Your appointment"
        description={`Booked for ${format(new Date(appt.startsAt), "EEE d MMM, HH:mm")} with ${appt.advisorName}. Tap to view or amend.`}
        onClick={onToggle}
        active={expanded}
        cta="View appointment →"
      />
      {expanded && (
        <div className="sm:col-span-3 rounded-2xl border bg-card p-4 space-y-3">
          <dl className="grid sm:grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Date &amp; time</dt>
              <dd className="font-medium">{format(new Date(appt.startsAt), "EEE d MMM yyyy, HH:mm")}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Advisor</dt>
              <dd className="font-medium">{appt.advisorName}</dd>
            </div>
            {upcoming.case_ref && (
              <div>
                <dt className="text-xs text-muted-foreground">Case</dt>
                <dd className="font-mono text-xs">{upcoming.case_ref}</dd>
              </div>
            )}
          </dl>
          {callbackOpen && (
            <p className="text-xs text-primary inline-flex items-center gap-1">
              <PhoneCall className="w-3 h-3" />
              Call-back requested ·{" "}
              {CALLBACK_WINDOW_RANGES[callback.preferredWindow as "9-12" | "12-4" | "4-8"] ??
                callback.preferredWindow}
            </p>
          )}
          {panel === "none" ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setPanel("amend")}>
                Amend appointment
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={onToggle}>
                Close
              </Button>
            </div>
          ) : (
            <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-medium text-sm">Change your appointment</h4>
                <Button type="button" variant="ghost" size="sm" onClick={() => setPanel("none")}>
                  Cancel
                </Button>
              </div>
              <PostCompletionBooking
                sessionId={upcoming.id}
                channel="text"
                defaultName={profileName}
                defaultEmail={profileEmail}
                initialMode="appointment"
                hideModeToggle
                compact
                onComplete={() => {
                  qc.invalidateQueries({ queryKey: ["my-cases"] });
                  qc.invalidateQueries({ queryKey: ["landing-booking"] });
                  setPanel("none");
                  toast.success("Appointment updated");
                }}
              />
            </div>
          )}
        </div>
      )}
    </>
  );
}

function RafFooter({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const qc = useQueryClient();
  const activityFn = useServerFn(listMyReferralActivity);
  const ensureFn = useServerFn(ensureMyReferralLink);
  const sendFn = useServerFn(sendMyReferralLink);
  const publicUrlFn = useServerFn(getPublicShareBaseUrl);
  const activityQ = useQuery({ queryKey: ["my-raf-activity"], queryFn: () => activityFn() });
  const publicUrlQ = useQuery({ queryKey: ["public-share-url"], queryFn: () => publicUrlFn() });
  const shareBase = publicUrlQ.data?.baseUrl;

  const ensure = useMutation({
    mutationFn: () => ensureFn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-raf-activity"] }),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not create link"),
  });
  const sendSmsLink = useMutation({
    mutationFn: () => sendFn({ data: { channel: "sms" } }),
    onSuccess: () => toast.success("Referral link sent to your mobile"),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not send text"),
  });
  const sendEmailLink = useMutation({
    mutationFn: () => sendFn({ data: { channel: "email" } }),
    onSuccess: (result) => {
      if (result.mailto) window.location.href = result.mailto;
      else toast.success("Ready to share");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not open email"),
  });

  const code = activityQ.data?.codes?.[0]?.code;
  const referrals = activityQ.data?.referrals ?? [];

  return (
    <div className="rounded-2xl border border-dashed border-amber-300/80 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-800 p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <span className="inline-flex w-11 h-11 items-center justify-center rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200 shrink-0">
          <Gift className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">Refer a friend · £75 bonus</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Separate from your fact-find — share your personal link when a friend needs mortgage advice.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={onToggle}>
          {expanded ? "Hide" : "Get my link"}
        </Button>
      </div>
      {expanded && (
        <div className="mt-4 pt-4 border-t border-amber-200/80 dark:border-amber-900 space-y-3">
          {activityQ.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!activityQ.isLoading && !code && (
            <Button size="sm" onClick={() => ensure.mutate()} disabled={ensure.isPending}>
              {ensure.isPending ? "Creating…" : "Create my referral link"}
            </Button>
          )}
          {code && (
            <div className="space-y-3">
              <p className="text-xs font-mono break-all bg-background/80 rounded-lg px-3 py-2 border">
                {rafLinkForCode(code, shareBase)}
              </p>
              <div className="flex flex-wrap gap-2">
                <CopyLinkButton value={rafShareMessage(null, code, shareBase)} label="Copy share message" />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={sendSmsLink.isPending}
                  onClick={() => sendSmsLink.mutate()}
                >
                  <MessageSquare className="w-4 h-4 mr-1.5" />
                  {sendSmsLink.isPending ? "Sending…" : "Text me the link"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={sendEmailLink.isPending}
                  onClick={() => sendEmailLink.mutate()}
                >
                  <Mail className="w-4 h-4 mr-1.5" />
                  {sendEmailLink.isPending ? "Opening…" : "Email link"}
                </Button>
              </div>
            </div>
          )}
          {referrals.length > 0 && (
            <div className="rounded-xl border bg-background/70 p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Your referrals
              </p>
              {referrals.slice(0, 5).map((r) => (
                <div key={r.id} className="text-sm flex justify-between gap-2">
                  <span className="truncate">{r.referredEmail ?? r.referredPhone ?? "Friend"}</span>
                  <span className="text-xs text-muted-foreground shrink-0 capitalize">{r.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryTab() {
  const casesFn = useServerFn(listMyCases);
  const casesQ = useQuery({ queryKey: ["my-cases"], queryFn: () => casesFn() });
  const cases = casesQ.data ?? [];

  if (casesQ.isLoading) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Loading your cases…</p>;
  }
  if (!cases.length) {
    return (
      <div className="rounded-2xl border bg-card p-8 text-center space-y-3">
        <FileText className="w-10 h-10 mx-auto text-muted-foreground" />
        <p className="text-muted-foreground text-sm max-w-md mx-auto">
          No cases yet. Start a fact-find or book an appointment from the Start tab — a case opens when an
          appointment is booked.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Your cases, journey progress, and next steps. Open a case for the full detail.
      </p>
      {cases.map((c) => {
        const journeyPct =
          c.journey.total > 0 ? Math.round((c.journey.completed / c.journey.total) * 100) : 0;
        return (
          <div key={c.id} className="rounded-2xl border bg-card overflow-hidden">
            <Link
              to="/sessions/$sessionId"
              params={{ sessionId: c.id }}
              className="block p-5 hover:bg-muted/30 transition"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-lg">{c.case_ref ?? "Case pending ref"}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {c.status === "submitted" ? "Submitted" : "In progress"} · Started{" "}
                    {formatDistanceToNow(new Date(c.started_at), { addSuffix: true })}
                  </div>
                </div>
                <span className="text-xs text-primary flex items-center gap-1 shrink-0">
                  Open case <ArrowRight className="w-4 h-4" />
                </span>
              </div>
              {c.summary && (
                <p className="text-sm text-muted-foreground mt-3 line-clamp-2">{c.summary}</p>
              )}
            </Link>
            <div className="border-t px-5 py-4 bg-muted/20 space-y-3">
              <div>
                <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" />
                  Journey progress
                </h4>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary transition-all" style={{ width: `${journeyPct}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {c.journey.completed}/{c.journey.total}
                  </span>
                </div>
              </div>
              {c.appointment && (
                <div className="rounded-xl border bg-background p-3 text-sm">
                  <div className="font-medium flex items-center gap-1.5">
                    <CalendarCheck className="w-3.5 h-3.5" />
                    Appointment
                  </div>
                  <div className="text-muted-foreground text-xs mt-1">
                    {format(new Date(c.appointment.startsAt), "EEE d MMM yyyy, HH:mm")} ·{" "}
                    {c.appointment.advisorName}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
      <div className="text-center">
        <Link to="/cases" className="text-sm text-primary hover:underline">
          Open full summary page →
        </Link>
      </div>
    </div>
  );
}

export function CustomerHomeLanding({
  inProgressId,
  hasSubmitted,
  caseCount,
}: {
  inProgressId: string | null;
  hasSubmitted: boolean;
  caseCount: number;
}) {
  const navigate = useNavigate();
  const createFn = useServerFn(createSession);
  const [homePanel, setHomePanel] = useState<"none" | "appointment" | "callback" | "raf">("none");
  const toggle = (panel: "appointment" | "callback" | "raf") =>
    setHomePanel((c) => (c === panel ? "none" : panel));

  const create = useMutation({
    mutationFn: async (mode: "voice" | "chat") => ({ session: await createFn(), mode }),
    onSuccess: ({ session, mode }) =>
      navigate({
        to: mode === "chat" ? "/chat/$sessionId" : "/interview/$sessionId",
        params: { sessionId: session.id },
      }),
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Could not start interview — please try again.");
    },
  });

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <CallbackBanner
        expanded={homePanel === "callback"}
        onToggle={() => toggle("callback")}
        sessionId={inProgressId}
      />

      <HubSubNav
        persistKey="customer-home"
        defaultValue="start"
        tabs={[
          {
            id: "start",
            label: "Start",
            content: (
              <div className="space-y-5">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight">
                    {inProgressId ? "Continue your mortgage journey" : "How would you like to start?"}
                  </h2>
                  <p className="text-muted-foreground text-sm mt-1.5 leading-relaxed">
                    {inProgressId
                      ? "Pick up where you left off — talk or type, and you can switch any time."
                      : hasSubmitted
                        ? "Start a fresh fact-find, book time with an advisor, or ask us to call you back above."
                        : "Three clear ways to begin. Choose the one that feels easiest — your advisor reviews everything before any recommendation."}
                  </p>
                </div>

                <div className="grid sm:grid-cols-3 gap-3">
                  <JourneyCard
                    icon={<Mic className="w-5 h-5" />}
                    title={inProgressId ? "Continue talking" : "Talk it through"}
                    description="A spoken fact-find with Susan. Ideal if you prefer speaking rather than typing."
                    disabled={create.isPending}
                    cta={
                      create.isPending && create.variables === "voice"
                        ? "Starting…"
                        : inProgressId
                          ? "Resume voice →"
                          : "Start voice →"
                    }
                    onClick={() =>
                      inProgressId
                        ? void navigate({
                            to: "/interview/$sessionId",
                            params: { sessionId: inProgressId },
                          })
                        : create.mutate("voice")
                    }
                  />
                  <JourneyCard
                    icon={<MessageSquare className="w-5 h-5" />}
                    title={inProgressId ? "Continue typing" : "Type it out"}
                    description="The same questions in a quiet chat — no microphone, at your own pace."
                    disabled={create.isPending}
                    cta={
                      create.isPending && create.variables === "chat"
                        ? "Starting…"
                        : inProgressId
                          ? "Resume chat →"
                          : "Start chat →"
                    }
                    onClick={() =>
                      inProgressId
                        ? void navigate({
                            to: "/chat/$sessionId",
                            params: { sessionId: inProgressId },
                          })
                        : create.mutate("chat")
                    }
                  />
                  <AppointmentJourneyCard
                    expanded={homePanel === "appointment"}
                    onToggle={() => toggle("appointment")}
                  />
                </div>
              </div>
            ),
          },
          {
            id: "summary",
            label: caseCount > 0 ? `Your summary (${caseCount})` : "Your summary",
            content: <SummaryTab />,
          },
        ]}
      />

      <RafFooter expanded={homePanel === "raf"} onToggle={() => toggle("raf")} />
    </div>
  );
}
