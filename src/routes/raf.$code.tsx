import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { setRafCookie, rafShareDescription } from "@/lib/referral";
import { resolveReferralCode, resolveReferralCodeMeta } from "@/lib/referrals.functions";
import { Button } from "@/components/ui/button";
import { Gift, CalendarCheck, MessageSquare, Mic, ShieldCheck } from "lucide-react";
import avatarImg from "@/assets/susan.png";

function rafShareUrl(code: string): string {
  const base =
    (typeof process !== "undefined" && (process.env.APP_BASE_URL || process.env.VITE_APP_URL)) ||
    (typeof window !== "undefined" ? window.location.origin : "http://localhost:8080");
  return `${String(base).replace(/\/$/, "")}/raf/${code}`;
}

export const Route = createFileRoute("/raf/$code")({
  loader: async ({ params }) => {
    const meta = await resolveReferralCodeMeta(params.code);
    return { meta, shareUrl: rafShareUrl(params.code) };
  },
  head: ({ loaderData, params }) => {
    const referrerName = loaderData?.meta?.referrer_name ?? null;
    const title = referrerName
      ? `${referrerName} invited you — Mortgage Hub`
      : "A friend invited you — Mortgage Hub";
    const description = rafShareDescription(referrerName);
    const url = loaderData?.shareUrl ?? rafShareUrl(params.code);
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
      ],
    };
  },
  component: ReferAFriendLanding,
});

function ReferAFriendLanding() {
  const { code } = Route.useParams();
  const loaderData = Route.useLoaderData();
  const navigate = useNavigate();
  const resolveFn = useServerFn(resolveReferralCode);
  const [referrerName, setReferrerName] = useState<string | null>(
    loaderData?.meta?.referrer_name ?? null,
  );
  const [ready, setReady] = useState(!!loaderData?.meta);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) navigate({ to: "/home" });
    });

    if (loaderData?.meta) return;

    (async () => {
      try {
        const link = await resolveFn({ data: { code } });
        if (cancelled) return;
        if (link) {
          setRafCookie(link.code);
          setReferrerName(link.referrer_name ?? null);
        }
      } catch {
        // Network/server hiccup — still show the welcoming page.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, resolveFn, navigate, loaderData]);

  if (!ready) return <div className="min-h-screen bg-background" />;

  const headline = referrerName
    ? `${referrerName} has invited you to Mortgage Hub`
    : "A friend has invited you to Mortgage Hub";

  return (
    <div className="min-h-screen bg-background">
      <header className="px-6 py-5 flex items-center justify-between max-w-6xl mx-auto">
        <div className="flex items-center gap-2 font-semibold">
          <span className="inline-block w-7 h-7 rounded-full bg-accent" />
          Mortgage Hub
        </div>
        <Link to="/auth" search={{ recovery: false }}>
          <Button variant="ghost">Sign in</Button>
        </Link>
      </header>

      <main className="max-w-6xl mx-auto px-6 pt-10 pb-24 space-y-16">
        <section className="grid md:grid-cols-2 gap-12 items-center">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-sm text-muted-foreground">
              <Gift className="w-3.5 h-3.5 text-accent" />
              A friend invited you
            </div>
            <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-foreground leading-[1.1]">
              {headline}
            </h1>
            <p className="text-lg text-muted-foreground">
              They&apos;ve sent you this link so you can get the same friendly, guided start they
              did. Mortgage Hub helps you answer the questions a mortgage advisor needs — at your
              own pace — and hands them a clean summary so your first conversation is faster and
              easier.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link to="/auth" search={{ recovery: false }}>
                <Button size="lg">Start your mortgage journey</Button>
              </Link>
              <Link to="/auth" search={{ recovery: false }}>
                <Button size="lg" variant="outline">
                  I already have an account
                </Button>
              </Link>
            </div>
            <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <ShieldCheck className="w-4 h-4 text-accent" />
              Free to start · your details stay private until you&apos;re ready.
            </p>
          </div>

          <div className="flex items-center justify-center">
            <div className="rounded-3xl bg-card border shadow-sm p-8">
              <img
                src={avatarImg}
                alt="Susan, your Mortgage Hub interview guide"
                width={320}
                height={320}
                className="w-80 h-80 rounded-full object-cover object-top"
              />
              <p className="mt-4 text-center text-sm text-muted-foreground">
                Susan can speak each question aloud — or chat by text.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-1">What you can do</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Pick whatever feels most comfortable — you choose after you sign up.
          </p>
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="rounded-2xl border bg-card p-5">
              <Mic className="w-7 h-7 mb-3 text-accent" />
              <h3 className="font-semibold">Verbal interview</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Talk through your details with Susan, our avatar-led spoken assistant.
              </p>
            </div>
            <div className="rounded-2xl border bg-card p-5">
              <MessageSquare className="w-7 h-7 mb-3 text-accent" />
              <h3 className="font-semibold">Text interview</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Prefer to type? Answer the same questions in a quiet, typed chat.
              </p>
            </div>
            <div className="rounded-2xl border bg-card p-5">
              <CalendarCheck className="w-7 h-7 mb-3 text-accent" />
              <h3 className="font-semibold">Book an appointment</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Skip ahead and pick a time to speak with a mortgage advisor.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
