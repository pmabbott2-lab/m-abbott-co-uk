import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { listAdvisors } from "@/lib/sessions.functions";
import { clearAdvisorView, getAdvisorView, setAdvisorView } from "@/lib/advisor-view";
import { Eye, X } from "lucide-react";

export function AdvisorViewBanner({
  canUse,
  onViewChange,
}: {
  canUse: boolean;
  onViewChange: () => void;
}) {
  const advisorsFn = useServerFn(listAdvisors);
  const advisorsQ = useQuery({
    queryKey: ["advisors-list"],
    queryFn: () => advisorsFn(),
    enabled: canUse,
  });
  const [pickId, setPickId] = useState("");
  const active = getAdvisorView();

  if (!canUse) return null;

  if (active) {
    return (
      <div className="mb-4 rounded-xl border border-primary/30 bg-primary/5 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="text-sm">
          <span className="font-medium">Advisor view</span>
          <span className="text-muted-foreground"> — viewing as {active.advisorName}</span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            clearAdvisorView();
            onViewChange();
          }}
        >
          <X className="w-4 h-4 mr-1.5" />
          Exit advisor view
        </Button>
      </div>
    );
  }

  const advisors = advisorsQ.data ?? [];

  return (
    <div className="mb-4 rounded-xl border bg-muted/30 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Eye className="w-4 h-4" />
        View as advisor
      </div>
      <p className="text-xs text-muted-foreground">
        See the portal as a selected advisor. You can amend appointments and update customer details
        while in this mode.
      </p>
      <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
        <div className="flex-1 space-y-1">
          <Label className="text-xs">Advisor</Label>
          <select
            className="w-full h-9 rounded-md border bg-background px-2 text-sm"
            value={pickId}
            onChange={(e) => setPickId(e.target.value)}
          >
            <option value="">Select advisor…</option>
            {advisors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.full_name || a.email || a.id}
              </option>
            ))}
          </select>
        </div>
        <Button
          size="sm"
          disabled={!pickId}
          onClick={() => {
            const picked = advisors.find((a) => a.id === pickId);
            if (!picked) return;
            setAdvisorView({
              advisorId: picked.id,
              advisorName: picked.full_name || picked.email || "Advisor",
            });
            onViewChange();
          }}
        >
          Enter advisor view
        </Button>
      </div>
    </div>
  );
}

export function useAdvisorViewId(): string | undefined {
  return getAdvisorView()?.advisorId;
}
