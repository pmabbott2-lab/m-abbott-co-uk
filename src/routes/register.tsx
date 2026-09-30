import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { acceptStaffInvite, getStaffInvite } from "@/lib/sessions.functions";
import type { StaffInvitePreview } from "@/lib/staff-invite-contract";
import { getAuthCallbackUrl } from "@/lib/app-url";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ShieldCheck, Link2 } from "lucide-react";
import avatarImg from "@/assets/susan.png";

export const Route = createFileRoute("/register")({
  validateSearch: (search: Record<string, unknown>) => ({
    invite: typeof search.invite === "string" ? search.invite : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Join Mortgage Hub" },
      { name: "description", content: "Accept your invitation to join Mortgage Hub." },
    ],
  }),
  component: RegisterPage,
});

const ROLE_LABEL: Record<StaffInvitePreview["role"], string> = {
  advisor: "Advisor",
  introducer: "Introducer",
  admin: "Admin",
};

type Mode = "create" | "signin";

function RegisterPage() {
  const navigate = useNavigate();
  const { invite: token } = Route.useSearch();
  const getInviteFn = useServerFn(getStaffInvite);
  const acceptFn = useServerFn(acceptStaffInvite);

  const [loadingInvite, setLoadingInvite] = useState(true);
  const [invite, setInvite] = useState<StaffInvitePreview | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("create");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ type: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setInviteError("This invite link is missing its token. Ask your admin for a new link.");
        setLoadingInvite(false);
        return;
      }
      try {
        const resolved = await getInviteFn({ data: { token } });
        if (!cancelled) setInvite(resolved);
      } catch (e) {
        if (!cancelled) {
          setInviteError(e instanceof Error ? e.message : "This invite link is not valid.");
        }
      } finally {
        if (!cancelled) setLoadingInvite(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, getInviteFn]);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSessionEmail(data.session?.user.email?.trim().toLowerCase() ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionEmail(session?.user.email?.trim().toLowerCase() ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const showStatus = (type: "error" | "success", text: string) => {
    setStatus({ type, text });
    if (type === "success") toast.success(text);
    else toast.error(text);
  };

  const goAfterInvite = (tenantSlug: string | null | undefined) => {
    if (tenantSlug) {
      void navigate({
        to: "/$tenantSlug/workspace",
        params: { tenantSlug },
      } as never);
      return;
    }
    void navigate({ to: "/" });
  };

  // Acceptance always runs as the signed-in user; the server binds the invite to
  // that account's confirmed email. No user id is ever sent from the browser.
  const accept = async () => {
    if (!token) return;
    const result = await acceptFn({ data: { token } });
    showStatus("success", "Invitation accepted — taking you to your dashboard…");
    goAfterInvite(result.tenantSlug);
  };

  const run = async (fn: () => Promise<void>) => {
    setStatus(null);
    setSubmitting(true);
    try {
      await fn();
    } catch (err) {
      showStatus("error", err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const onCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!invite) return;
    void run(async () => {
      const { data, error } = await supabase.auth.signUp({
        email: invite.email,
        password,
        options: {
          emailRedirectTo: getAuthCallbackUrl(invite.tenantSlug),
          data: { full_name: fullName.trim(), phone: phone.trim() },
        },
      });
      const alreadyRegistered =
        (data.user && data.user.identities?.length === 0) ||
        (error && /already (been )?registered|already exists|user already/i.test(error.message));
      if (alreadyRegistered) {
        setMode("signin");
        showStatus(
          "error",
          "This email already has an account. Sign in below to accept the invite.",
        );
        return;
      }
      if (error) throw error;
      if (data.session) {
        await accept();
        return;
      }
      setMode("signin");
      showStatus(
        "success",
        "Account created. Check your inbox and confirm your email, then return to this invite link and sign in to accept.",
      );
    });
  };

  const onSignIn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!invite) return;
    void run(async () => {
      const { error } = await supabase.auth.signInWithPassword({ email: invite.email, password });
      if (error) {
        if (/not confirmed/i.test(error.message)) {
          throw new Error(
            "Confirm your email address first — check your inbox, then sign in here.",
          );
        }
        throw error;
      }
      await accept();
    });
  };

  const onSignOut = () => {
    void run(async () => {
      await supabase.auth.signOut();
    });
  };

  const signedInMatches = Boolean(invite && sessionEmail && sessionEmail === invite.email);
  const signedInOther = Boolean(invite && sessionEmail && sessionEmail !== invite.email);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-background">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-3">
          <img src={avatarImg} alt="Mortgage Hub" width={96} height={96} className="mx-auto rounded-full object-cover object-top" />
          {loadingInvite ? (
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Checking your invite…</h1>
          ) : invite ? (
            <>
              <div className="mx-auto inline-flex items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-sm">
                {invite.role === "introducer" ? (
                  <Link2 className="w-3.5 h-3.5 text-muted-foreground" />
                ) : (
                  <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground" />
                )}
                Invitation · {ROLE_LABEL[invite.role]}
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                You&apos;ve been invited to join Mortgage Hub as an {ROLE_LABEL[invite.role]}
              </h1>
              <p className="text-sm text-muted-foreground">
                This invitation is for{" "}
                <span className="font-medium text-foreground">{invite.email}</span>.
                {invite.role === "introducer"
                  ? invite.createCompany
                    ? " We'll set you up with your own introducer company and referral links."
                    : ` You'll be linked to ${invite.companyName ? `“${invite.companyName}”` : `company ${invite.companyCode}`}.`
                  : ""}
              </p>
            </>
          ) : (
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Invite not valid</h1>
          )}
        </div>

        <div className="bg-card rounded-2xl shadow-sm border p-6 space-y-4">
          {inviteError && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {inviteError}
            </div>
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

          {invite && !inviteError && signedInMatches && (
            <div className="space-y-3">
              <p className="text-sm">
                Signed in as <span className="font-medium">{sessionEmail}</span>.
              </p>
              <Button
                type="button"
                disabled={submitting}
                className="w-full"
                onClick={() => void run(accept)}
              >
                {submitting ? "Accepting…" : "Accept invitation"}
              </Button>
            </div>
          )}

          {invite && !inviteError && signedInOther && (
            <div className="space-y-3">
              <p className="text-sm">
                You&apos;re signed in as <span className="font-medium">{sessionEmail}</span>, but
                this invitation is for <span className="font-medium">{invite.email}</span>. Sign
                out, then sign in or create an account with the invited email address.
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                className="w-full"
                onClick={onSignOut}
              >
                Sign out
              </Button>
            </div>
          )}

          {invite && !inviteError && !sessionEmail && (
            <form onSubmit={mode === "create" ? onCreate : onSignIn} className="space-y-3">
              {mode === "create" && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Full name</Label>
                    <Input
                      id="name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      required
                    />
                  </div>
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
                  </div>
                </>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={invite.email} readOnly disabled />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === "create" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              <Button type="submit" disabled={submitting} className="w-full">
                {mode === "create"
                  ? submitting
                    ? "Creating your account…"
                    : "Create account"
                  : submitting
                    ? "Signing in…"
                    : "Sign in and accept"}
              </Button>
              <button
                type="button"
                className="w-full text-xs text-muted-foreground hover:underline"
                onClick={() => {
                  setStatus(null);
                  setMode(mode === "create" ? "signin" : "create");
                }}
              >
                {mode === "create"
                  ? "Already have an account with this email? Sign in instead"
                  : "New here? Create an account instead"}
              </button>
            </form>
          )}
        </div>

        <p className="text-xs text-center text-muted-foreground space-x-3">
          <Link to="/" className="hover:underline">← Back home</Link>
        </p>
      </div>
    </div>
  );
}
