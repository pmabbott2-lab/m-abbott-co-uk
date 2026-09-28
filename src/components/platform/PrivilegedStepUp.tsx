import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { PrivilegedMfaErrorCode } from "@/lib/privileged-mfa";
import { createStepUpCoordinator, runWithPrivilegedStepUp } from "@/lib/privileged-mfa-flow";
import { PrivilegedMfaPanel } from "@/components/platform/PrivilegedMfaPanel";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type StepUpRunner = <T>(operation: () => Promise<T>) => Promise<T>;

const passThrough: StepUpRunner = (operation) => operation();

const PrivilegedStepUpContext = createContext<StepUpRunner | null>(null);

type PendingStepUp = { reason: PrivilegedMfaErrorCode; resolve: (ok: boolean) => void };

/**
 * Mount around privileged UI. When a server call is refused with PRIVILEGED_REAUTH_REQUIRED /
 * PRIVILEGED_AAL_REQUIRED, shows the authenticator prompt and retries the call once after
 * AAL2 is confirmed. Cancelling surfaces the original refusal; nothing is retried.
 */
export function PrivilegedStepUpProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingStepUp | null>(null);
  const pendingRef = useRef<PendingStepUp | null>(null);

  const requestStepUp = useMemo(
    () =>
      createStepUpCoordinator(
        (reason) =>
          new Promise<boolean>((resolve) => {
            const next = { reason, resolve };
            pendingRef.current = next;
            setPending(next);
          }),
      ),
    [],
  );

  const finish = useCallback((ok: boolean) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(ok);
  }, []);

  const run = useCallback<StepUpRunner>(
    (operation) => runWithPrivilegedStepUp(operation, requestStepUp),
    [requestStepUp],
  );

  return (
    <PrivilegedStepUpContext.Provider value={run}>
      {children}
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) finish(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Verify with your authenticator app</DialogTitle>
            <DialogDescription>
              The requested action has not been carried out. It will run once, after verification succeeds.
            </DialogDescription>
          </DialogHeader>
          {pending ? (
            <PrivilegedMfaPanel
              purpose="step-up"
              stepUpReason={pending.reason}
              onSatisfied={() => finish(true)}
              onCancel={() => finish(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </PrivilegedStepUpContext.Provider>
  );
}

export function usePrivilegedStepUp(): StepUpRunner {
  return useContext(PrivilegedStepUpContext) ?? passThrough;
}

/** Wraps a server function so privileged MFA refusals trigger step-up + a single retry. */
export function useStepUpServerFn<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  const run = usePrivilegedStepUp();
  return useCallback((...args: A) => run(() => fn(...args)), [run, fn]);
}
