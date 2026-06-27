import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { setRafCookie } from "@/lib/referral";
import { resolveReferralCode } from "@/lib/referrals.functions";

export const Route = createFileRoute("/raf/$code")({
  component: ReferAFriendRedirect,
});

function ReferAFriendRedirect() {
  const { code } = Route.useParams();
  const navigate = useNavigate();
  const resolveFn = useServerFn(resolveReferralCode);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const link = await resolveFn({ data: { code } });
        if (cancelled) return;
        if (!link) {
          setError("This referral link is not valid or has expired.");
          return;
        }
        // Set the RAF cookie (separate from the introducer cookie) so the
        // referring customer is credited when this friend signs up. Then send
        // them to the public landing page to self-serve (verbal/text/book).
        setRafCookie(link.code);
        navigate({ to: "/" });
      } catch {
        if (!cancelled) setError("Something went wrong. Please try again later.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, resolveFn, navigate]);

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
      <p className="text-sm text-muted-foreground">Taking you to Mortgage Hub…</p>
    </div>
  );
}
