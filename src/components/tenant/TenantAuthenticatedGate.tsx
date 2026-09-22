import { type ReactNode, useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { checkTenantMembershipFn } from "@/lib/tenant-presentation.server";
import { resolveTenantAuthenticatedEntry } from "@/lib/tenant-access";
import { useRequiredTenantUi } from "@/lib/tenant-ui";
import { TenantPublicShell } from "@/components/tenant/TenantPublicShell";
import { PlatformAccessBanner } from "@/components/platform/PlatformAccessBanner";
import { Button } from "@/components/ui/button";
import { getMyPlatformTenantAccess } from "@/lib/platform-tenant-entry.functions";

/**
 * Session + server membership OR platform-entry gate for tenant-authenticated pages.
 * Slug identifies which firm was requested; membership or valid platform session is the grant.
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
  const platformAccessFn = useServerFn(getMyPlatformTenantAccess);
  const [state, setState] = useState<"checking" | "denied" | "ok">("checking");
  const [platformAccess, setPlatformAccess] = useState(false);

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
        let hasPlatform = false;
        if (!result.member) {
          const access = await platformAccessFn({ data: { tenantSlug: tenant.slug } });
          hasPlatform = Boolean(access);
        }
        const next = resolveTenantAuthenticatedEntry({
          userId,
          member: result.member,
          platformAccess: hasPlatform,
        });
        if (next === "denied") {
          setState("denied");
          return;
        }
        setPlatformAccess(hasPlatform && !result.member);
        setState("ok");
      } catch {
        setState("denied");
      }
    })();
  }, [tenant, navigate, platformAccessFn]);

  if (state === "denied") {
    return (
      <TenantPublicShell tenant={tenant}>
        <div className="mx-auto max-w-lg space-y-4 text-center">
          <h1 className="text-2xl font-semibold">Access denied</h1>
          <p className="text-sm text-muted-foreground">
            Your signed-in account is not a member of{" "}
            <strong>{tenant.tradingName || tenant.companyName}</strong>
            {" "}and has no active platform access session for this company.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild variant="outline">
              <Link to="/">Mortgage Hub home</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/platform">Platform</Link>
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
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        {checkingLabel}
      </div>
    );
  }

  return (
    <>
      {platformAccess ? <PlatformAccessBanner tenantSlug={tenant.slug} /> : null}
      {children}
    </>
  );
}
