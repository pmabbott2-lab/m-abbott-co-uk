import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { CalendarCheck, MessageSquare, Mic } from "lucide-react";
import avatarImg from "@/assets/avatar.png";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Mortgage Fact-Find & Appointment Booking" },
      {
        name: "description",
        content:
          "Complete your mortgage fact-find by voice or text, or book an appointment with your advisor online.",
      },
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
        <Link to="/auth">
          <Button>Sign in</Button>
        </Link>
      </header>

      <main className="max-w-6xl mx-auto px-6 pt-10 pb-24 space-y-14">
        <section className="grid md:grid-cols-2 gap-12 items-center">
          <div className="space-y-6">
            <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-foreground leading-[1.1]">
              Complete your fact-find or book an appointment
            </h1>
            <p className="text-lg text-muted-foreground">
              Talk to Susan, type your answers, or pick a time to speak with your mortgage advisor.
              Everything is captured ready for your application.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link to="/auth">
                <Button size="lg">Sign in to get started</Button>
              </Link>
              <Link to="/auth">
                <Button size="lg" variant="outline">
                  <CalendarCheck className="w-4 h-4 mr-2" />
                  Book an appointment
                </Button>
              </Link>
            </div>
          </div>
          <div className="flex items-center justify-center">
            <div className="rounded-3xl bg-card border shadow-sm p-8">
              <img src={avatarImg} alt="Your interview guide" width={320} height={320} className="rounded-full" />
              <p className="mt-4 text-center text-sm text-muted-foreground">
                Fact-find by voice or text — then book your advisor call.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">Three ways to get started</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="rounded-2xl border bg-card p-5">
              <Mic className="w-7 h-7 mb-3 text-accent" />
              <h3 className="font-semibold">Verbal interview</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Talk through your fact-find with Susan, then book an appointment when you&apos;re done.
              </p>
            </div>
            <div className="rounded-2xl border bg-card p-5">
              <MessageSquare className="w-7 h-7 mb-3 text-accent" />
              <h3 className="font-semibold">Text interview</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Type your answers at your own pace — same questions, then book your call.
              </p>
            </div>
            <div className="rounded-2xl border-2 border-accent/40 bg-accent/5 p-5">
              <CalendarCheck className="w-7 h-7 mb-3 text-accent" />
              <h3 className="font-semibold">Book an appointment</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Skip the fact-find for now and pick a date and time to speak with your advisor.
              </p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-4">
            Sign in to use any of these options. After sign-in you&apos;ll see all three on your home page.
          </p>
        </section>
      </main>
    </div>
  );
}
