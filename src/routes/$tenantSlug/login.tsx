import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { checkTenantMembershipFn } from "@/lib/tenant-presentation.server";
import { useRequiredTenantUi } from "@/lib/tenant-ui";
import { TenantPublicShell } from "@/components/tenant/TenantPublicShell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/$tenantSlug/login")({
  validateSearch: (search: Record<string, unknown>): {
    join?: boolean;
    start?: "voice" | "chat" | "book";
  } => ({
    join: search.join === true || search.join === "1" || search.join === 1 ? true : undefined,
    start:
      search.start === "voice" || search.start === "chat" || search.start === "book"
        ? (search.start as "voice" | "chat" | "book")
        : undefined,
  }),
  head: ({ match }) => {
    const tenant = match.context.tenant;
    const name = tenant?.tradingName || tenant?.companyName || "Firm";
    return {
      meta: [{ title: `Sign in — ${name} | Mortgage Hub` }],
    };
  },
  component: TenantLoginBridge,
});

function TenantLoginBridge() {
  const tenant = useRequiredTenantUi();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("tenant", tenant.slug);
    if (search.join) params.set("join", "1");
    if (search.start) params.set("start", search.start);

    void (async () => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user) {
        window.location.replace(`/auth?${params.toString()}`);
        return;
      }

      try {
        const result = await checkTenantMembershipFn({
          data: { slug: tenant.slug, userId: user.id },
        });
        if (!result.member) {
          setDenied(true);
          return;
        }
        void navigate({
          to: "/$tenantSlug/workspace",
          params: { tenantSlug: tenant.slug },
          replace: true,
        });
      } catch {
        setDenied(true);
      }
    })();
  }, [tenant, search.join, search.start, navigate]);

  return (
    <TenantPublicShell tenant={tenant}>
      <div className="mx-auto max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-semibold">
          {denied ? "Access denied" : "Checking access…"}
        </h1>
        {denied ? (
          <>
            <p className="text-sm text-muted-foreground">
              Your account is signed in but is not a member of{" "}
              <strong>{tenant.tradingName || tenant.companyName}</strong>.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild variant="outline">
                <Link to="/">Mortgage Hub</Link>
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  void supabase.auth.signOut().then(() => {
                    window.location.assign(`/auth?tenant=${encodeURIComponent(tenant.slug)}`);
                  });
                }}
              >
                Sign out and try again
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Opening the sign-in flow for {tenant.tradingName || tenant.companyName}…
          </p>
        )}
      </div>
    </TenantPublicShell>
  );
}
