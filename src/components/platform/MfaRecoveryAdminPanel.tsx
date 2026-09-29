import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  approveMfaRecovery,
  cancelMfaRecovery,
  executeMfaRecovery,
  listMfaRecoveryCandidates,
  listMfaRecoveryRequests,
  reissueMfaRecoveryGrant,
  requestMfaRecovery,
} from "@/lib/privileged-mfa-recovery.functions";
import {
  MFA_RECOVERY_REASON_MAX,
  MFA_RECOVERY_REASON_MIN,
  MFA_RECOVERY_STATUS_LABELS,
  MFA_RECOVERY_TARGET_KIND_LABELS,
  type MfaRecoveryIssuedGrant,
  type MfaRecoveryRequestRow,
} from "@/lib/privileged-mfa-recovery";
import { useStepUpServerFn } from "@/components/platform/PrivilegedStepUp";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

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

/**
 * G7F-3C3 operator controls. Every action needs a fresh authenticator check (step-up) and is
 * re-validated by the database. The one-time code is held only in component state until the
 * operator dismisses it.
 */
export function MfaRecoveryAdminPanel({ isBreakGlass }: { isBreakGlass: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listMfaRecoveryRequests);
  const candidatesFn = useServerFn(listMfaRecoveryCandidates);
  const requestFn = useStepUpServerFn(useServerFn(requestMfaRecovery));
  const approveFn = useStepUpServerFn(useServerFn(approveMfaRecovery));
  const executeFn = useStepUpServerFn(useServerFn(executeMfaRecovery));
  const reissueFn = useStepUpServerFn(useServerFn(reissueMfaRecoveryGrant));
  const cancelFn = useStepUpServerFn(useServerFn(cancelMfaRecovery));

  const [targetUserId, setTargetUserId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [issued, setIssued] = useState<(MfaRecoveryIssuedGrant & { targetLabel: string }) | null>(null);

  const listQ = useQuery({ queryKey: ["mfa-recovery-requests"], queryFn: () => listFn() });
  const candidatesQ = useQuery({
    queryKey: ["mfa-recovery-candidates"],
    queryFn: () => candidatesFn(),
    enabled: !isBreakGlass,
  });

  const run = async (op: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await op();
    } catch (err) {
      setMessage(errorMessage(err, fallback));
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ["mfa-recovery-requests"] });
    }
  };

  const submitRequest = () =>
    run(async () => {
      await requestFn({ data: { targetUserId, reason: reason.trim() } });
      setTargetUserId("");
      setReason("");
    }, "The recovery request was refused.");

  const execute = (row: MfaRecoveryRequestRow, reissue: boolean) =>
    run(async () => {
      const res = reissue
        ? await reissueFn({ data: { requestId: row.id } })
        : await executeFn({ data: { requestId: row.id } });
      setIssued({ ...res, targetLabel: row.targetLabel });
    }, "Recovery could not be run.");

  const reasonLength = reason.trim().length;
  const rows = listQ.data ?? [];

  return (
    <div className="space-y-4 text-sm">
      <div>
        <h3 className="text-base font-semibold">Authenticator recovery</h3>
        <p className="text-muted-foreground">
          For a Super Owner, Super Admin or break-glass account that has lost its authenticator app. Nobody can
          recover their own account. A Super Owner recovery waits for a cooling-off period unless a second Super Owner
          or break-glass approves. A Super Admin recovery can run straight away. A break-glass recovery needs two
          different Super Owners and the cooling-off period. Confirm the person's identity live (video or phone)
          before handing over the recovery code.
        </p>
      </div>

      {issued ? (
        <div className="space-y-2 rounded-md border border-amber-800/30 bg-amber-50 px-3 py-3 text-amber-950 dark:bg-amber-950/40 dark:text-amber-50">
          <p className="font-medium">One-time recovery code for {issued.targetLabel}</p>
          <p className="font-mono text-base tracking-wider break-all">{issued.grant}</p>
          <p>
            Shown once. It expires at {formatTime(issued.grantExpiresAt)}. Give it to the account holder directly after
            confirming who they are. Do not email, text or store it.
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => setIssued(null)}>
            I have handed it over
          </Button>
        </div>
      ) : null}

      {!isBreakGlass ? (
        <div className="space-y-2 rounded-md border px-3 py-3">
          <p className="font-medium">Start a recovery</p>
          <Label htmlFor="mfa-recovery-target">Account</Label>
          <select
            id="mfa-recovery-target"
            className="w-full rounded-md border bg-background px-2 py-1.5"
            value={targetUserId}
            onChange={(e) => setTargetUserId(e.target.value)}
            disabled={busy}
          >
            <option value="">Choose an account…</option>
            {(candidatesQ.data ?? []).map((c) => (
              <option key={c.userId} value={c.userId}>
                {c.label} ({MFA_RECOVERY_TARGET_KIND_LABELS[c.targetKind]})
              </option>
            ))}
          </select>
          <Label htmlFor="mfa-recovery-reason">Reason</Label>
          <textarea
            id="mfa-recovery-reason"
            className="min-h-20 w-full rounded-md border bg-background px-2 py-1.5"
            maxLength={MFA_RECOVERY_REASON_MAX}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
          />
          <Button
            type="button"
            size="sm"
            disabled={busy || !targetUserId || reasonLength < MFA_RECOVERY_REASON_MIN}
            onClick={() => void submitRequest()}
          >
            Request recovery
          </Button>
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="font-medium">Recent requests</p>
        {listQ.isLoading ? <p className="text-muted-foreground">Loading…</p> : null}
        {listQ.isError ? <p className="text-destructive">Requests could not be loaded.</p> : null}
        {!listQ.isLoading && rows.length === 0 ? <p className="text-muted-foreground">No recovery requests.</p> : null}
        {rows.map((row) => (
          <div key={row.id} className="space-y-1 rounded-md border px-3 py-2">
            <p className="font-medium">
              {row.targetLabel} · {MFA_RECOVERY_TARGET_KIND_LABELS[row.targetKind]} ·{" "}
              {MFA_RECOVERY_STATUS_LABELS[row.status]}
            </p>
            <p className="text-muted-foreground">
              Requested by {row.requestedByLabel} on {formatTime(row.createdAt)}
              {row.secondApprovedByLabel ? ` · approved by ${row.secondApprovedByLabel}` : ""}
            </p>
            <p className="text-muted-foreground">Reason: {row.reason}</p>
            {row.status === "requested" || row.status === "approved" ? (
              <p className="text-muted-foreground">
                Earliest run {formatTime(row.coolingOffUntil)} · expires {formatTime(row.expiresAt)}
              </p>
            ) : null}
            {row.status === "executed_awaiting_enrolment" ? (
              <p className="text-muted-foreground">
                Code expires {formatTime(row.grantExpiresAt)}
                {row.grantRedeemedAt ? ` · code used ${formatTime(row.grantRedeemedAt)}` : ""} · recovery must finish by{" "}
                {formatTime(row.expiresAt)}
              </p>
            ) : null}
            {row.terminalReason ? <p className="text-muted-foreground">Closed: {row.terminalReason}</p> : null}
            <div className="flex flex-wrap gap-2 pt-1">
              {row.status === "requested" && row.targetKind !== "super_admin" ? (
                <Button type="button" size="sm" variant="outline" disabled={busy}
                  onClick={() => void run(() => approveFn({ data: { requestId: row.id } }), "Approval was refused.")}>
                  Approve
                </Button>
              ) : null}
              {(row.status === "requested" || row.status === "approved") && !isBreakGlass ? (
                <Button type="button" size="sm" disabled={busy} onClick={() => void execute(row, false)}>
                  Run recovery
                </Button>
              ) : null}
              {row.status === "executed_awaiting_enrolment" && !isBreakGlass ? (
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void execute(row, true)}>
                  Issue new code
                </Button>
              ) : null}
              {row.status === "requested" || row.status === "approved" ? (
                <Button type="button" size="sm" variant="outline" disabled={busy}
                  onClick={() => void run(() => cancelFn({ data: { requestId: row.id } }), "Cancellation was refused.")}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {message ? <p className="text-destructive">{message}</p> : null}
    </div>
  );
}
