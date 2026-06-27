import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getStaffInvite, markStaffInviteUsed } from "@/lib/sessions.functions";
import { getAuthCallbackUrl } from "@/lib/app-url";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ShieldCheck, Link2 } from "lucide-react";
import avatarImg from "@/assets/susan.png";

type ResolvedInvite = {
  role: "advisor" | "introducer";
  email: string | null;
  companyName: string | null;
  companyCode: string | null;
  createCompany: boolean;
};

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

const ROLE_LABEL: Record<ResolvedInvite["role"], string> = {
  advisor: "Advisor",
  introducer: "Introducer",
};

function RegisterPage() {
  const navigate = useNavigate();
  const { invite: token } = Route.useSearch();
  const getInviteFn = useServerFn(getStaffInvite);
  const markUsedFn = useServerFn(markStaffInviteUsed);

  const [loadingInvite, setLoadingInvite] = useState(true);
  const [invite, setInvite] = useState<ResolvedInvite | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
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
        if (cancelled) return;
        setInvite(resolved);
        if (resolved.email) setEmail(resolved.email);
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

  const showStatus = (type: "error" | "success", text: string) => {
    setStatus({ type, text });
    if (type === "success") toast.success(text);
    else toast.error(text);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !invite) return;
    setStatus(null);
    setSubmitting(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: getAuthCallbackUrl(),
          data: { full_name: fullName.trim(), phone: phone.trim() },
        },
      });
      if (error) throw error;

      // Supabase returns a user with no identities when the email already exists.
      if (data.user && data.user.identities?.length === 0) {
        showStatus(
          "error",
          "An account with this email already exists. Please sign in and ask your admin to grant your role.",
        );
        return;
      }
      if (!data.user) {
        showStatus("error", "Sign-up did not complete. Please try again.");
        return;
      }

      // Consume the invite server-side: grants the advisor/introducer role and
      // marks the invite used. This is what stops the new account being a plain
      // customer.
      await markUsedFn({ data: { token, userId: data.user.id } });

      if (data.session) {
        showStatus("success", "Welcome aboard — taking you to your dashboard…");
        navigate({ to: "/home" });
        return;
      }

      showStatus(
        "success",
        "Account created and your role is set up. Check your email to confirm, then sign in.",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      showStatus("error", msg);
    } finally {
      setSubmitting(false);
    }
  };

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
                {invite.role === "introducer"
                  ? invite.createCompany
                    ? "Create your account below. We'll set you up with your own introducer company and referral links."
                    : `Create your account below. You'll be linked to ${invite.companyName ? `“${invite.companyName}”` : `company ${invite.companyCode}`}.`
                  : "Create your account below to start working with customer fact-finds."}
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

          {invite && !inviteError && (
            <form onSubmit={onSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="name">Full name</Label>
                <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
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
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? "Creating your account…" : "Create account"}
              </Button>
            </form>
          )}
        </div>

        <p className="text-xs text-center text-muted-foreground space-x-3">
          <Link to="/" className="hover:underline">← Back home</Link>
          <span>·</span>
          <Link to="/auth" search={{ recovery: false }} className="hover:underline">Already have an account? Sign in</Link>
        </p>
      </div>
    </div>
  );
}
