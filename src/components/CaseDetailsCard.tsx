import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCaseMortgageDetails, upsertCaseMortgageDetails } from "@/lib/case-details.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export function CaseDetailsCard({
  sessionId,
  canEdit,
}: {
  sessionId: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const getFn = useServerFn(getCaseMortgageDetails);
  const saveFn = useServerFn(upsertCaseMortgageDetails);

  const q = useQuery({
    queryKey: ["case-mortgage", sessionId],
    queryFn: () => getFn({ data: { sessionId } }),
  });

  const details = q.data?.details;

  const [currentLender, setCurrentLender] = useState("");
  const [productExpiryDate, setProductExpiryDate] = useState("");
  const [amountBorrowed, setAmountBorrowed] = useState("");
  const [houseValuation, setHouseValuation] = useState("");
  const [currentRate, setCurrentRate] = useState("");
  const [monthlyPayment, setMonthlyPayment] = useState("");

  useEffect(() => {
    if (!details) return;
    setCurrentLender(details.currentLender ?? "");
    setProductExpiryDate(details.productExpiryDate ?? "");
    setAmountBorrowed(
      details.amountBorrowedPence != null ? String(details.amountBorrowedPence / 100) : "",
    );
    setHouseValuation(
      details.houseValuationPence != null ? String(details.houseValuationPence / 100) : "",
    );
    setCurrentRate(details.currentRatePct != null ? String(details.currentRatePct) : "");
    setMonthlyPayment(
      details.monthlyPaymentPence != null ? String(details.monthlyPaymentPence / 100) : "",
    );
  }, [details]);

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          sessionId,
          currentLender: currentLender || null,
          productExpiryDate: productExpiryDate || null,
          amountBorrowedPounds: amountBorrowed ? Number(amountBorrowed) : null,
          houseValuationPounds: houseValuation ? Number(houseValuation) : null,
          currentRatePct: currentRate ? Number(currentRate) : null,
          monthlyPaymentPounds: monthlyPayment ? Number(monthlyPayment) : null,
        },
      }),
    onSuccess: () => {
      toast.success("Case details saved");
      qc.invalidateQueries({ queryKey: ["case-mortgage", sessionId] });
      qc.invalidateQueries({ queryKey: ["relationship-pipeline"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  if (q.data?.migrationRequired) {
    return (
      <div className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
        Run <code className="text-xs">supabase/RUN_JOURNEY_FINANCE_CASE.sql</code> to enable case mortgage
        details.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-card p-5 space-y-4">
      <div>
        <h3 className="font-semibold">Case details</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Current lender, ERC / product expiry, and figures for relationship management and renewals.
          Update as the case progresses (AIP → offer → completion).
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Current lender</label>
          <Input
            value={currentLender}
            onChange={(e) => setCurrentLender(e.target.value)}
            disabled={!canEdit}
            placeholder="e.g. Barclays"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Product expiry / ERC end</label>
          <Input
            type="date"
            value={productExpiryDate}
            onChange={(e) => setProductExpiryDate(e.target.value)}
            disabled={!canEdit}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Amount borrowed (£)</label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={amountBorrowed}
            onChange={(e) => setAmountBorrowed(e.target.value)}
            disabled={!canEdit}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">House valuation (£)</label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={houseValuation}
            onChange={(e) => setHouseValuation(e.target.value)}
            disabled={!canEdit}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Current rate (%)</label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={currentRate}
            onChange={(e) => setCurrentRate(e.target.value)}
            disabled={!canEdit}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Monthly payment (£)</label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={monthlyPayment}
            onChange={(e) => setMonthlyPayment(e.target.value)}
            disabled={!canEdit}
          />
        </div>
      </div>

      {details?.actionableFromDate && (
        <p className="text-sm text-muted-foreground">
          Actionable from <strong className="text-foreground">{details.actionableFromDate}</strong>
          {details.actionableNote ? ` — ${details.actionableNote}` : ""}
        </p>
      )}

      {canEdit && (
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save case details"}
        </Button>
      )}
    </div>
  );
}
