import { type ReactNode, useEffect, useState } from "react";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getPublicAppEnvironment, stagingBannerLabel } from "@/lib/app-environment";
import { getMyPlatformAuthority } from "@/lib/platform-authority.server";
import { isPlatformNavActive, PLATFORM_NAV_ITEMS } from "@/lib/platform-dashboard";
import { PlatformAuthorityProvider } from "@/lib/platform-ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function PlatformDenied() {
  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center space-y-4 px-4 text-center">
      <h1 className="text-2xl font-semibold">Access denied</h1>
      <p className="text-sm text-muted-foreground">
        Mortgage Hub platform administration requires a platform role. Tenant Owner, Supervisor,
        and global admin roles are not platform authority.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild variant="outline">
          <Link to="/">Mortgage Hub home</Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * Session + platform_roles gate. Does not use tenant membership.
 * Independent of the tenant authenticated membership gate.
 */
export function PlatformAuthenticatedGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const authorityFn = useServerFn(getMyPlatformAuthority);
  const [sessionUserId, setSessionUserId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id ?? null;
      if (!userId) {
        void navigate({ to: "/auth", replace: true });
        return;
      }
      setSessionUserId(userId);
    })();
  }, [navigate]);

  const authorityQ = useQuery({
    queryKey: ["platform-authority", sessionUserId],
    queryFn: () => authorityFn(),
    enabled: Boolean(sessionUserId),
  });

  if (sessionUserId === undefined || (sessionUserId && authorityQ.isLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Checking platform authority…
      </div>
    );
  }

  if (!sessionUserId) {
    return null;
  }

  if (authorityQ.isError || !authorityQ.data?.canAccessPlatform) {
    return <PlatformDenied />;
  }

  return (
    <PlatformAuthorityProvider value={authorityQ.data}>
      {children}
    </PlatformAuthorityProvider>
  );
}

function platformEnvironmentLabel(): string | null {
  const env = getPublicAppEnvironment();
  if (env === "production") return null;
  const label = stagingBannerLabel() || "NON-PRODUCTION";
  return `${label} – TEST ENVIRONMENT`;
}

export function PlatformShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const environmentLabel = platformEnvironmentLabel();

  const signOut = () => {
    void supabase.auth.signOut({ scope: "local" }).finally(() => {
      void navigate({ to: "/auth", replace: true });
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <header className="border-b border-slate-300 bg-slate-100 dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Mortgage Hub
              </p>
              <h1 className="text-lg font-semibold">Platform Administration</h1>
              {environmentLabel ? (
                <p className="mt-1 text-xs font-semibold tracking-wide text-amber-800 dark:text-amber-400">
                  {environmentLabel}
                </p>
              ) : null}
            </div>
            <Button variant="outline" size="sm" type="button" onClick={signOut} className="w-fit">
              Sign out
            </Button>
          </div>
          <nav className="flex flex-wrap gap-2" aria-label="Platform">
            {PLATFORM_NAV_ITEMS.map((item) => {
              const active = isPlatformNavActive(pathname, item.id);
              return (
                <Link
                  key={item.id}
                  to={item.to}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium",
                    active
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                      : "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700 dark:hover:bg-slate-700",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}

export function PlatformLayout() {
  return (
    <PlatformAuthenticatedGate>
      <PlatformShell>
        <Outlet />
      </PlatformShell>
    </PlatformAuthenticatedGate>
  );
}
