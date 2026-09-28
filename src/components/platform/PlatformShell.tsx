import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getPublicAppEnvironment, stagingBannerLabel } from "@/lib/app-environment";
import { auditMyBreakGlassLogout, touchBreakGlassPlatformSession } from "@/lib/break-glass.functions";
import { getMyPlatformAuthority } from "@/lib/platform-authority.functions";
import { isPlatformNavActive, PLATFORM_NAV_ITEMS } from "@/lib/platform-dashboard";
import { PlatformAuthorityProvider, usePlatformAuthority } from "@/lib/platform-ui";
import { PRIVILEGED_MFA_SETUP_PATH } from "@/lib/privileged-mfa-flow";
import { getMyPrivilegedMfaStatus } from "@/lib/privileged-mfa-status.functions";
import { PrivilegedMfaPanel } from "@/components/platform/PrivilegedMfaPanel";
import { PrivilegedStepUpProvider } from "@/components/platform/PrivilegedStepUp";
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

function BreakGlassSessionExpired() {
  const navigate = useNavigate();
  const logoutAuditFn = useServerFn(auditMyBreakGlassLogout);

  useEffect(() => {
    void (async () => {
      try {
        const { endPlatformTenantEntry } = await import("@/lib/platform-tenant-entry.functions");
        await endPlatformTenantEntry();
      } catch {
        /* best effort */
      }
      try {
        await logoutAuditFn();
      } catch {
        /* logout must proceed */
      }
      await supabase.auth.signOut({ scope: "local" });
      void navigate({ to: "/auth", replace: true });
    })();
  }, [navigate, logoutAuditFn]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4 text-center text-sm text-muted-foreground">
      Break-glass session expired. Signing out…
    </div>
  );
}

/**
 * Enforce mode only: the BG platform session is not opened until a fresh authenticator
 * check. Offers the same TOTP check (no SMS / email / bypass) instead of signing out.
 */
function BreakGlassMfaRequired({ onVerified }: { onVerified: () => Promise<unknown> }) {
  const navigate = useNavigate();
  const logoutAuditFn = useServerFn(auditMyBreakGlassLogout);
  const [phase, setPhase] = useState<"verify" | "opening" | "failed">("verify");

  const signOut = () => {
    void (async () => {
      try {
        await logoutAuditFn();
      } catch {
        /* logout must proceed */
      }
      await supabase.auth.signOut({ scope: "local" });
      void navigate({ to: "/auth", replace: true });
    })();
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center space-y-4 px-4">
      <h1 className="text-2xl font-semibold">Break-glass verification required</h1>
      {phase === "failed" ? (
        <p className="text-sm text-destructive">
          The break-glass session could not be opened for this sign-in. Sign out and sign in again.
        </p>
      ) : phase === "opening" ? (
        <p className="text-sm text-muted-foreground">Opening break-glass session…</p>
      ) : (
        <PrivilegedMfaPanel
          purpose="step-up"
          stepUpReason="PRIVILEGED_REAUTH_REQUIRED"
          onSatisfied={() => {
            setPhase("opening");
            void onVerified().finally(() => setPhase("failed"));
          }}
        />
      )}
      <Button type="button" variant="outline" onClick={signOut} className="w-fit">
        Sign out
      </Button>
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
    refetchInterval: 60_000,
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

  if (authorityQ.data.isBreakGlass && !authorityQ.data.breakGlassSessionActive) {
    if (authorityQ.data.breakGlassMfaRequired === true) {
      return <BreakGlassMfaRequired onVerified={() => authorityQ.refetch()} />;
    }
    return <BreakGlassSessionExpired />;
  }

  return (
    <PlatformAuthorityProvider value={authorityQ.data}>{children}</PlatformAuthorityProvider>
  );
}

function platformEnvironmentLabel(): string | null {
  const env = getPublicAppEnvironment();
  if (env === "production") return null;
  const label = stagingBannerLabel() || "NON-PRODUCTION";
  return `${label} – TEST ENVIRONMENT`;
}

function BreakGlassPlatformBanner() {
  const authority = usePlatformAuthority();
  if (!authority.isBreakGlass) return null;
  return (
    <div
      role="status"
      className="border-b border-amber-800/30 bg-amber-50 px-4 py-2 text-amber-950 dark:border-amber-400/20 dark:bg-amber-950/40 dark:text-amber-50"
    >
      <div className="mx-auto max-w-6xl text-sm">
        <p className="font-semibold tracking-wide">BREAK-GLASS SESSION</p>
        <p className="text-xs sm:text-sm">
          Emergency administrative access. Sessions expire after 60 minutes (15 minutes idle).
          Company entry requires a reason and confirmation.
        </p>
      </div>
    </div>
  );
}

/**
 * Sends a privileged user to /platform/security only when the server reports enforce mode
 * and the verified session is not aal2. Disabled / audit modes never redirect or block.
 */
function PrivilegedMfaEnforcementRedirect({ pathname }: { pathname: string }) {
  const navigate = useNavigate();
  const statusFn = useServerFn(getMyPrivilegedMfaStatus);
  const statusQ = useQuery({
    queryKey: ["privileged-mfa-status"],
    queryFn: () => statusFn(),
    refetchInterval: 60_000,
  });
  const blocked = statusQ.data?.continuationBlocked === true;

  useEffect(() => {
    if (!blocked || pathname === PRIVILEGED_MFA_SETUP_PATH) return;
    void navigate({
      to: PRIVILEGED_MFA_SETUP_PATH,
      search: { redirect: pathname },
      replace: true,
    });
  }, [blocked, pathname, navigate]);

  return null;
}

export function PlatformShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const environmentLabel = platformEnvironmentLabel();
  const logoutAuditFn = useServerFn(auditMyBreakGlassLogout);
  const touchBgFn = useServerFn(touchBreakGlassPlatformSession);
  const authority = usePlatformAuthority();
  const prevPathRef = useRef<string | null>(null);

  // Meaningful in-app navigation only — skip mount/refresh (passive reload must not renew idle).
  useEffect(() => {
    if (!authority.isBreakGlass) {
      prevPathRef.current = pathname;
      return;
    }
    const prev = prevPathRef.current;
    prevPathRef.current = pathname;
    if (prev === null || prev === pathname) return;
    void touchBgFn().catch(() => {
      /* session check is authoritative via getMyPlatformAuthority */
    });
  }, [pathname, authority.isBreakGlass, touchBgFn]);

  const signOut = () => {
    void (async () => {
      try {
        const { endPlatformTenantEntry } = await import("@/lib/platform-tenant-entry.functions");
        await endPlatformTenantEntry();
      } catch {
        /* best effort */
      }
      try {
        await logoutAuditFn();
      } catch {
        /* never trap logout */
      }
      await supabase.auth.signOut({ scope: "local" });
      void navigate({ to: "/auth", replace: true });
    })();
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <BreakGlassPlatformBanner />
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
            <div className="flex gap-2">
              <Button asChild variant="ghost" size="sm" className="w-fit">
                <Link to={PRIVILEGED_MFA_SETUP_PATH}>Security</Link>
              </Button>
              <Button variant="outline" size="sm" type="button" onClick={signOut} className="w-fit">
                Sign out
              </Button>
            </div>
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
      <PrivilegedMfaEnforcementRedirect pathname={pathname} />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <PrivilegedStepUpProvider>{children}</PrivilegedStepUpProvider>
      </main>
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
