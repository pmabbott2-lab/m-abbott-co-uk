import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { CalendarCheck } from "lucide-react";

export function AppShell({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  const navigate = useNavigate();
  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <Link to="/home" className="flex items-center gap-2 font-semibold">
            <span className="inline-block w-6 h-6 rounded-full bg-accent" />
            FactFind
          </Link>
          <h1 className="text-sm font-medium text-muted-foreground hidden sm:block">{title}</h1>
          <div className="flex items-center gap-2">
            <Link to="/booking">
              <Button variant="secondary" size="sm">
                <CalendarCheck className="w-4 h-4 mr-1.5" />
                Book appointment
              </Button>
            </Link>
            {action}
            <Button variant="ghost" size="sm" onClick={signOut}>Sign out</Button>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
