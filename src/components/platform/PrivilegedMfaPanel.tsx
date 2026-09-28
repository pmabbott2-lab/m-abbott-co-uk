import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import type { PrivilegedMfaErrorCode } from "@/lib/privileged-mfa";
import {
  canOfferPrivilegedReverify,
  completeTotpChallenge,
  completeTotpEnrolment,
  describeServerMfaFreshness,
  loadTotpFactors,
  startTotpEnrolment,
  totpQrImageSrc,
  type CompleteFlowResult,
  type PrivilegedMfaApi,
  type ServerAssurance,
  type TotpFactorState,
} from "@/lib/privileged-mfa-flow";
import {
  getMyPrivilegedMfaStatus,
  recordMyPrivilegedMfaEvent,
  type PrivilegedMfaStatus,
} from "@/lib/privileged-mfa-status.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function browserPrivilegedMfaApi(): PrivilegedMfaApi {
  return supabase.auth.mfa as unknown as PrivilegedMfaApi;
}

type PendingEnrolment = { factorId: string; qrSrc: string | null; manualKey: string };

export type PrivilegedMfaPanelProps = {
  /** manage: /platform/security page. step-up: shown when a privileged action was refused. */
  purpose: "manage" | "step-up";
  stepUpReason?: PrivilegedMfaErrorCode | null;
  onSatisfied?: () => void;
  onCancel?: () => void;
};

/**
 * Privileged TOTP setup / verification. Nothing starts automatically: enrolment and
 * verification only run on explicit user action. The entered code is cleared after
 * every attempt and never leaves this component except in the verify() call.
 */
export function PrivilegedMfaPanel({ purpose, stepUpReason, onSatisfied, onCancel }: PrivilegedMfaPanelProps) {
  const api = useMemo(() => browserPrivilegedMfaApi(), []);
  const statusFn = useServerFn(getMyPrivilegedMfaStatus);
  const recordFn = useServerFn(recordMyPrivilegedMfaEvent);

  const [factors, setFactors] = useState<TotpFactorState | null>(null);
  const [status, setStatus] = useState<PrivilegedMfaStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingEnrolment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [verifiedNow, setVerifiedNow] = useState(false);
  const [reverifying, setReverifying] = useState(false);

  const refresh = useCallback(async (): Promise<PrivilegedMfaStatus | null> => {
    setLoadError(null);
    const [loaded, serverStatus] = await Promise.all([
      loadTotpFactors(api),
      statusFn().catch(() => null),
    ]);
    if (!loaded.ok) {
      setLoadError(loaded.message);
      return null;
    }
    setFactors({ verified: loaded.verified, unverified: loaded.unverified });
    setStatus(serverStatus);
    return serverStatus;
  }, [api, statusFn]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => () => setPending(null), []);

  const serverConfirm = useCallback(async (): Promise<ServerAssurance> => {
    const s = await statusFn();
    return { claimsVerified: s.claimsVerified, aal: s.aal };
  }, [statusFn]);

  const report = useCallback(
    (event: "enrolled" | "verified" | "challenge_failed", factorId?: string) => {
      void recordFn({ data: { event, ...(factorId ? { factorId } : {}) } }).catch(() => {
        /* audit reporting never blocks the user */
      });
    },
    [recordFn],
  );

  const beginSetup = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const started = await startTotpEnrolment(api);
      if (started.kind === "error") {
        setMessage(started.message);
        return;
      }
      if (started.kind === "already_configured") {
        await refresh();
        return;
      }
      setPending({
        factorId: started.factorId,
        qrSrc: totpQrImageSrc(started.qrCode),
        manualKey: started.secret,
      });
    } finally {
      setBusy(false);
    }
  };

  const onResult = async (result: CompleteFlowResult, kind: "enrolled" | "verified") => {
    if (result.status === "verified_aal2") {
      const wasReverify = reverifying;
      setPending(null);
      setVerifiedNow(true);
      setReverifying(false);
      report(kind, result.factorId);
      const latest = await refresh();
      if (wasReverify && latest?.recentMfaAgeSec == null) {
        setMessage(
          "Your code was accepted, but the server still reports your previous authenticator check. A fresh check has not been recorded.",
        );
      }
      if (!wasReverify) onSatisfied?.();
      return;
    }
    if (result.stage === "verify") report("challenge_failed");
    setMessage(result.message);
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    const entered = code;
    setCode("");
    setBusy(true);
    setMessage(null);
    try {
      if (pending) {
        await onResult(
          await completeTotpEnrolment(api, { factorId: pending.factorId, code: entered, serverConfirm }),
          "enrolled",
        );
      } else {
        await onResult(await completeTotpChallenge(api, { code: entered, serverConfirm }), "verified");
      }
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-destructive">{loadError}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
          Try again
        </Button>
      </div>
    );
  }

  if (!factors) {
    return <p className="text-sm text-muted-foreground">Checking authenticator status…</p>;
  }

  const configured = factors.verified.length > 0;
  const sessionAal2 = status?.claimsVerified === true && status.aal === "aal2";
  const reverifyOffered = canOfferPrivilegedReverify({
    purpose,
    privilegedMfaRequired: status?.privilegedMfaRequired === true,
    verifiedFactorCount: factors.verified.length,
    status,
    enrolmentPending: Boolean(pending),
  });
  const reverifyActive = reverifying && reverifyOffered;
  const manageSatisfied =
    purpose === "manage" && configured && !pending && !reverifyActive && (sessionAal2 || verifiedNow);
  const showCodeForm = Boolean(pending) || (configured && !manageSatisfied);
  const freshnessLabel = purpose === "manage" ? describeServerMfaFreshness(status) : null;

  return (
    <div className="space-y-4 text-sm">
      {purpose === "step-up" ? (
        <p>
          {stepUpReason === "PRIVILEGED_REAUTH_REQUIRED"
            ? "This action needs a recent authenticator check. Enter a code to continue; the action runs only after verification succeeds."
            : "Platform administration requires authenticator verification. Enter a code to continue; the action runs only after verification succeeds."}
        </p>
      ) : null}

      {status?.isBreakGlass ? (
        <p className="rounded-md border border-amber-800/30 bg-amber-50 px-3 py-2 text-amber-950 dark:bg-amber-950/40 dark:text-amber-50">
          Break-glass identity: the same authenticator app check applies. There is no SMS, email or bypass
          alternative.
        </p>
      ) : null}

      {!configured && !pending ? (
        <div className="space-y-3">
          <p>No authenticator app is configured for this account.</p>
          {factors.unverified.length > 0 ? (
            <p className="text-muted-foreground">
              An unfinished setup was found. Starting setup again replaces it; it was never active.
            </p>
          ) : null}
          <Button type="button" onClick={() => void beginSetup()} disabled={busy}>
            {busy ? "Starting…" : "Set up authenticator app"}
          </Button>
        </div>
      ) : null}

      {pending ? (
        <div className="space-y-3">
          <p>
            Scan this QR code with your authenticator app, then enter the 6-digit code it shows. Setup is not
            complete until the code is verified.
          </p>
          {pending.qrSrc ? (
            <img src={pending.qrSrc} alt="Authenticator setup QR code" className="h-44 w-44 rounded-md bg-white p-2" />
          ) : null}
          <p className="text-muted-foreground">
            Or enter this key manually: <span className="font-mono break-all">{pending.manualKey}</span>
          </p>
        </div>
      ) : null}

      {configured && purpose === "manage" && !pending ? (
        <div className="space-y-2">
          <p className="font-medium">Authenticator app configured</p>
          <ul className="list-disc pl-5 text-muted-foreground">
            {factors.verified.map((f) => (
              <li key={f.id}>
                {f.friendlyName ?? "Authenticator app"}
                {f.createdAt ? ` — added ${new Date(f.createdAt).toLocaleDateString()}` : ""}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            {manageSatisfied || reverifyActive
              ? "This session is verified with your authenticator app."
              : "This session has not been verified with your authenticator app yet."}
          </p>
          {freshnessLabel ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-muted-foreground">{freshnessLabel}</p>
              <Button type="button" variant="ghost" size="sm" onClick={() => void refresh()} disabled={busy}>
                Refresh
              </Button>
            </div>
          ) : null}
          {reverifyOffered && !reverifyActive ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setMessage(null);
                setCode("");
                setReverifying(true);
              }}
              disabled={busy}
            >
              Verify again now
            </Button>
          ) : null}
        </div>
      ) : null}

      {showCodeForm ? (
        <form onSubmit={(e) => void submitCode(e)} className="space-y-2">
          <Label htmlFor="privileged-mfa-code">Authenticator code</Label>
          <Input
            id="privileged-mfa-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="max-w-40 font-mono tracking-widest"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || code.length !== 6}>
              {busy ? "Verifying…" : "Verify"}
            </Button>
            {onCancel ? (
              <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
            ) : reverifyActive ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCode("");
                  setReverifying(false);
                }}
                disabled={busy}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      ) : onCancel ? (
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      ) : null}

      {message ? <p className="text-destructive">{message}</p> : null}
    </div>
  );
}
