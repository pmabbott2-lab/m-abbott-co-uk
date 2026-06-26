import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
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
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/home" });
      else setChecking(false);
    });
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
            Complete your fact-find or book an appointment with your advisor.
          </h1>
          <p className="text-lg text-muted-foreground">
            Talk to a friendly avatar, type your answers, or pick a time to speak with your advisor.
            We&apos;ll capture everything needed for your mortgage application.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link to="/auth"><Button size="lg">Sign in to get started</Button></Link>
          </div>
        </div>
        <div className="flex items-center justify-center">
          <div className="rounded-3xl bg-card border shadow-sm p-8">
            <img src={avatarImg} alt="Your interview guide" width={320} height={320} className="rounded-full" />
            <p className="mt-4 text-center text-sm text-muted-foreground">Your guide will speak each question aloud.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
// touch
