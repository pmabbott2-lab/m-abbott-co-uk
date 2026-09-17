import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { PoundSterling } from "lucide-react";
import { MyCommissionBranchPanel } from "@/components/MyCommissionStatementPanel";
import { Label } from "@/components/ui/label";
import { listAdvisors } from "@/lib/sessions.functions";

/** Finance → Advisor commission statements — filter by advisor (owner/supervisor/admin). */
export function AdvisorCommissionStatementsPanel() {
  const advisorsFn = useServerFn(listAdvisors);
  const advisorsQ = useQuery({
    queryKey: ["advisors-list"],
    queryFn: () => advisorsFn(),
  });

  const advisors = advisorsQ.data ?? [];
  const [advisorId, setAdvisorId] = useState("");

  const picked = advisors.find((a) => a.id === advisorId);
  const advisorName = picked?.full_name || picked?.email || null;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <PoundSterling className="w-4 h-4" />
          Advisor commission statements
        </div>
        <p className="text-xs text-muted-foreground">
          View Summary and Pipeline for any advisor — the same statement they see under Finance → My
          commission. You can also open an advisor&apos;s statement from Management → View → Advisor
          view.
        </p>
        <div className="space-y-1 max-w-md">
          <Label className="text-xs">Advisor</Label>
          <select
            className="w-full h-9 rounded-md border bg-background px-2 text-sm"
            value={advisorId}
            onChange={(e) => setAdvisorId(e.target.value)}
            disabled={advisorsQ.isLoading}
          >
            <option value="">
              {advisorsQ.isLoading ? "Loading advisors…" : "Select an advisor…"}
            </option>
            {advisors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.full_name || a.email || a.id}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!advisorId && !advisorsQ.isLoading && (
        <p className="text-sm text-muted-foreground">Choose an advisor to load their commission statement.</p>
      )}

      {advisorId && (
        <MyCommissionBranchPanel
          key={advisorId}
          viewAsUserId={advisorId}
          title={advisorName ? `${advisorName}'s commission` : "Advisor commission"}
          description="Commission earned from cases, introducer referrals, and Refer-a-Friend bonuses for this advisor."
        />
      )}
    </div>
  );
}
