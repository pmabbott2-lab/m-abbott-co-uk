import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  goToPasswordRecoveryPage,
  isPasswordRecoveryPending,
  isPasswordRecoveryUrl,
  shouldBlockAuthenticatedApp,
} from "@/lib/auth-recovery";
import { Button } from "@/components/ui/button";
import avatarImg from "@/assets/avatar.png";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Mortgage Fact-Find — Voice Interview" },
      { name: "description", content: "A friendly avatar-guided voice interview that captures everything your mortgage advisor needs to know." },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (isPasswordRecoveryUrl()) {
      goToPasswordRecoveryPage();
      return;
    }
    if (isPasswordRecoveryPending()) {
      window.location.replace("/auth/reset");
      return;
    }
    if (shouldBlockAuthenticatedApp()) {
      window.location.replace("/auth/reset");
      return;
    }

    // Email confirmation / magic links may land here with the login tokens in
    // the URL. Supabase parses them asynchronously and fires SIGNED_IN — forward
    // the user into the app the moment a session exists.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) navigate({ to: "/home" });
    });

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/home" });
      else setChecking(false);
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  if (checking) return <div className="min-h-screen" />;

  return (
    <div className="min-h-screen bg-background">
      <header className="px-6 py-5 flex items-center justify-between max-w-6xl mx-auto">
        <div className="flex items-center gap-2 font-semibold">
          <span className="inline-block w-7 h-7 rounded-full bg-accent" />
          FactFind
        </div>
        <Link to="/auth"><Button variant="ghost">Sign in</Button></Link>
      </header>
      <main className="max-w-6xl mx-auto px-6 pt-12 pb-24 grid md:grid-cols-2 gap-12 items-center">
        <div className="space-y-6">
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-foreground leading-[1.1]">
            A fact-find that gets your mortgage advisor up to speed — before you even meet.
          </h1>
          <p className="text-lg text-muted-foreground">
            Answer simple questions about you, your job, and the property you want — your way.
            Talk to a friendly spoken assistant, or type to a chat assistant if you'd rather
            keep it quiet. We'll hand a clean summary to your advisor.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link to="/auth"><Button size="lg">Start your fact-find</Button></Link>
          </div>
          <p className="text-sm text-muted-foreground">
            Choose <span className="font-medium text-foreground">spoken</span> or{" "}
            <span className="font-medium text-foreground">typed</span> after you sign in.
          </p>
        </div>
        <div className="flex items-center justify-center">
          <div className="rounded-3xl bg-card border shadow-sm p-8">
            <img src={avatarImg} alt="Your interview guide" width={320} height={320} className="rounded-full" />
            <p className="mt-4 text-center text-sm text-muted-foreground">Susan can speak each question aloud — or chat by text.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
