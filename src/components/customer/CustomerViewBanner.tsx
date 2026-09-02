import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { listCustomersForAdmin } from "@/lib/sessions.functions";
import { getCustomerView, setCustomerView } from "@/lib/customer-view";
import { recordViewAsAudit } from "@/lib/view-as-audit.functions";
import { Eye } from "lucide-react";

function customerLabel(c: {
  full_name: string | null;
  email: string | null;
  phone: string | null;
}): string {
  const name = c.full_name || c.email || "Customer";
  return c.email && c.email !== name ? `${name} · ${c.email}` : name;
}

export function CustomerViewBanner({ onViewChange }: { onViewChange: () => void }) {
  const listFn = useServerFn(listCustomersForAdmin);
  const auditFn = useServerFn(recordViewAsAudit);
  const customersQ = useQuery({
    queryKey: ["customers-for-admin"],
    queryFn: () => listFn(),
  });
  const [pickId, setPickId] = useState("");
  const active = getCustomerView();
  const customers = customersQ.data ?? [];

  useEffect(() => {
    if (pickId || customers.length === 0) return;
    const testSix = customers.find((c) => c.email?.toLowerCase() === "6@test.co.uk");
    setPickId(testSix?.userId ?? customers[0]?.userId ?? "");
  }, [customers, pickId]);

  if (active) {
    return (
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
        <div className="text-sm">
          <span className="font-medium">Customer view active</span>
          <span className="text-muted-foreground"> — viewing as {active.customerName}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Eye className="w-4 h-4" />
        View as customer
      </div>
      <p className="text-xs text-muted-foreground">
        See the customer portal — fact-finds, journey, and cases — exactly as they would without
        signing in as them.
      </p>
      {customersQ.isLoading && (
        <p className="text-sm text-muted-foreground">Loading customers…</p>
      )}
      {!customersQ.isLoading && customers.length === 0 && (
        <p className="text-sm text-muted-foreground">No customers yet.</p>
      )}
      {customers.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <div className="flex-1 space-y-1">
            <Label className="text-xs">Customer</Label>
            <select
              className="w-full h-9 rounded-md border bg-background px-2 text-sm"
              value={pickId}
              onChange={(e) => setPickId(e.target.value)}
            >
              <option value="">Select customer…</option>
              {customers.map((c) => (
                <option key={c.userId} value={c.userId}>
                  {customerLabel(c)}
                  {c.sessionCount ? ` · ${c.sessionCount} session${c.sessionCount === 1 ? "" : "s"}` : ""}
                </option>
              ))}
            </select>
          </div>
          <Button
            size="sm"
            disabled={!pickId}
            onClick={async () => {
              const picked = customers.find((c) => c.userId === pickId);
              if (!picked) return;
              const label = customerLabel(picked);
              setCustomerView({
                customerId: picked.userId,
                customerName: picked.full_name || picked.email || "Customer",
              });
              try {
                await auditFn({
                  data: {
                    viewType: "customer",
                    targetUserId: picked.userId,
                    action: "enter_view",
                    summary: `Entered customer view as ${label}`,
                  },
                });
              } catch {
                /* non-fatal */
              }
              onViewChange();
            }}
          >
            Enter customer view
          </Button>
        </div>
      )}
    </div>
  );
}
