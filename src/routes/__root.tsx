import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { type ReactNode } from "react";

import "../styles.css";
import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import { ThemeInit } from "@/components/ThemeInit";
import { StagingBanner } from "@/components/StagingBanner";
import { supabase } from "@/integrations/supabase/client";
import { getPublicEnvInlineScript } from "@/lib/supabase-public-env";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  const clearSessionAndGoAuth = () => {
    void supabase.auth.signOut({ scope: "local" }).finally(() => {
      window.location.replace("/auth");
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. Try again, or sign in again if the dashboard keeps failing.
        </p>
        {error?.message?.includes("Invalid server action param") && (
          <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
            Your browser may have an older version of the app cached. Hard refresh the page (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows) and try again.
          </p>
        )}
        {error?.message && (
          <p className="mt-3 rounded-md border bg-muted/40 px-3 py-2 text-left text-xs font-mono text-muted-foreground break-all">
            {error.message}
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={clearSessionAndGoAuth}
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={clearSessionAndGoAuth}
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Mortgage Hub" },
      { name: "description", content: "Advisor Ally is a mobile app that collects initial customer information through an avatar-led verbal interview." },
      { property: "og:title", content: "Mortgage Hub" },
      { property: "og:description", content: "Advisor Ally is a mobile app that collects initial customer information through an avatar-led verbal interview." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Mortgage Hub" },
      { name: "twitter:description", content: "Advisor Ally is a mobile app that collects initial customer information through an avatar-led verbal interview." },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: getPublicEnvInlineScript(),
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var k="mortgage-hub:theme-profile";var t=localStorage.getItem(k);var d=t||"classic-hub";document.documentElement.setAttribute("data-theme",d);}catch(e){document.documentElement.setAttribute("data-theme","classic-hub");}})();`,
          }}
        />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeInit />
      <StagingBanner />
      <Outlet />
      <Toaster position="top-center" richColors closeButton />
    </QueryClientProvider>
  );
}
