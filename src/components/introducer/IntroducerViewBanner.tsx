import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { listIntroducersForAdmin } from "@/lib/introducer.functions";
import { getIntroducerView, setIntroducerView } from "@/lib/introducer-view";
import { recordViewAsAudit } from "@/lib/view-as-audit.functions";
import { Eye } from "lucide-react";

function defaultIntroducerId(
  introducers: { userId: string; company_name: string | null; full_name: string | null; email: string | null }[],
): string {
  const mabbott = introducers.find((i) => {
    const hay = [i.company_name, i.full_name, i.email].filter(Boolean).join(" ").toLowerCase();
    return hay.includes("mabbott");
  });
  if (mabbott) return mabbott.userId;
  const testOne = introducers.find((i) => i.email?.toLowerCase() === "1@test.co.uk");
  if (testOne) return testOne.userId;
  return introducers[0]?.userId ?? "";
}

function introducerLabel(i: {
  company_name: string | null;
  full_name: string | null;
  email: string | null;
}): string {
  const name = i.company_name || i.full_name || i.email || "Introducer";
  return i.email && i.email !== name ? `${name} · ${i.email}` : name;
}

export function IntroducerViewBanner({ onViewChange }: { onViewChange: () => void }) {
  const listFn = useServerFn(listIntroducersForAdmin);
  const auditFn = useServerFn(recordViewAsAudit);
  const introducersQ = useQuery({
    queryKey: ["introducers-for-admin"],
    queryFn: () => listFn(),
  });
  const [pickId, setPickId] = useState("");
  const active = getIntroducerView();
  const introducers = introducersQ.data ?? [];

  useEffect(() => {
    if (pickId || introducers.length === 0) return;
    setPickId(defaultIntroducerId(introducers));
  }, [introducers, pickId]);

  if (active) {
    return (
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
        <div className="text-sm">
          <span className="font-medium">Introducer view active</span>
          <span className="text-muted-foreground">
            {" "}
            — viewing as {active.companyName || active.introducerName}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Eye className="w-4 h-4" />
        View as introducer
      </div>
      <p className="text-xs text-muted-foreground">
        See and manage the introducer portal as a selected introducer — book appointments, update
        details, and send links on their behalf. All changes are logged below.
      </p>
      {introducersQ.isLoading && (
        <p className="text-sm text-muted-foreground">Loading introducers…</p>
      )}
      {!introducersQ.isLoading && introducers.length === 0 && (
        <p className="text-sm text-muted-foreground">No introducers yet — provision one via Manage → Test accounts or Team roles.</p>
      )}
      {introducers.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <div className="flex-1 space-y-1">
            <Label className="text-xs">Introducer</Label>
            <select
              className="w-full h-9 rounded-md border bg-background px-2 text-sm"
              value={pickId}
              onChange={(e) => setPickId(e.target.value)}
            >
              <option value="">Select introducer…</option>
              {introducers.map((i) => (
                <option key={i.userId} value={i.userId}>
                  {introducerLabel(i)}
                  {i.company_code ? ` · code ${i.company_code}` : ""}
                </option>
              ))}
            </select>
          </div>
          <Button
            size="sm"
            disabled={!pickId}
            onClick={async () => {
              const picked = introducers.find((i) => i.userId === pickId);
              if (!picked) return;
              const label = introducerLabel(picked);
              setIntroducerView({
                userId: picked.userId,
                introducerName: picked.full_name || picked.email || "Introducer",
                companyName: picked.company_name,
              });
              try {
                await auditFn({
                  data: {
                    viewType: "introducer",
                    targetUserId: picked.userId,
                    action: "enter_view",
                    summary: `Entered introducer view as ${label}`,
                  },
                });
              } catch {
                /* audit table may not exist yet */
              }
              onViewChange();
            }}
          >
            Enter introducer view
          </Button>
        </div>
      )}
    </div>
  );
}
