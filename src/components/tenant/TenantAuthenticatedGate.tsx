import { type ReactNode, useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { checkTenantMembershipFn } from "@/lib/tenant-presentation.server";
import { resolveTenantAuthenticatedEntry } from "@/lib/tenant-access";
import { useRequiredTenantUi } from "@/lib/tenant-ui";
import { TenantPublicShell } from "@/components/tenant/TenantPublicShell";
import { Button } from "@/components/ui/button";

/**
 * Session + server membership gate for tenant-authenticated pages.
 * Slug identifies which firm was requested; membership is the grant.
 */
export function TenantAuthenticatedGate({
  children,
  checkingLabel = "Verifying firm membership…",
}: {
  children: ReactNode;
  checkingLabel?: string;
}) {
  const tenant = useRequiredTenantUi();
  const navigate = useNavigate();
  const [state, setState] = useState<"checking" | "denied" | "ok">("checking");

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id ?? null;
      if (!userId) {
        void navigate({
          to: "/$tenantSlug/login",
          params: { tenantSlug: tenant.slug },
          replace: true,
        });
        return;
      }
      try {
        const result = await checkTenantMembershipFn({
          data: { slug: tenant.slug, userId },
        });
        const next = resolveTenantAuthenticatedEntry({ userId, member: result.member });
        if (next === "denied") {
          setState("denied");
          return;
        }
        setState("ok");
      } catch {
        setState("denied");
      }
    })();
  }, [tenant, navigate]);

  if (state === "denied") {
    return (
      <TenantPublicShell tenant={tenant}>
        <div className="mx-auto max-w-lg space-y-4 text-center">
          <h1 className="text-2xl font-semibold">Access denied</h1>
          <p className="text-sm text-muted-foreground">
            Your signed-in account is not a member of{" "}
            <strong>{tenant.tradingName || tenant.companyName}</strong>. Tenant routes identify
            which firm you requested — they do not override membership or database security.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild variant="outline">
              <Link to="/">Mortgage Hub home</Link>
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                void supabase.auth.signOut().then(() => {
                  void navigate({
                    to: "/$tenantSlug/login",
                    params: { tenantSlug: tenant.slug },
                  });
                });
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </TenantPublicShell>
    );
  }

  if (state !== "ok") {
    return (
      <TenantPublicShell tenant={tenant}>
        <p className="text-center text-sm text-muted-foreground">{checkingLabel}</p>
      </TenantPublicShell>
    );
  }

  return <>{children}</>;
}
