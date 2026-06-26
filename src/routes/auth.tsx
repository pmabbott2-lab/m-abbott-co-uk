import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import avatarImg from "@/assets/avatar.png";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Mortgage Fact-Find & Booking" },
      { name: "description", content: "Sign in to complete your mortgage fact-find or book an appointment with your advisor." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/home" });
    });
  }, [navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: fullName },
          },
        });
        if (error) throw error;
        toast.success("Account created. You're signed in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      navigate({ to: "/home" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const onGoogle = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/home` },
    });
    if (error) {
      toast.error(error.message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-background">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-3">
          <img src={avatarImg} alt="Your guide" width={96} height={96} className="mx-auto rounded-full" />
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Fact-find or book an appointment</h1>
          <p className="text-sm text-muted-foreground">
            Complete your mortgage fact-find by voice or text, or go straight to booking a call with your advisor.
          </p>
        </div>
        <div className="bg-card rounded-2xl shadow-sm border p-6 space-y-4">
          <div className="flex gap-2 p-1 bg-muted rounded-lg">
            <button
              type="button"
              onClick={() => setMode("signin")}
              className={`flex-1 text-sm py-2 rounded-md transition ${mode === "signin" ? "bg-card shadow-sm font-medium" : "text-muted-foreground"}`}
            >Sign in</button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={`flex-1 text-sm py-2 rounded-md transition ${mode === "signup" ? "bg-card shadow-sm font-medium" : "text-muted-foreground"}`}
            >Create account</button>
          </div>
          <form onSubmit={onSubmit} className="space-y-3">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Full name</Label>
                <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
            </Button>
          </form>
          <div className="relative my-2">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
            <span className="relative bg-card px-2 text-xs text-muted-foreground mx-auto block w-fit">or</span>
          </div>
          <Button variant="outline" className="w-full" onClick={onGoogle} disabled={loading} type="button">
            Continue with Google
          </Button>
        </div>
        <p className="text-xs text-center text-muted-foreground">
          <Link to="/" className="hover:underline">← Back home</Link>
        </p>
      </div>
    </div>
  );
}

