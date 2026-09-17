import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useTenantUi } from "@/lib/tenant-ui";

export function AppShell({
  title,
  children,
  action,
  backTo,
  backParams,
  backLabel = "Back",
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  backTo?: string;
  backParams?: Record<string, string>;
  backLabel?: string;
}) {
  const navigate = useNavigate();
  const tenant = useTenantUi();
  const companyWebsite = tenant?.websiteUrl?.trim() || null;
  const companyLabel = tenant?.tradingName || tenant?.companyName || null;
  const signOut = async () => {
    await supabase.auth.signOut();
    try {
      sessionStorage.removeItem("mh:ui-tenant-slug");
      sessionStorage.removeItem("mh:ui-tenant-id");
    } catch {
      /* ignore */
    }
    navigate({ to: "/auth", replace: true });
  };
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-2.5 sm:py-3 flex items-center justify-between gap-2">
          <Link to="/home" className="flex items-center gap-2 font-semibold shrink-0">
            <span className="inline-flex w-7 h-7 items-center justify-center rounded-lg bg-primary text-primary-foreground text-xs font-bold shadow-sm">
              MH
            </span>
            <span className="hidden sm:inline">
              {companyLabel ? (
                <>
                  <span className="text-foreground">{companyLabel}</span>
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">via Mortgage Hub</span>
                </>
              ) : (
                "Mortgage Hub"
              )}
            </span>
          </Link>
          <h1 className="text-sm font-medium text-muted-foreground hidden sm:block min-w-0 truncate">{title}</h1>
          <div className="flex items-center justify-end gap-1 sm:gap-2 min-w-0">
            {action}
            {companyWebsite ? (
              <Button variant="ghost" size="sm" className="shrink-0 px-2 sm:px-3" asChild>
                <a href={companyWebsite} rel="noopener noreferrer">
                  <ExternalLink className="w-4 h-4 sm:mr-1.5" />
                  <span className="hidden sm:inline">Company website</span>
                </a>
              </Button>
            ) : null}
            {backTo && (
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() => {
                  if (backParams) {
                    void navigate({ to: backTo, params: backParams });
                  } else {
                    void navigate({ to: backTo });
                  }
                }}
              >
                <ArrowLeft className="w-4 h-4 mr-1.5" />
                {backLabel}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={signOut} className="shrink-0">Sign out</Button>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-4 sm:py-6">{children}</main>
    </div>
  );
}
