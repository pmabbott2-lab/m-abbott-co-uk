import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  acceptPlatformInvite,
  resolvePlatformInvite,
} from "@/lib/platform-admins.functions";
import { platformRoleLabel } from "@/lib/platform-admins";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type Resolved = {
  email: string;
  firstName: string;
  lastName: string;
  platformRole: "super_owner" | "super_admin";
  expiresAt: string;
};

export const Route = createFileRoute("/platform-invite")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Platform invitation — Mortgage Hub" },
      { name: "description", content: "Accept your Mortgage Hub platform administrator invitation." },
    ],
  }),
  component: PlatformInvitePage,
});

function PlatformInvitePage() {
  const navigate = useNavigate();
  const { token } = Route.useSearch();
  const resolveFn = useServerFn(resolvePlatformInvite);
  const acceptFn = useServerFn(acceptPlatformInvite);

  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<Resolved | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled) {
        setSessionEmail(data.session?.user?.email?.toLowerCase() ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setError("This invitation link is missing its token.");
        setLoading(false);
        return;
      }
      try {
        const resolved = await resolveFn({ data: { token } });
        if (!cancelled) setInvite(resolved);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "This invitation is not valid.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, resolveFn]);

  async function acceptWithCurrentSession() {
    if (!token) return;
    setSubmitting(true);
    try {
      const res = await acceptFn({ data: { token } });
      toast.success(`${platformRoleLabel(res.platformRole)} granted`);
      void navigate({ to: "/platform", replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Acceptance failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function registerAndAccept() {
    if (!token || !invite) return;
    if (password.length < 8) {
      toast.error("Choose a password with at least 8 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const fullName = `${invite.firstName} ${invite.lastName}`.trim();
      const { data, error: signErr } = await supabase.auth.signUp({
        email: invite.email,
        password,
        options: { data: { full_name: fullName } },
      });
      if (signErr) throw signErr;
      if (!data.session) {
        // Email confirmation may be required — try sign-in.
        const { error: inErr } = await supabase.auth.signInWithPassword({
          email: invite.email,
          password,
        });
        if (inErr) {
          throw new Error(
            "Account created. Sign in with this email, then reopen the invitation link to finish.",
          );
        }
      }
      const res = await acceptFn({ data: { token } });
      toast.success(`${platformRoleLabel(res.platformRole)} granted`);
      void navigate({ to: "/platform", replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not accept invitation");
    } finally {
      setSubmitting(false);
    }
  }

  async function signInAndAccept() {
    if (!token || !invite) return;
    setSubmitting(true);
    try {
      const { error: inErr } = await supabase.auth.signInWithPassword({
        email: invite.email,
        password,
      });
      if (inErr) throw inErr;
      const res = await acceptFn({ data: { token } });
      toast.success(`${platformRoleLabel(res.platformRole)} granted`);
      void navigate({ to: "/platform", replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sign-in / acceptance failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md items-center justify-center px-4 text-sm text-muted-foreground">
        Checking invitation…
      </div>
    );
  }

  if (error || !invite) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center space-y-3 px-4">
        <h1 className="text-xl font-semibold">Platform invitation</h1>
        <p className="text-sm text-muted-foreground">{error ?? "Invitation not found."}</p>
        <Button asChild variant="outline">
          <Link to="/">Home</Link>
        </Button>
      </div>
    );
  }

  const roleLabel = platformRoleLabel(invite.platformRole);
  const signedInAsInvitee = sessionEmail === invite.email.toLowerCase();

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center space-y-4 px-4 py-10">
      <div>
        <h1 className="text-xl font-semibold">Platform invitation</h1>
        <p className="text-sm text-muted-foreground">
          You are invited as <span className="font-medium text-foreground">{roleLabel}</span>.
        </p>
      </div>
      <div className="rounded-md border border-border p-3 text-sm space-y-1">
        <p>
          {invite.firstName} {invite.lastName}
        </p>
        <p className="text-muted-foreground">{invite.email}</p>
        <p className="text-xs text-muted-foreground">
          Expires {new Date(invite.expiresAt).toLocaleDateString("en-GB")}
        </p>
      </div>

      {signedInAsInvitee ? (
        <Button type="button" disabled={submitting} onClick={() => void acceptWithCurrentSession()}>
          {submitting ? "Accepting…" : `Accept ${roleLabel}`}
        </Button>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Sign in or create an account with <strong>{invite.email}</strong> to accept. A different
            account cannot use this invitation.
          </p>
          <div className="space-y-1">
            <Label htmlFor="pi-password">Password</Label>
            <Input
              id="pi-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={submitting} onClick={() => void registerAndAccept()}>
              Create account & accept
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => void signInAndAccept()}
            >
              Sign in & accept
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
