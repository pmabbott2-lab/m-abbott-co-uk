import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { setReferralCookie } from "@/lib/referral";
import { resolveReferralSlug } from "@/lib/introducer.functions";

export const Route = createFileRoute("/go/$slug")({
  component: ReferralRedirect,
});

function ReferralRedirect() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const resolveFn = useServerFn(resolveReferralSlug);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const introducer = await resolveFn({ data: { slug } });
        if (cancelled) return;
        if (!introducer) {
          setError("This referral link is not valid or has expired.");
          return;
        }
        setReferralCookie(introducer.slug);
        navigate({ to: "/book/$slug", params: { slug: introducer.slug } });
      } catch {
        if (!cancelled) setError("Something went wrong. Please try again later.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, resolveFn, navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-xl font-semibold">Link not found</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <p className="text-sm text-muted-foreground">Taking you to FactFind…</p>
    </div>
  );
}
