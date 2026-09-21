import { type ReactNode, useEffect, useState } from "react";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getMyPlatformAuthority } from "@/lib/platform-authority.server";
import { PlatformAuthorityProvider } from "@/lib/platform-ui";
import { Button } from "@/components/ui/button";

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

export function PlatformShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Mortgage Hub</p>
            <h1 className="text-lg font-semibold">Platform Administration</h1>
          </div>
          <nav className="flex items-center gap-3 text-sm">
            <Link to="/platform" className="text-foreground underline-offset-4 hover:underline">
              Home
            </Link>
            <Link
              to="/platform/tenants"
              className="text-foreground underline-offset-4 hover:underline"
            >
              Create company
            </Link>
            <Link to="/" className="text-muted-foreground underline-offset-4 hover:underline">
              Hub home
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
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
