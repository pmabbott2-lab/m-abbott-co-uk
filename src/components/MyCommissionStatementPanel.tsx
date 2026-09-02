import { BarChart3, PoundSterling, TrendingUp } from "lucide-react";
import { MyCommissionPipelinePanel } from "@/components/MyCommissionPipelinePanel";
import { MyCommissionSummaryPanel } from "@/components/MyCommissionSummaryPanel";
import { HubSubNav } from "@/components/ui/tabs";
import {
  MY_COMMISSION_SUB_TABS,
  defaultMyCommissionSubTab,
} from "@/lib/staff-branch-nav";

export type MyCommissionBranchPanelProps = {
  title?: string;
  description?: string;
  viewAsUserId?: string;
  /** When embedded (e.g. introducer portal), use compact sub-tab styling. */
  embedded?: boolean;
};

/** Finance → My commission (advisors only) or embedded view-as with Summary and Pipeline sub-tabs. */
export function MyCommissionBranchPanel({
  title = "My commission",
  description = "Commission earned from cases you worked on, introducer referrals, or Refer-a-Friend bonuses.",
  viewAsUserId,
  embedded = false,
}: MyCommissionBranchPanelProps) {
  const defaultTab = defaultMyCommissionSubTab();

  const subTabs = [
    {
      id: MY_COMMISSION_SUB_TABS.SUMMARY,
      label: (
        <>
          <BarChart3 className="w-4 h-4 shrink-0" />
          Summary
        </>
      ),
      content: <MyCommissionSummaryPanel title={title} viewAsUserId={viewAsUserId} />,
    },
    {
      id: MY_COMMISSION_SUB_TABS.PIPELINE,
      label: (
        <>
          <TrendingUp className="w-4 h-4 shrink-0" />
          Pipeline
        </>
      ),
      content: <MyCommissionPipelinePanel title={title} viewAsUserId={viewAsUserId} />,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="font-semibold text-lg flex items-center gap-2">
          <PoundSterling className="w-5 h-5" />
          {title}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>

      <HubSubNav tabs={subTabs} defaultValue={defaultTab} />
    </div>
  );
}

/** @deprecated Use MyCommissionBranchPanel — kept for existing imports during phase 4. */
export function MyCommissionStatementPanel(props: MyCommissionBranchPanelProps) {
  return <MyCommissionBranchPanel {...props} />;
}
