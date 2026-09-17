import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Pencil, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  amendCustomerIntroducer,
  getCustomerIntroducer,
  lookupIntroducerByCode,
  refreshCustomerIntroducerCommission,
} from "@/lib/introducer-customer.functions";

export function IntroducerContactBox({
  customerId,
  sessionId,
  canAmend,
  canRefresh,
  compact,
}: {
  customerId: string | null | undefined;
  sessionId?: string | null;
  canAmend: boolean;
  canRefresh: boolean;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const getFn = useServerFn(getCustomerIntroducer);
  const lookupFn = useServerFn(lookupIntroducerByCode);
  const amendFn = useServerFn(amendCustomerIntroducer);
  const refreshFn = useServerFn(refreshCustomerIntroducerCommission);

  const [amendOpen, setAmendOpen] = useState(false);
  const [code, setCode] = useState("");
  const [previewName, setPreviewName] = useState<string | null>(null);

  const introQ = useQuery({
    queryKey: ["customer-introducer", customerId, sessionId],
    queryFn: () => getFn({ data: { customerId: customerId!, sessionId: sessionId ?? undefined } }),
    enabled: Boolean(customerId),
  });

  const lookup = useMutation({
    mutationFn: () => lookupFn({ data: { companyCode: code } }),
    onSuccess: (res) => {
      setPreviewName(res.companyName ?? `Code ${res.companyCode}`);
      toast.success("Introducer found");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Lookup failed"),
  });

  const amend = useMutation({
    mutationFn: () =>
      amendFn({
        data: {
          customerId: customerId!,
          sessionId: sessionId ?? undefined,
          companyCode: code,
        },
      }),
    onSuccess: () => {
      toast.success("Introducer updated");
      setAmendOpen(false);
      setCode("");
      setPreviewName(null);
      qc.invalidateQueries({ queryKey: ["customer-introducer", customerId] });
      qc.invalidateQueries({ queryKey: ["advisor-contacts"] });
      qc.invalidateQueries({ queryKey: ["finance-audit"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not amend"),
  });

  const refresh = useMutation({
    mutationFn: () =>
      refreshFn({ data: { customerId: customerId!, sessionId: sessionId ?? undefined } }),
    onSuccess: (res) => {
      toast.success(`Commission refreshed (${res.adjusted} entries)`);
      qc.invalidateQueries({ queryKey: ["finance-ledger"] });
      qc.invalidateQueries({ queryKey: ["finance-audit"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not refresh"),
  });

  if (!customerId) return null;

  const info = introQ.data;
  const label = compact ? "text-[10px]" : "text-xs";

  return (
    <div
      className={`rounded-lg border bg-muted/20 ${compact ? "p-2 space-y-1" : "p-3 space-y-2"} min-w-0`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      role="presentation"
    >
      <div className={`${label} font-medium text-muted-foreground uppercase tracking-wide`}>
        Introducer
      </div>
      {introQ.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : info?.companyCode || info?.companyName ? (
        <div className="text-xs sm:text-sm">
          <div className="font-medium truncate">
            {info.isStaff ? `Staff: ${info.companyName ?? "Advisor"}` : (info.companyName ?? "Company")}
          </div>
          {info.companyCode && (
            <div className="font-mono text-muted-foreground">{info.companyCode}</div>
          )}
          {info.isStaff && (
            <div className="text-[10px] text-muted-foreground mt-0.5">
              Introducer commission (fee + mortgage fee) pays this staff member
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No introducer</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {canAmend && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => {
              setCode(info?.companyCode ?? "");
              setPreviewName(info?.companyName ?? null);
              setAmendOpen(true);
            }}
          >
            <Pencil className="w-3 h-3 mr-1" />
            Amend
          </Button>
        )}
        {canRefresh && info?.companyCode && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 text-xs"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            <RefreshCw className={`w-3 h-3 mr-1 ${refresh.isPending ? "animate-spin" : ""}`} />
            Refresh commission
          </Button>
        )}
      </div>

      <Dialog open={amendOpen} onOpenChange={setAmendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Amend introducer</DialogTitle>
            <DialogDescription>
              Enter the 4-digit company code. Commission stays with the previous introducer until
              the owner presses Refresh commission.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Company code</Label>
              <div className="flex gap-2">
                <Input
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 4));
                    setPreviewName(null);
                  }}
                  placeholder="1234"
                  maxLength={4}
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={code.length !== 4 || lookup.isPending}
                  onClick={() => lookup.mutate()}
                >
                  Look up
                </Button>
              </div>
            </div>
            {previewName && (
              <p className="text-sm rounded-md border bg-muted/40 p-2">
                <span className="text-muted-foreground">Company: </span>
                <span className="font-medium">{previewName}</span>
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAmendOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={code.length !== 4 || amend.isPending}
              onClick={() => amend.mutate()}
            >
              Save introducer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
