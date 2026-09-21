import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { listMySessions, createSession, getMyRole, listMyCases } from "@/lib/sessions.functions";
import { claimReferral, listMyReferralActivity, ensureMyReferralLink, sendMyReferralLink, getPublicShareBaseUrl } from "@/lib/referrals.functions";
import { getRafCode, clearRafCookie, rafLinkForCode, rafShareMessage } from "@/lib/referral";
import { checkIsIntroducer } from "@/lib/introducer.functions";
import { clearPostAuthStart, resolvePostAuthStart } from "@/lib/post-auth-journey";
import { StaffDashboardLoader } from "@/components/staff/StaffDashboard";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { TenantAppLink as Link, useTenantAwareNavigate } from "@/components/tenant/TenantAppLink";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HubSubNav } from "@/components/ui/tabs";
import {
  Mic,
  MessageSquare,
  FileText,
  ArrowRight,
  CalendarCheck,
  PhoneCall,
  Gift,
  Copy,
  Check,
  Mail,
  MapPin,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PostCompletionBooking, CALLBACK_WINDOW_OPTIONS, CALLBACK_WINDOW_RANGES } from "@/components/PostCompletionBooking";
import { getSessionBooking, requestCallbackAuth } from "@/lib/booking.functions";
import { CustomerHomeLanding } from "@/components/customer/CustomerHomeLanding";

export const Route = createFileRoute("/_authenticated/home")({
  pendingMs: 0,
  pendingMinMs: 0,
  component: Home,
});


function CopyLinkButton({ value, label = "Copy link" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy");
    }
  };
  return (
    <Button type="button" size="sm" variant="outline" onClick={() => void copy()}>
      {copied ? <Check className="w-4 h-4 mr-1.5" /> : <Copy className="w-4 h-4 mr-1.5" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

const JOURNEY_CARD_CLASS =
  "group text-left rounded-2xl border bg-card p-5 hover:border-primary hover:shadow-sm transition disabled:opacity-60 h-full w-full";

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
      className={`${JOURNEY_CARD_CLASS} ${active ? "border-primary bg-primary/5" : ""}`}
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

/** Legacy tile chrome kept for unused helpers until fully removed. */
const TILE_CLASS = JOURNEY_CARD_CLASS;
function OptionTile({
  icon,
  title,
  subtitle,
  onClick,
  disabled,
  active,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <JourneyCard
      icon={icon}
      title={title}
      description={subtitle}
      onClick={onClick}
      disabled={disabled}
      active={active}
    />
  );
}

function CustomerAppointmentCard({
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

  const [panel, setPanel] = useState<"none" | "amend" | "callback">("none");
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

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["my-cases"] });
    qc.invalidateQueries({ queryKey: ["landing-booking"] });
    setPanel("none");
  };

  if (casesQ.isLoading) {
    return (
      <div className={`${TILE_CLASS} text-sm text-muted-foreground flex items-center`}>
        Loading…
      </div>
    );
  }

  if (!upcoming?.appointment) {
    return (
      <Link to="/booking" className={`${TILE_CLASS} block`}>
        <div className="flex items-start gap-2.5">
          <span className="inline-flex w-9 h-9 items-center justify-center rounded-full bg-primary/10 text-primary shrink-0">
            <CalendarCheck className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <div className="font-semibold text-sm leading-tight flex items-center gap-1">
              Book appointment
              <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition shrink-0" />
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
              Pick a time with your advisor.
            </div>
          </div>
        </div>
      </Link>
    );
  }

  const appt = upcoming.appointment;
  const callback = bookingQ.data?.callback ?? null;
  const callbackOpen = callback && callback.status !== "closed";

  return (
    <>
      <OptionTile
        icon={<CalendarCheck className="w-4 h-4" />}
        title="Your appointment"
        subtitle={format(new Date(appt.startsAt), "EEE d MMM, HH:mm")}
        onClick={onToggle}
        active={expanded}
      />
      {expanded && (
        <div className="col-span-2 lg:col-span-3 rounded-2xl border bg-card p-4 space-y-3">
          <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
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
          {panel === "none" && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setPanel("amend")}>
                Amend appointment
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={onToggle}>
                Close
              </Button>
            </div>
          )}
          {panel === "amend" && (
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
                  refresh();
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

function CustomerCallbackCard({
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
        setCustomerName((prev) => prev || name);
      }
      if (email) {
        setProfileEmail(email);
        setCustomerEmail((prev) => prev || email);
      }
      if (phone) {
        setCustomerPhone((prev) => prev || phone);
      }
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
    <>
      <OptionTile
        icon={<PhoneCall className="w-4 h-4" />}
        title="Arrange call back"
        subtitle="We'll ring you in a time window that suits."
        onClick={onToggle}
        active={expanded}
      />
      {expanded && (
        <div className="col-span-2 lg:col-span-3 rounded-2xl border bg-card p-4 space-y-3">
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
              {callbackWindow
                ? ` between ${CALLBACK_WINDOW_RANGES[callbackWindow]}`
                : ""}
              .
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Pick a window and leave a number we can reach you on.</p>
              <div className="grid gap-2">
                {CALLBACK_WINDOW_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer text-sm ${callbackWindow === opt.value ? "border-primary bg-primary/5" : ""}`}
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
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="home-cb-name">Full name</Label>
                  <Input id="home-cb-name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="home-cb-phone">Mobile number</Label>
                  <Input id="home-cb-phone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="home-cb-email">Email (optional)</Label>
                  <Input
                    id="home-cb-email"
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={!callbackWindow || !customerName.trim() || !customerPhone.trim() || callback.isPending}
                  onClick={() => callback.mutate()}
                >
                  {callback.isPending ? "Requesting…" : "Request call back"}
                </Button>
                <Button type="button" variant="ghost" onClick={onToggle}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function CustomerRafSelfServeCard({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
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

  const codeRow = activityQ.data?.codes?.[0] as
    | { code: string; tenantSlug?: string | null }
    | undefined;
  const code = codeRow?.code;
  const rafTenantSlug = codeRow?.tenantSlug ?? null;
  const referrals = activityQ.data?.referrals ?? [];

  return (
    <>
      <OptionTile
        icon={<Gift className="w-4 h-4" />}
        title="Refer a friend"
        subtitle="Share your link · £75 bonus"
        onClick={onToggle}
        active={expanded}
      />
      {expanded && (
        <div className="col-span-2 lg:col-span-3 rounded-2xl border bg-card p-4 space-y-3">
          {activityQ.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!activityQ.isLoading && !code && (
            <Button size="sm" onClick={() => ensure.mutate()} disabled={ensure.isPending}>
              {ensure.isPending ? "Creating…" : "Get my referral link"}
            </Button>
          )}
          {code && (
            <div className="space-y-3">
              <p className="text-xs font-mono break-all">{rafLinkForCode(code, rafTenantSlug, shareBase)}</p>
              <div className="flex flex-wrap gap-2">
                <CopyLinkButton value={rafShareMessage(null, code, rafTenantSlug, shareBase)} label="Copy share message" />
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
            <div className="rounded-xl border bg-muted/30 p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Your referrals</p>
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
    </>
  );
}

export function Home() {
  const navigate = useTenantAwareNavigate();
  const qc = useQueryClient();
  const roleFn = useServerFn(getMyRole);
  const sessionsFn = useServerFn(listMySessions);
  const casesFn = useServerFn(listMyCases);
  const createFn = useServerFn(createSession);


  const roleQ = useQuery({
    queryKey: ["my-role"],
    queryFn: async () => {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Account load timed out — please sign in again.")), 12000),
      );
      return Promise.race([roleFn(), timeout]);
    },
    retry: 1,
  });
  const isAdvisor = roleQ.data?.isAdvisor ?? false;
  const isMainAdmin = roleQ.data?.isMainAdmin ?? false;

  const introducerFn = useServerFn(checkIsIntroducer);
  const introducerQ = useQuery({
    queryKey: ["is-introducer"],
    queryFn: () => introducerFn(),
    enabled: !roleQ.isLoading && !isAdvisor && !isMainAdmin,
  });
  const isIntroducerOnly =
    !isAdvisor && !isMainAdmin && (introducerQ.data?.isIntroducer ?? false);

  const sessionsQ = useQuery({
    queryKey: ["my-sessions"],
    queryFn: () => sessionsFn(),
    enabled: !roleQ.isLoading && !isAdvisor,
  });

  const casesQ = useQuery({
    queryKey: ["my-cases"],
    queryFn: () => casesFn(),
    enabled: !roleQ.isLoading && !isAdvisor,
  });


  const create = useMutation({
    mutationFn: async (mode: "voice" | "chat") => ({ session: await createFn({ data: { mode } }), mode }),
    onSuccess: ({ session, mode }) =>
      navigate({
        to: mode === "chat" ? "/chat/$sessionId" : "/interview/$sessionId",
        params: { sessionId: session.id },
      }),
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Could not start interview — please try again.");
    },
  });

  const [homePanel, setHomePanel] = useState<"none" | "appointment" | "callback" | "raf">("none");
  const toggleHomePanel = (panel: "appointment" | "callback" | "raf") =>
    setHomePanel((current) => (current === panel ? "none" : panel));

  const brokerJourneyStarted = useRef(false);

  // RAF attribution: if a friend arrived via /raf/<code> a 'raf_ref' cookie is
  // set. On their first authenticated load we record the referral crediting the
  // referrer, then clear the cookie so it only fires once. Self-referral and
  // duplicate guards live server-side; failures are silent for the customer.
  const claimReferralFn = useServerFn(claimReferral);
  useEffect(() => {
    const code = getRafCode();
    if (!code) return;
    let cancelled = false;
    (async () => {
      try {
        await claimReferralFn({ data: { code } });
      } catch {
        // Non-fatal — never block the customer's dashboard on attribution.
      } finally {
        if (!cancelled) clearRafCookie();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [claimReferralFn]);

  // Brokerage site (MortgageEasy) → create account → open the journey they picked.
  useEffect(() => {
    if (roleQ.isLoading || isAdvisor || sessionsQ.isLoading || brokerJourneyStarted.current) return;

    const start = resolvePostAuthStart();
    if (!start) return;

    brokerJourneyStarted.current = true;
    clearPostAuthStart();

    const params = new URLSearchParams(window.location.search);
    if (params.has("start")) {
      params.delete("start");
      const qs = params.toString();
      window.history.replaceState({}, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
    }

    const sessions = sessionsQ.data ?? [];
    const inProgress = sessions.find((s) => s.status === "in_progress");

    if (start === "book") {
      void navigate({ to: "/booking" });
      return;
    }
    if (start === "chat") {
      if (inProgress) {
        void navigate({ to: "/chat/$sessionId", params: { sessionId: inProgress.id } });
      } else {
        create.mutate("chat");
      }
      return;
    }
    if (start === "voice") {
      if (inProgress) {
        void navigate({ to: "/interview/$sessionId", params: { sessionId: inProgress.id } });
      } else {
        create.mutate("voice");
      }
    }
  }, [roleQ.isLoading, isAdvisor, sessionsQ.isLoading, sessionsQ.data, navigate]);

  if (roleQ.isLoading) {
    return <AppShell title="Home"><div className="py-16 text-center text-muted-foreground">Loading…</div></AppShell>;
  }

  if (roleQ.isError) {
    return (
      <AppShell title="Home">
        <div className="py-16 text-center space-y-3 max-w-md mx-auto">
          <p className="text-muted-foreground">We couldn&apos;t load your account. Please sign in again.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => roleQ.refetch()}>Try again</Button>
            <Button
              variant="outline"
              onClick={() => {
                void supabase.auth.signOut({ scope: "local" }).finally(() => {
                  window.location.replace("/auth");
                });
              }}
            >
              Sign in
            </Button>
          </div>
        </div>
      </AppShell>
    );
  }

  if (!isAdvisor && sessionsQ.isLoading) {
    return <AppShell title="Home"><div className="py-16 text-center text-muted-foreground">Loading…</div></AppShell>;
  }

  if (!isAdvisor && sessionsQ.isError) {
    return (
      <AppShell title="Home">
        <div className="py-16 text-center space-y-3 max-w-md mx-auto">
          <p className="text-muted-foreground">We couldn&apos;t load your fact-finds.</p>
          <Button onClick={() => sessionsQ.refetch()}>Try again</Button>
        </div>
      </AppShell>
    );
  }

  if (isAdvisor || isMainAdmin) {
    return <StaffDashboardLoader />;
  }

  if (introducerQ.isLoading) {
    return <AppShell title="Home"><div className="py-16 text-center text-muted-foreground">Loading…</div></AppShell>;
  }

  if (isIntroducerOnly) {
    return <StaffDashboardLoader />;
  }

  const sessions = sessionsQ.data ?? [];
  const inProgress = sessions.find((s) => s.status === "in_progress");
  const hasSubmitted = sessions.some((s) => s.status === "submitted");
  const caseCount = casesQ.data?.length ?? 0;

  return (
    <AppShell title="Home">
      <CustomerHomeLanding
        inProgressId={inProgress?.id ?? null}
        hasSubmitted={hasSubmitted}
        caseCount={caseCount}
      />
    </AppShell>
  );
}
