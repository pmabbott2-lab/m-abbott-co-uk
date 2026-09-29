import { type FormEvent, useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  cancelMfaRecovery,
  completeMyMfaRecovery,
  getMyMfaRecoveryState,
  redeemMyMfaRecoveryGrant,
} from "@/lib/privileged-mfa-recovery.functions";
import { MFA_RECOVERY_TARGET_KIND_LABELS, type MfaRecoverySelfState } from "@/lib/privileged-mfa-recovery";
import { PrivilegedMfaPanel } from "@/components/platform/PrivilegedMfaPanel";
import { PrivilegedStepUpProvider, useStepUpServerFn } from "@/components/platform/PrivilegedStepUp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * G7F-3C3 isolated recovery route. Deliberately outside PlatformLayout: no privileged shell,
 * navigation or platform data. It only shows and advances the signed-in user's own recovery.
 */
export const Route = createFileRoute("/platform_/mfa-recovery")({
  ssr: false,
  component: MfaRecoveryRoute,
});

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "—";
  }
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function MfaRecoveryRoute() {
  return (
    <PrivilegedStepUpProvider>
      <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center space-y-5 px-4 py-10">
        <div>
          <h1 className="text-2xl font-semibold">Authenticator recovery</h1>
          <p className="text-sm text-muted-foreground">
            Replace the authenticator app on your platform account. Platform administration stays unavailable until
            recovery is complete.
          </p>
        </div>
        <MfaRecoveryFlow />
      </div>
    </PrivilegedStepUpProvider>
  );
}

function MfaRecoveryFlow() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const stateFn = useServerFn(getMyMfaRecoveryState);
  const redeemFn = useServerFn(redeemMyMfaRecoveryGrant);
  const completeFn = useStepUpServerFn(useServerFn(completeMyMfaRecovery));
  const cancelFn = useStepUpServerFn(useServerFn(cancelMfaRecovery));

  const [sessionUserId, setSessionUserId] = useState<string | null | undefined>(undefined);
  const [grant, setGrant] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id ?? null;
      if (!userId) {
        void navigate({ to: "/auth", replace: true });
        return;
      }
      setSessionUserId(userId);
    })();
  }, [navigate]);

  const stateQ = useQuery({
    queryKey: ["mfa-recovery-self-state", sessionUserId],
    queryFn: () => stateFn(),
    enabled: Boolean(sessionUserId),
  });

  const signOut = () => {
    void (async () => {
      await supabase.auth.signOut({ scope: "local" });
      void navigate({ to: "/auth", replace: true });
    })();
  };

  const redeem = async (e: FormEvent) => {
    e.preventDefault();
    const entered = grant;
    setGrant("");
    setBusy(true);
    setMessage(null);
    try {
      await redeemFn({ data: { grant: entered } });
    } catch (err) {
      setMessage(errorMessage(err, "The recovery code was not accepted."));
    } finally {
      setBusy(false);
      await stateQ.refetch();
    }
  };

  const finish = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await completeFn();
      setCompleted(true);
      void qc.invalidateQueries({ queryKey: ["platform-authority"] });
    } catch (err) {
      setMessage(errorMessage(err, "Recovery could not be completed."));
      await stateQ.refetch();
    } finally {
      setBusy(false);
    }
  };

  const cancelPending = async (requestId: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await cancelFn({ data: { requestId, reason: "Cancelled by the account holder" } });
    } catch (err) {
      setMessage(errorMessage(err, "The request could not be cancelled."));
    } finally {
      setBusy(false);
      await stateQ.refetch();
    }
  };

  if (sessionUserId === undefined || (sessionUserId && stateQ.isLoading)) {
    return <p className="text-sm text-muted-foreground">Checking recovery status…</p>;
  }
  if (!sessionUserId) return null;

  const footer = (
    <div className="space-y-2">
      {message ? <p className="text-sm text-destructive">{message}</p> : null}
      <Button type="button" variant="outline" onClick={signOut} disabled={busy} className="w-fit">
        Sign out
      </Button>
    </div>
  );

  if (completed) {
    return (
      <div className="space-y-4 text-sm">
        <p className="font-medium">Recovery complete.</p>
        <p className="text-muted-foreground">Your new authenticator app is active and platform access is restored.</p>
        <Button type="button" onClick={() => void navigate({ to: "/platform", replace: true })}>
          Continue to platform
        </Button>
      </div>
    );
  }

  if (stateQ.isError || !stateQ.data) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-destructive">Recovery status could not be loaded.</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void stateQ.refetch()}>
          Try again
        </Button>
        {footer}
      </div>
    );
  }

  const state: MfaRecoverySelfState = stateQ.data;

  if (!state.locked) {
    return (
      <div className="space-y-4 text-sm">
        {state.pendingRequests.length > 0 ? (
          <div className="space-y-3">
            <p>
              A Super Owner has asked to reset the authenticator on your account. If you did not expect this, cancel it
              now. Cancelling needs a code from your current authenticator app.
            </p>
            {state.pendingRequests.map((p) => (
              <div key={p.requestId} className="space-y-2 rounded-md border px-3 py-2">
                <p className="text-muted-foreground">
                  {MFA_RECOVERY_TARGET_KIND_LABELS[p.targetKind]} recovery · earliest run{" "}
                  {formatTime(p.coolingOffUntil)} · expires {formatTime(p.expiresAt)}
                </p>
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void cancelPending(p.requestId)}>
                  Cancel this request
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p>There is no authenticator recovery in progress for your account.</p>
        )}
        <Button type="button" variant="outline" onClick={() => void navigate({ to: "/platform", replace: true })}>
          Go to platform
        </Button>
        {footer}
      </div>
    );
  }

  if (state.status !== "executed_awaiting_enrolment") {
    return (
      <div className="space-y-4 text-sm">
        <p>
          This recovery can no longer be completed. Ask another Super Owner to start a new recovery. Your platform
          access stays suspended until then.
        </p>
        {footer}
      </div>
    );
  }

  if (!state.redeemedByThisSession) {
    if (state.grantRedeemed) {
      return (
        <div className="space-y-4 text-sm">
          <p>
            Your recovery code was already used from another sign-in. Ask the Super Owner who ran the recovery to issue
            a new code, then sign in again.
          </p>
          {footer}
        </div>
      );
    }
    if (!state.grantUsable) {
      return (
        <div className="space-y-4 text-sm">
          <p>
            Your recovery code has expired or stopped working. Ask the Super Owner who ran the recovery to issue a new
            code. Recovery must be finished by {formatTime(state.recoveryExpiresAt)}.
          </p>
          {footer}
        </div>
      );
    }
    return (
      <div className="space-y-4 text-sm">
        <p>
          Enter the one-time recovery code given to you by the Super Owner who ran the recovery. It expires at{" "}
          {formatTime(state.grantExpiresAt)}.
        </p>
        <form onSubmit={(e) => void redeem(e)} className="space-y-2">
          <Label htmlFor="mfa-recovery-grant">Recovery code</Label>
          <Input
            id="mfa-recovery-grant"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={80}
            value={grant}
            onChange={(e) => setGrant(e.target.value)}
            className="font-mono tracking-wider"
          />
          <Button type="submit" disabled={busy || grant.trim().length === 0}>
            {busy ? "Checking…" : "Continue"}
          </Button>
        </form>
        {footer}
      </div>
    );
  }

  return (
    <div className="space-y-4 text-sm">
      <p>
        Set up your new authenticator app and verify a code. Recovery must be finished by{" "}
        {formatTime(state.recoveryExpiresAt)}.
      </p>
      <div className="rounded-lg border border-slate-300 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <PrivilegedMfaPanel purpose="manage" onSatisfied={() => void finish()} />
      </div>
      <Button type="button" onClick={() => void finish()} disabled={busy}>
        {busy ? "Finishing…" : "Finish recovery"}
      </Button>
      {footer}
    </div>
  );
}
