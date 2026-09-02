import { useServerFn } from "@tanstack/react-start";
import { getIntroducerView, clearIntroducerView } from "@/lib/introducer-view";
import { recordViewAsAudit } from "@/lib/view-as-audit.functions";
import { IntroducerPortalContent } from "@/components/introducer/IntroducerPortalContent";
import { IntroducerViewBanner } from "@/components/introducer/IntroducerViewBanner";
import { ViewAsAuditPanel } from "@/components/ViewAsAuditPanel";
import { ViewAsExitFooter } from "@/components/ViewAsExitFooter";

type IntroducerViewPanelProps = {
  onViewChange: () => void;
};

export function IntroducerViewPanel({ onViewChange }: IntroducerViewPanelProps) {
  const active = getIntroducerView();
  const auditFn = useServerFn(recordViewAsAudit);

  const handleExit = async () => {
    if (active) {
      try {
        await auditFn({
          data: {
            viewType: "introducer",
            targetUserId: active.userId,
            action: "exit_view",
            summary: `Exited introducer view for ${active.companyName || active.introducerName}`,
          },
        });
      } catch {
        /* non-fatal */
      }
    }
    clearIntroducerView();
    onViewChange();
  };

  return (
    <div className="space-y-4">
      <IntroducerViewBanner onViewChange={onViewChange} />
      {active ? (
        <>
          <IntroducerPortalContent
            embedded
            viewAsIntroducerUserId={active.userId}
            viewAsLabel={active.companyName || active.introducerName}
          />
          <ViewAsAuditPanel viewType="introducer" targetUserId={active.userId} />
          <ViewAsExitFooter label="Exit introducer view" onExit={handleExit} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Select an introducer above — defaults to Mabbott or test account 1@test.co.uk when
          available — then enter view to see and manage their portal exactly as they would.
        </p>
      )}
    </div>
  );
}
