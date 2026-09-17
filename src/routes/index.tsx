import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  goToPasswordRecoveryPage,
  isPasswordRecoveryPending,
  isPasswordRecoveryUrl,
  shouldBlockAuthenticatedApp,
} from "@/lib/auth-recovery";
import { Button } from "@/components/ui/button";
import { listActiveTenantSummariesFn } from "@/lib/tenant-presentation.server";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Mortgage Hub" },
      {
        name: "description",
        content: "Mortgage Hub — multi-firm mortgage advice platform.",
      },
    ],
  }),
  loader: async () => {
    try {
      const firms = await listActiveTenantSummariesFn();
      return { firms };
    } catch {
      return { firms: [] as Array<{ slug: string; companyName: string; companyCode: string }> };
    }
  },
  component: PlatformRoot,
});

/**
 * Gate G4 platform root.
 * This is Mortgage Hub — not Mortgage Easy.
 * Does not redirect to 001.
 */
function PlatformRoot() {
  const navigate = useNavigate();
  const { firms } = Route.useLoaderData();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    if (isPasswordRecoveryUrl()) {
      goToPasswordRecoveryPage();
      return;
    }
    if (isPasswordRecoveryPending() || shouldBlockAuthenticatedApp()) {
      window.location.replace("/auth/reset");
      return;
    }

    void supabase.auth.getSession().then(({ data }) => {
      setSignedIn(Boolean(data.session));
    });
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <a href="/" className="flex items-center gap-2 font-semibold text-foreground no-underline">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
            MH
          </span>
          Mortgage Hub
        </a>
        <div className="flex items-center gap-2">
          {signedIn ? (
            <Button variant="ghost" onClick={() => void navigate({ to: "/home" })}>
              Open workspace
            </Button>
          ) : (
            <a href="/auth">
              <Button variant="ghost">Platform sign in</Button>
            </a>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-12 px-6 pb-24 pt-10">
        <section className="max-w-2xl space-y-4">
          <p className="text-sm font-medium text-muted-foreground">Platform</p>
          <h1 className="text-4xl font-semibold tracking-tight text-foreground md:text-5xl">
            Mortgage Hub
          </h1>
          <p className="text-lg text-muted-foreground">
            One application for multiple advice firms. Choose your firm below to open its branded
            workspace. Access to firm data still requires membership — a URL never grants
            authority.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-lg font-semibold text-foreground">Firms on this platform</h2>
          {firms.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active firms are listed right now.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {firms.map((f) => (
                <li key={f.slug}>
                  <Link
                    to="/$tenantSlug"
                    params={{ tenantSlug: f.slug }}
                    className="block rounded-xl border bg-card p-5 text-foreground no-underline transition hover:border-primary/40 hover:shadow-sm"
                  >
                    <p className="font-semibold">{f.companyName}</p>
                    <p className="mt-1 text-xs text-muted-foreground">/{f.slug}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
