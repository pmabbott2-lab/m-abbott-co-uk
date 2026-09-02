import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { listMySessions, createSession, getMyRole, listMyCases } from "@/lib/sessions.functions";
import { claimReferral, listMyReferralActivity, ensureMyReferralLink, getPublicShareBaseUrl } from "@/lib/referrals.functions";
import { getRafCode, clearRafCookie, rafLinkForCode, rafShareMessage } from "@/lib/referral";
import { checkIsIntroducer } from "@/lib/introducer.functions";
import { clearPostAuthStart, resolvePostAuthStart } from "@/lib/post-auth-journey";
import { StaffDashboardLoader } from "@/components/staff/StaffDashboard";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Mic, MessageSquare, FileText, ArrowRight, CalendarCheck, PhoneCall, Gift, Copy, Check } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PostCompletionBooking, CALLBACK_WINDOW_RANGES } from "@/components/PostCompletionBooking";
import { getSessionBooking } from "@/lib/booking.functions";

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

function CustomerAppointmentCard() {
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
      <div className="rounded-2xl border p-5 text-sm text-muted-foreground">
        Loading appointment…
      </div>
    );
  }

  if (!upcoming?.appointment) {
    return (
      <Link
        to="/booking"
        className="group text-left rounded-2xl border p-5 hover:border-primary hover:bg-muted/40 transition block"
      >
        <div className="flex items-center gap-3">
          <span className="inline-flex w-11 h-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CalendarCheck className="w-5 h-5" />
          </span>
          <div>
            <div className="font-semibold flex items-center gap-1">
              Book an appointment
              <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition" />
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Pick a time to speak with your advisor.
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
    <div className="rounded-2xl border bg-card p-5 space-y-4 sm:col-span-2 lg:col-span-3">
      <div className="flex items-start gap-3">
        <span className="inline-flex w-11 h-11 items-center justify-center rounded-full bg-primary/10 text-primary shrink-0">
          <CalendarCheck className="w-5 h-5" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold">Your appointment</div>
          {panel === "none" && (
            <>
              <dl className="mt-2 grid sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Date &amp; time</dt>
                  <dd className="font-medium">
                    {format(new Date(appt.startsAt), "EEE d MMM yyyy, HH:mm")}
                  </dd>
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
                <p className="text-xs text-primary mt-2 inline-flex items-center gap-1">
                  <PhoneCall className="w-3 h-3" />
                  Call-back requested ·{" "}
                  {CALLBACK_WINDOW_RANGES[callback.preferredWindow as "9-12" | "12-4" | "4-8"] ??
                    callback.preferredWindow}
                </p>
              )}
              <div className="flex flex-wrap gap-2 mt-3">
                <Button type="button" size="sm" variant="outline" onClick={() => setPanel("amend")}>
                  Amend appointment
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setPanel("callback")}>
                  <PhoneCall className="w-4 h-4 mr-1.5" />
                  Request a call back
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

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

      {panel === "callback" && (
        <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-medium text-sm">When should we call you?</h4>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPanel("none")}>
              Cancel
            </Button>
          </div>
          <PostCompletionBooking
            sessionId={upcoming.id}
            channel="text"
            defaultName={profileName}
            defaultEmail={profileEmail}
            initialMode="callback"
            hideModeToggle
            compact
            onComplete={() => {
              refresh();
              toast.success("Call-back requested");
            }}
          />
        </div>
      )}
    </div>
  );
}

function CustomerRafSelfServeCard() {
  const qc = useQueryClient();
  const activityFn = useServerFn(listMyReferralActivity);
  const ensureFn = useServerFn(ensureMyReferralLink);
  const publicUrlFn = useServerFn(getPublicShareBaseUrl);

  const activityQ = useQuery({ queryKey: ["my-raf-activity"], queryFn: () => activityFn() });
  const publicUrlQ = useQuery({ queryKey: ["public-share-url"], queryFn: () => publicUrlFn() });
  const shareBase = publicUrlQ.data?.baseUrl;

  const ensure = useMutation({
    mutationFn: () => ensureFn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-raf-activity"] }),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not create link"),
  });

  const code = activityQ.data?.codes?.[0]?.code;
  const referrals = activityQ.data?.referrals ?? [];

  return (
    <div className="rounded-2xl border bg-card p-5 space-y-4 sm:col-span-2 lg:col-span-1">
      <div className="flex items-center gap-3">
        <span className="inline-flex w-11 h-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Gift className="w-5 h-5" />
        </span>
        <div>
          <div className="font-semibold">Refer a friend</div>
          <div className="text-xs text-muted-foreground">Share your link and track referrals · £75 bonus</div>
        </div>
      </div>
      {activityQ.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!activityQ.isLoading && !code && (
        <Button size="sm" onClick={() => ensure.mutate()} disabled={ensure.isPending}>
          {ensure.isPending ? "Creating…" : "Get my referral link"}
        </Button>
      )}
      {code && (
        <div className="space-y-2">
          <p className="text-xs font-mono break-all">{rafLinkForCode(code, shareBase)}</p>
          <CopyLinkButton value={rafShareMessage(null, code, shareBase)} label="Copy share message" />
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
  );
}

function Home() {
  const navigate = useNavigate();
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
  const hasCases = (casesQ.data ?? []).length > 0;
  const caseCount = casesQ.data?.length ?? 0;

  return (
    <AppShell title="Your fact-finds">
      <div className="rounded-3xl bg-card border p-6 sm:p-8 mb-6">
        <div>
          <h2 className="text-2xl font-semibold">
            {inProgress ? "Continue your fact-find" : "Start a new fact-find"}
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            {inProgress
              ? "Pick up where you left off with Susan. You can switch between talking and typing any time."
              : hasSubmitted
                ? "You can start a fresh fact-find any time — useful if your details have changed. Choose how you'd like to answer."
                : "Choose how you'd like to answer Susan's questions. It takes around 5–10 minutes."}
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-5">
          <button
            type="button"
            disabled={create.isPending}
            onClick={() =>
              inProgress
                ? navigate({ to: "/interview/$sessionId", params: { sessionId: inProgress.id } })
                : create.mutate("voice")
            }
            className="group text-left rounded-2xl border p-5 hover:border-primary hover:bg-muted/40 transition disabled:opacity-60"
          >
            <div className="flex items-center gap-3">
              <span className="inline-flex w-11 h-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Mic className="w-5 h-5" />
              </span>
              <div>
                <div className="font-semibold flex items-center gap-1">
                  {inProgress ? "Continue talking" : "Talk to a spoken assistant"}
                  <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition" />
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {create.isPending && create.variables === "voice"
                    ? "Starting…"
                    : "Susan speaks each question and listens to your voice."}
                </div>
              </div>
            </div>
          </button>
          <button
            type="button"
            disabled={create.isPending}
            onClick={() =>
              inProgress
                ? navigate({ to: "/chat/$sessionId", params: { sessionId: inProgress.id } })
                : create.mutate("chat")
            }
            className="group text-left rounded-2xl border p-5 hover:border-primary hover:bg-muted/40 transition disabled:opacity-60"
          >
            <div className="flex items-center gap-3">
              <span className="inline-flex w-11 h-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                <MessageSquare className="w-5 h-5" />
              </span>
              <div>
                <div className="font-semibold flex items-center gap-1">
                  {inProgress ? "Continue typing" : "Type to a chat assistant"}
                  <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition" />
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {create.isPending && create.variables === "chat"
                    ? "Starting…"
                    : "Answer in a quiet, typed chat — no microphone needed."}
                </div>
              </div>
            </div>
          </button>
          <CustomerAppointmentCard />
          {hasCases && (
            <>
              <Link
                to="/cases"
                className="group text-left rounded-2xl border p-5 hover:border-primary hover:bg-muted/40 transition block"
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex w-11 h-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <FileText className="w-5 h-5" />
                  </span>
                  <div>
                    <div className="font-semibold flex items-center gap-1">
                      Your summary
                      <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition" />
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Journey progress, next steps, and your cases ({caseCount}).
                    </div>
                  </div>
                </div>
              </Link>
              <CustomerRafSelfServeCard />
            </>
          )}
        </div>
      </div>
      {inProgress && hasCases && (
        <p className="text-sm text-muted-foreground mb-4">
          You have a fact-find in progress — use Talk or Type above to continue, or open{" "}
          <Link to="/cases" className="text-primary underline-offset-2 hover:underline">
            Your summary
          </Link>{" "}
          for journey and booking details.
        </p>
      )}
      {inProgress && !hasCases && (
        <p className="text-sm text-muted-foreground mb-4">
          You have a fact-find in progress — use Talk or Type above to continue.
        </p>
      )}
    </AppShell>
  );
}
