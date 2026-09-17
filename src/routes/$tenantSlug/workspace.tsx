import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { checkTenantMembershipFn } from "@/lib/tenant-presentation.server";
import { useRequiredTenantUi } from "@/lib/tenant-ui";
import { TenantPublicShell } from "@/components/tenant/TenantPublicShell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/$tenantSlug/workspace")({
  head: ({ match }) => {
    const tenant = match.context.tenant;
    return {
      meta: [
        {
          title: tenant
            ? `${tenant.tradingName || tenant.companyName} workspace | Mortgage Hub`
            : "Workspace | Mortgage Hub",
        },
      ],
    };
  },
  component: TenantWorkspaceGate,
});

/**
 * Membership-gated entry for a tenant workspace.
 * UI convenience may remember slug in sessionStorage; authority is re-checked here + RLS.
 */
function TenantWorkspaceGate() {
  const tenant = useRequiredTenantUi();
  const navigate = useNavigate();
  const [state, setState] = useState<"checking" | "denied" | "ok">("checking");

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user) {
        void navigate({
          to: "/$tenantSlug/login",
          params: { tenantSlug: tenant.slug },
          replace: true,
        });
        return;
      }
      try {
        const result = await checkTenantMembershipFn({
          data: { slug: tenant.slug, userId: user.id },
        });
        if (!result.member) {
          setState("denied");
          return;
        }
        try {
          sessionStorage.setItem("mh:ui-tenant-slug", tenant.slug);
          sessionStorage.setItem("mh:ui-tenant-id", tenant.tenantId);
        } catch {
          /* ignore */
        }
        setState("ok");
        void navigate({ to: "/home", replace: true });
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

  return (
    <TenantPublicShell tenant={tenant}>
      <p className="text-center text-sm text-muted-foreground">Verifying firm membership…</p>
    </TenantPublicShell>
  );
}
