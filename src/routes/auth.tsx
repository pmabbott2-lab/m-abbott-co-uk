import { createFileRoute, useNavigate, useMatches, Outlet, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  clearPasswordRecoveryPending,
  goToPasswordRecoveryPage,
  isPasswordRecoveryPending,
  isPasswordRecoveryUrl,
} from "@/lib/auth-recovery";
import { getAuthCallbackUrl, getPasswordResetUrl, isLocalDev } from "@/lib/app-url";
import { isValidUkMobile, normaliseUkPhone } from "@/lib/phone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import avatarImg from "@/assets/susan.png";

type AuthMode = "signin" | "signup" | "forgot" | "phone";

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>) => ({
    recovery: search.recovery === "1" || search.recovery === 1,
  }),
  head: () => ({
    meta: [
      { title: "Sign in — Mortgage Hub" },
      { name: "description", content: "Sign in to get started with Mortgage Hub." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  // `/auth` is the parent of child routes like `/auth/reset`. Since this
  // component has no <Outlet/>, render child routes here instead of the
  // sign-in form (otherwise the reset page never mounts). Derive this from the
  // matched route tree (consistent across SSR/client) to avoid hydration
  // mismatches that a window-location check would cause.
  const matches = useMatches();
  const isChildRoute = matches.some((m) => m.routeId === "/auth/reset");
  const { recovery } = Route.useSearch();
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [devResetLink, setDevResetLink] = useState<string | null>(null);
  // SMS OTP login: once a code is sent we remember the E.164 number we sent it
  // to and switch to the code-entry step.
  const [otpSentTo, setOtpSentTo] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");

  useEffect(() => {
    if (isChildRoute) return;
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
  }, [recovery, navigate, isChildRoute]);

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
    setOtpSentTo(null);
    setOtpCode("");
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

  const sendOtp = async (resend = false) => {
    const e164 = normaliseUkPhone(phone);
    if (!isValidUkMobile(phone)) {
      showStatus("error", "Enter a valid UK mobile number (e.g. 07123 456789).");
      return;
    }
    setStatus(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone: e164 });
      if (error) throw error;
      setOtpSentTo(e164);
      setOtpCode("");
      showStatus("success", `We've texted a 6-digit code to ${e164}.${resend ? " (resent)" : ""}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not send the code";
      if (/signups not allowed|otp.*disabled|phone.*provider|not enabled/i.test(msg)) {
        showStatus(
          "error",
          "Phone sign-in isn't enabled yet. An admin must turn on the Phone provider and an SMS provider in Supabase.",
        );
      } else {
        showStatus("error", msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const verifyOtpCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpSentTo) return;
    const token = otpCode.trim();
    if (!/^\d{6}$/.test(token)) {
      showStatus("error", "Enter the 6-digit code from the text message.");
      return;
    }
    setStatus(null);
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        phone: otpSentTo,
        token,
        type: "sms",
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
      if (/expired|invalid|incorrect|token/i.test(msg)) {
        showStatus("error", "That code is invalid or expired. Request a new one.");
      } else {
        showStatus("error", msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const title =
    mode === "forgot"
      ? "Reset your password"
      : mode === "phone"
        ? "Sign in with your phone"
        : "Get started with Mortgage Hub";

  const subtitle =
    mode === "forgot"
      ? isLocalDev()
        ? "We'll create a direct reset link for localhost (no email required)."
        : "Enter your email and we'll send you a reset link."
      : mode === "phone"
        ? otpSentTo
          ? "Enter the 6-digit code we just texted you."
          : "We'll text you a one-time code to sign in — no password needed."
        : "A friendly voice interview that helps your advisor know you faster.";

  const submitLabel =
    mode === "forgot"
      ? isLocalDev()
        ? "Get reset link"
        : "Send reset link"
      : mode === "signup"
        ? "Create account"
        : "Sign in";

  // Child routes (e.g. /auth/reset) render here via the parent's outlet.
  if (isChildRoute) return <Outlet />;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-background">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-3">
          <img src={avatarImg} alt="Your guide" width={96} height={96} className="mx-auto rounded-full object-cover object-top" />
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
              <Button
                type="button"
                className="w-full"
                onClick={() => {
                  // Force a full navigation to Supabase's verify URL. Supabase
                  // then redirects back to /auth/reset with the recovery tokens.
                  window.location.assign(devResetLink);
                }}
              >
                Reset password
              </Button>
              <p className="text-xs text-muted-foreground break-all">
                Or copy this link into your browser:
                <br />
                <a href={devResetLink} className="underline">{devResetLink}</a>
              </p>
            </div>
          )}

          {mode !== "phone" && (
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
                  Your preferred contact — we can text you a link to pick up where you left off.
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
          )}

          {mode === "phone" && !otpSentTo && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void sendOtp(false);
              }}
              className="space-y-3"
            >
              <div className="space-y-1.5">
                <Label htmlFor="otp-phone">Mobile number</Label>
                <Input
                  id="otp-phone"
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  placeholder="07123 456789"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  UK mobile only. Standard message rates may apply.
                </p>
              </div>
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? "Sending code…" : "Text me a code"}
              </Button>
            </form>
          )}

          {mode === "phone" && otpSentTo && (
            <form onSubmit={verifyOtpCode} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="otp-code">6-digit code</Label>
                <Input
                  id="otp-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                  required
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Sent to {otpSentTo}.
                </p>
              </div>
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? "Verifying…" : "Verify & sign in"}
              </Button>
              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setOtpSentTo(null);
                    setOtpCode("");
                    setStatus(null);
                  }}
                  className="text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
                >
                  ← Use a different number
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void sendOtp(true)}
                  className="text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
                >
                  Resend code
                </button>
              </div>
            </form>
          )}

          {(mode === "signin" || mode === "signup") && (
            <>
              <div className="relative my-2">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                <span className="relative bg-card px-2 text-xs text-muted-foreground mx-auto block w-fit">or</span>
              </div>
              <Button variant="outline" className="w-full" onClick={onGoogle} disabled={loading} type="button">
                Continue with Google
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => switchMode("phone")}
                disabled={loading}
                type="button"
              >
                Sign in with phone (SMS code)
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
