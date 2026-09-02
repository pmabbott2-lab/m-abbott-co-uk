import { useServerFn } from "@tanstack/react-start";
import { CustomerPortalPreview } from "@/components/customer/CustomerPortalPreview";
import { CustomerViewBanner } from "@/components/customer/CustomerViewBanner";
import { ViewAsAuditPanel } from "@/components/ViewAsAuditPanel";
import { ViewAsExitFooter } from "@/components/ViewAsExitFooter";
import { clearCustomerView, getCustomerView } from "@/lib/customer-view";
import { recordViewAsAudit } from "@/lib/view-as-audit.functions";

type CustomerViewPanelProps = {
  onViewChange: () => void;
};

export function CustomerViewPanel({ onViewChange }: CustomerViewPanelProps) {
  const active = getCustomerView();
  const auditFn = useServerFn(recordViewAsAudit);

  const handleExit = async () => {
    if (active) {
      try {
        await auditFn({
          data: {
            viewType: "customer",
            targetUserId: active.customerId,
            action: "exit_view",
            summary: `Exited customer view for ${active.customerName}`,
          },
        });
      } catch {
        /* non-fatal */
      }
    }
    clearCustomerView();
    onViewChange();
  };

  return (
    <div className="space-y-4">
      <CustomerViewBanner onViewChange={onViewChange} />
      {active ? (
        <>
          <CustomerPortalPreview
            viewAsCustomerUserId={active.customerId}
            customerName={active.customerName}
          />
          <ViewAsAuditPanel viewType="customer" targetUserId={active.customerId} />
          <ViewAsExitFooter label="Exit customer view" onExit={handleExit} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Select a customer and enter view to preview their portal inline — fact-finds, cases, and
          journey progress.
        </p>
      )}
    </div>
  );
}
