import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  clearPasswordRecoveryPending,
  goToPasswordRecoveryPage,
  isPasswordRecoveryPending,
  isPasswordRecoveryUrl,
} from "@/lib/auth-recovery";
import { getAuthCallbackUrl, getPasswordResetUrl, isLocalDev } from "@/lib/app-url";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import avatarImg from "@/assets/avatar.png";

type AuthMode = "signin" | "signup" | "forgot";

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>) => ({
    recovery: search.recovery === "1" || search.recovery === 1,
  }),
  head: () => ({
    meta: [
      { title: "Sign in — Mortgage Fact-Find" },
      { name: "description", content: "Sign in to start your guided mortgage fact-find interview." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { recovery } = Route.useSearch();
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [devResetLink, setDevResetLink] = useState<string | null>(null);

  useEffect(() => {
    if (recovery || isPasswordRecoveryUrl() || isPasswordRecoveryPending()) {
      goToPasswordRecoveryPage();
      return;
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        goToPasswordRecoveryPage();
        return;
      }
      // After an email confirmation / magic link, Supabase parses the tokens
      // from the URL and fires SIGNED_IN — forward them straight into the app.
      if (session && !isPasswordRecoveryPending()) {
        navigate({ to: "/home" });
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (data.session && !isPasswordRecoveryPending()) {
        navigate({ to: "/home" });
      }
    });

    return () => subscription.unsubscribe();
  }, [recovery, navigate]);

  const showStatus = (type: "error" | "success", text: string) => {
    setStatus({ type, text });
    if (type === "success") toast.success(text);
    else toast.error(text);
  };

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setStatus(null);
    setDevResetLink(null);
    setPassword("");
    setPhone("");
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", "/auth");
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(null);
    setLoading(true);
    try {
      if (mode === "forgot") {
        const res = await fetch("/api/auth/request-password-reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim() }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          redirectTo?: string;
          setupHint?: string;
          resetLink?: string;
          mode?: "direct_link" | "email";
        };
        if (!res.ok || !data.ok) {
          throw new Error(data.error ?? "Could not create reset link");
        }

        if (data.mode === "direct_link" && data.resetLink) {
          setDevResetLink(data.resetLink);
          showStatus(
            "success",
            `Reset link ready for ${data.redirectTo ?? getPasswordResetUrl()}. Click the button below.`,
          );
          if (data.setupHint) {
            toast.message("Supabase redirect URLs", { description: data.setupHint });
          }
          return;
        }

        const target = data.redirectTo ?? getPasswordResetUrl();
        let message = `If an account exists for that email, we've sent a reset link. It should open at ${target}.`;
        if (data.setupHint) message += ` ${data.setupHint}`;
        showStatus("success", message);
        if (data.resetLink) setDevResetLink(data.resetLink);
        return;
      }

      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: getAuthCallbackUrl(),
            data: { full_name: fullName.trim(), phone: phone.trim() },
          },
        });
        if (error) throw error;

        if (data.user && data.user.identities?.length === 0) {
          showStatus("error", "An account with this email already exists. Try signing in or reset your password.");
          switchMode("signin");
          return;
        }

        if (data.session) {
          showStatus("success", "Account created — taking you to your dashboard…");
          navigate({ to: "/home" });
          return;
        }

        showStatus(
          "success",
          "Account created. Check your email for a confirmation link, then sign in here.",
        );
        switchMode("signin");
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      if (!data.session) {
        showStatus("error", "Sign-in did not complete. Please try again.");
        return;
      }
      clearPasswordRecoveryPending();
      navigate({ to: "/home" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      if (/email not confirmed/i.test(msg)) {
        showStatus("error", "Please confirm your email first — check your inbox for the link from Supabase.");
      } else if (/invalid api key/i.test(msg)) {
        showStatus(
          "error",
          "Invalid Supabase API key. In .env, copy the full publishable and service_role keys from Supabase → Settings → API (new keys start with sb_publishable_ / sb_secret_). Then restart npm run dev.",
        );
      } else if (/invalid login credentials/i.test(msg)) {
        showStatus("error", "Wrong email or password. Try Forgot password? below.");
      } else {
        showStatus("error", msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const onGoogle = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: getAuthCallbackUrl() },
      });
      if (error) throw error;
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Google sign-in failed. Use email/password, or enable Google in your Supabase project.",
      );
      setLoading(false);
    }
  };

  const title =
    mode === "forgot" ? "Reset your password" : "Your guided fact-find";

  const subtitle =
    mode === "forgot"
      ? isLocalDev()
        ? "We'll create a direct reset link for localhost (no email required)."
        : "Enter your email and we'll send you a reset link."
      : "A friendly voice interview that helps your advisor know you faster.";

  const submitLabel =
    mode === "forgot"
      ? isLocalDev()
        ? "Get reset link"
        : "Send reset link"
      : mode === "signup"
        ? "Create account"
        : "Sign in";

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-background">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-3">
          <img src={avatarImg} alt="Your guide" width={96} height={96} className="mx-auto rounded-full" />
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="bg-card rounded-2xl shadow-sm border p-6 space-y-4">
          {mode === "signin" || mode === "signup" ? (
            <div className="flex gap-2 p-1 bg-muted rounded-lg">
              <button
                type="button"
                onClick={() => switchMode("signin")}
                className={`flex-1 text-sm py-2 rounded-md transition ${mode === "signin" ? "bg-card shadow-sm font-medium" : "text-muted-foreground"}`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => switchMode("signup")}
                className={`flex-1 text-sm py-2 rounded-md transition ${mode === "signup" ? "bg-card shadow-sm font-medium" : "text-muted-foreground"}`}
              >
                Create account
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className="text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              ← Back to sign in
            </button>
          )}

          {status && (
            <div
              role="alert"
              className={`rounded-lg border px-3 py-2 text-sm ${
                status.type === "error"
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-primary/30 bg-primary/10 text-foreground"
              }`}
            >
              {status.text}
            </div>
          )}

          {devResetLink && (
            <div className="rounded-lg border border-primary/40 bg-primary/5 px-4 py-4 text-sm space-y-3">
              <p className="font-medium text-foreground">Open this reset link</p>
              <Button asChild className="w-full">
                <a href={devResetLink}>Reset password</a>
              </Button>
              <p className="text-xs text-muted-foreground break-all">{devResetLink}</p>
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-3">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Full name</Label>
                <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </div>
            )}
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="phone">Mobile number</Label>
                <Input
                  id="phone"
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  placeholder="07…"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Your preferred contact — we can text you a link to pick up your fact-find.
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            {mode !== "forgot" && (
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
            )}
            {mode === "signin" && (
              <div className="text-right">
                <button
                  type="button"
                  onClick={() => switchMode("forgot")}
                  className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  Forgot password?
                </button>
              </div>
            )}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Please wait…" : submitLabel}
            </Button>
          </form>

          {(mode === "signin" || mode === "signup") && (
            <>
              <div className="relative my-2">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                <span className="relative bg-card px-2 text-xs text-muted-foreground mx-auto block w-fit">or</span>
              </div>
              <Button variant="outline" className="w-full" onClick={onGoogle} disabled={loading} type="button">
                Continue with Google
              </Button>
            </>
          )}
        </div>
        <p className="text-xs text-center text-muted-foreground space-x-3">
          <Link to="/" className="hover:underline">← Back home</Link>
          {(mode === "signin" || mode === "signup") && (
            <>
              <span>·</span>
              <button
                type="button"
                onClick={() => switchMode("forgot")}
                className="hover:underline"
              >
                Forgot password?
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
