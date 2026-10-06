import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { setRafCookie, rafShareDescription } from "@/lib/referral";
import { resolveReferralCodeTenantSlug } from "@/lib/referrals.functions";
import { Button } from "@/components/ui/button";
import { Gift, CalendarCheck, MessageSquare, Mic, ShieldCheck } from "lucide-react";
import avatarImg from "@/assets/susan.png";
import { useTenantUi } from "@/lib/tenant-ui";
import { buildAuthNavigateSearch } from "@/lib/post-auth-journey";
import { tryBuildCanonicalRafUrl } from "@/lib/tenant-url";

function rafShareUrl(code: string, tenantSlug?: string | null): string {
  const base =
    (typeof process !== "undefined" && (process.env.APP_BASE_URL || process.env.VITE_APP_URL)) ||
    (typeof window !== "undefined" ? window.location.origin : "http://localhost:8080");
  const origin = String(base).replace(/\/$/, "");
  const canonical = tryBuildCanonicalRafUrl(tenantSlug, code, origin);
  if (canonical) return canonical;
  return `${origin}/raf/${code}`;
}

export const Route = createFileRoute("/raf/$code")({
  loader: async ({ params }) => {
    // B2a: the bare /raf/<code> route resolves ONLY the code's owning tenant (to bootstrap-redirect
    // into it). The referrer identity is never fetched or rendered here — it is disclosed only on
    // the tenant-validated /$tenantSlug/raf/<code> route.
    const { tenantSlug } = await resolveReferralCodeTenantSlug(params.code);
    return { tenantSlug, shareUrl: rafShareUrl(params.code, tenantSlug) };
  },
  head: ({ loaderData, params }) => {
    // No referrer name in metadata before tenant validation.
    const title = "A friend invited you — Mortgage Hub";
    const description = rafShareDescription(null);
    const url = loaderData?.shareUrl ?? rafShareUrl(params.code, loaderData?.tenantSlug ?? null);
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
  const tenantSlug = loaderData?.tenantSlug ?? null;

  useEffect(() => {
    if (!tenantSlug) return;
    void navigate({
      to: "/$tenantSlug/raf/$code",
      params: { tenantSlug, code },
    } as never);
  }, [tenantSlug, code, navigate]);

  if (tenantSlug) {
    return <div className="min-h-screen bg-background" />;
  }

  return <RafLanding code={code} initialMeta={null} />;
}

export function RafLanding({
  code,
  initialMeta,
}: {
  code: string;
  initialMeta: {
    referrer_name: string | null;
    tenantSlug: string | null;
  } | null;
}) {
  const navigate = useNavigate();
  const tenantUi = useTenantUi();
  // B2a: the referrer name is only ever shown from server-validated, tenant-scoped loader data
  // (initialMeta, supplied exclusively by the tenant-prefixed route). The bare route passes
  // initialMeta=null and never fetches identity client-side, so no referrer name is disclosed
  // before tenant validation.
  const referrerName = initialMeta?.referrer_name ?? null;
  const tenantSlug = initialMeta?.tenantSlug ?? tenantUi?.slug ?? null;

  useEffect(() => {
    // Record the RAF code in the untrusted 'raf_ref' cookie; it is corroborating context only and
    // carries no tenant authority (claimReferral resolves the authoritative tenant on claim).
    if (code) setRafCookie(code);
  }, [code]);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled || !data.session) return;
      if (tenantSlug) {
        void navigate({
          to: "/$tenantSlug/workspace",
          params: { tenantSlug },
        } as never);
        return;
      }
      void navigate({ to: "/home" });
    });
    return () => {
      cancelled = true;
    };
  }, [tenantSlug, navigate]);

  const firmLabel = tenantUi?.tradingName || tenantUi?.companyName || "Mortgage Hub";
  const authSearch = buildAuthNavigateSearch({ tenantSlug });
  const headline = referrerName
    ? `${referrerName} has invited you to ${firmLabel}`
    : `A friend has invited you to ${firmLabel}`;

  return (
    <div className="min-h-screen bg-background">
      <header className="px-6 py-5 flex items-center justify-between max-w-6xl mx-auto">
        <div className="flex items-center gap-2 font-semibold">
          <span className="inline-block w-7 h-7 rounded-full bg-accent" />
          {firmLabel}
        </div>
        <Link to="/auth" search={authSearch}>
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
              <Link to="/auth" search={authSearch}>
                <Button size="lg">Start your mortgage journey</Button>
              </Link>
              <Link to="/auth" search={authSearch}>
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
