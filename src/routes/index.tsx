import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  goToPasswordRecoveryPage,
  isPasswordRecoveryPending,
  isPasswordRecoveryUrl,
  shouldBlockAuthenticatedApp,
} from "@/lib/auth-recovery";
import { Button } from "@/components/ui/button";
import { CalendarCheck, MessageSquare, Mic } from "lucide-react";
import avatarImg from "@/assets/susan.png";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Mortgage Hub — Voice, Chat & Appointments" },
      {
        name: "description",
        content:
          "Create your account and complete a spoken or typed fact-find with Susan — or book an appointment first with our diary.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();

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

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) navigate({ to: "/home" });
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/home" });
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background">
      <header className="px-6 py-5 flex items-center justify-between max-w-6xl mx-auto">
        <a href="/" className="flex items-center gap-2 font-semibold text-foreground no-underline">
          <span className="inline-block w-7 h-7 rounded-full bg-accent" />
          Mortgage Hub
        </a>
        <a href="/auth"><Button variant="ghost">Sign in</Button></a>
      </header>
      <main className="max-w-6xl mx-auto px-6 pt-12 pb-24 space-y-16">
        <section className="grid md:grid-cols-2 gap-12 items-center">
          <div className="space-y-6">
            <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-foreground leading-[1.1]">
              Get your mortgage advisor up to speed — before you even meet.
            </h1>
            <p className="text-lg text-muted-foreground">
              Create your account, then answer simple questions about you, your job, and the property
              you want. Talk to Susan in a spoken fact-find, or type quietly in chat — we'll hand a
              clean summary to your advisor.
            </p>
            <div className="flex flex-wrap gap-3">
              <a href="/auth?join=1&start=voice"><Button size="lg">Get started</Button></a>
            </div>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Voice</span> and{" "}
              <span className="font-medium text-foreground">chat</span> use create account, then your
              fact-find — not appointment booking.{" "}
              <span className="font-medium text-foreground">Book appointment</span> picks your time
              first.
            </p>
          </div>
          <div className="flex items-center justify-center">
            <div className="rounded-3xl bg-card border shadow-sm p-8">
              <img src={avatarImg} alt="Your interview guide" width={320} height={320} className="w-80 h-80 rounded-full object-cover object-top" />
              <p className="mt-4 text-center text-sm text-muted-foreground">Susan can speak each question aloud — or chat by text.</p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-1">Choose how you'd like to get started</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Voice and chat start with create account, then your fact-find. Booking starts by choosing
            an appointment.
          </p>
          <div className="grid sm:grid-cols-3 gap-4">
            <a href="/auth?join=1&start=voice" className="rounded-2xl border bg-card p-5 transition hover:border-accent hover:shadow-sm no-underline text-foreground">
              <Mic className="w-7 h-7 mb-3 text-accent" />
              <h3 className="font-semibold">Verbal interview</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Create your account, then talk through your details with Susan in a spoken fact-find.
              </p>
              <p className="text-sm font-medium text-accent mt-3">Get started →</p>
            </a>
            <a href="/auth?join=1&start=chat" className="rounded-2xl border bg-card p-5 transition hover:border-accent hover:shadow-sm no-underline text-foreground">
              <MessageSquare className="w-7 h-7 mb-3 text-accent" />
              <h3 className="font-semibold">Text interview</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Create your account, then answer the same questions in a quiet typed chat.
              </p>
              <p className="text-sm font-medium text-accent mt-3">Create account →</p>
            </a>
            <a href="/auth?join=1&start=book" className="rounded-2xl border bg-card p-5 transition hover:border-accent hover:shadow-sm no-underline text-foreground">
              <CalendarCheck className="w-7 h-7 mb-3 text-accent" />
              <h3 className="font-semibold">Book an appointment</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Pick a time with your advisor first — appointment-first signup with our diary.
              </p>
              <p className="text-sm font-medium text-accent mt-3">Book appointment →</p>
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
