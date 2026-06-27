import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  clearPasswordRecoveryPending,
  isPasswordRecoveryPending,
  isPasswordRecoveryUrl,
  markPasswordRecoveryPending,
} from "@/lib/auth-recovery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import avatarImg from "@/assets/susan.png";

export const Route = createFileRoute("/auth/reset")({
  validateSearch: (search: Record<string, unknown>) => ({
    recovery: search.recovery === "1" || search.recovery === 1,
  }),
  head: () => ({
    meta: [
      { title: "Reset password — Mortgage Hub" },
      { name: "description", content: "Choose a new password for your account." },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<{ type: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    if (isPasswordRecoveryUrl()) {
      markPasswordRecoveryPending();
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        markPasswordRecoveryPending();
        setReady(true);
      }
      if (event === "SIGNED_IN" && isPasswordRecoveryPending()) {
        setReady(true);
      }
    });

    const timer = window.setTimeout(() => {
      supabase.auth.getSession().then(({ data }) => {
        if (isPasswordRecoveryPending() || data.session) {
          setReady(true);
        } else if (!isPasswordRecoveryUrl()) {
          setStatus({
            type: "error",
            text: "This reset link is invalid or has expired. Request a new one from the sign-in page.",
          });
          setReady(true);
        }
      });
    }, 400);

    return () => {
      window.clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(null);
    if (password.length < 6) {
      setStatus({ type: "error", text: "Password must be at least 6 characters." });
      return;
    }
    if (password !== confirmPassword) {
      setStatus({ type: "error", text: "Passwords don't match." });
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      clearPasswordRecoveryPending();
      window.history.replaceState({}, "", "/auth");
      toast.success("Password updated");
      window.location.href = "/home";
    } catch (err) {
      setStatus({
        type: "error",
        text: err instanceof Error ? err.message : "Could not update password. Try requesting a new reset link.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-background">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-3">
          <img src={avatarImg} alt="Your guide" width={96} height={96} className="mx-auto rounded-full object-cover object-top" />
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Choose a new password</h1>
          <p className="text-sm text-muted-foreground">
            You opened a secure reset link. Enter your new password below.
          </p>
        </div>
        <div className="bg-card rounded-2xl shadow-sm border p-6 space-y-4">
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
              {status.type === "error" && (
                <div className="mt-2">
                  <Link to="/auth" className="underline font-medium">
                    Back to sign in
                  </Link>
                </div>
              )}
            </div>
          )}
          {ready && status?.type !== "error" && (
            <form onSubmit={onSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? "Saving…" : "Save new password"}
              </Button>
            </form>
          )}
          {!ready && (
            <p className="text-sm text-center text-muted-foreground py-4">Verifying your reset link…</p>
          )}
        </div>
        <p className="text-xs text-center text-muted-foreground">
          <Link to="/auth" className="hover:underline">← Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
