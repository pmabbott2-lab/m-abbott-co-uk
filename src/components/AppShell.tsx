import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

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
  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <Link to="/home" className="flex items-center gap-2 font-semibold shrink-0">
            <span className="inline-block w-6 h-6 rounded-full bg-accent" />
            Mortgage Hub
          </Link>
          <h1 className="text-sm font-medium text-muted-foreground hidden sm:block min-w-0 truncate">{title}</h1>
          <div className="flex flex-wrap items-center justify-end gap-2 min-w-0">
            {action}
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
      <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
