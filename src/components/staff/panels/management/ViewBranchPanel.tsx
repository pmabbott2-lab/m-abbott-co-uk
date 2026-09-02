import type { ReactNode } from "react";
import {
  VIEW_SUB_TABS,
  defaultViewSubTab,
  type StaffBranchVisibility,
} from "@/lib/staff-branch-nav";
import { AdvisorViewPanel } from "@/components/staff/panels/management/AdvisorViewPanel";
import { IntroducerViewPanel } from "@/components/staff/panels/management/IntroducerViewPanel";
import { CustomerViewPanel } from "@/components/staff/panels/management/CustomerViewPanel";
import { Eye, Link2, Users } from "lucide-react";
import { HubSubNav } from "@/components/ui/tabs";

type ViewBranchPanelProps = {
  visibility: StaffBranchVisibility;
  isOwner: boolean;
  isSupervisor: boolean;
  isMainAdmin: boolean;
  onAdvisorViewChange: () => void;
  onIntroducerViewChange: () => void;
  onCustomerViewChange: () => void;
};

export function ViewBranchPanel({
  visibility,
  isOwner,
  isSupervisor,
  isMainAdmin,
  onAdvisorViewChange,
  onIntroducerViewChange,
  onCustomerViewChange,
}: ViewBranchPanelProps) {
  const tabs: { id: string; label: string; icon: ReactNode; content: ReactNode }[] = [];

  if (visibility.view.advisor) {
    tabs.push({
      id: VIEW_SUB_TABS.ADVISOR,
      label: "Advisor view",
      icon: <Eye className="w-4 h-4 shrink-0" />,
      content: (
        <AdvisorViewPanel
          onViewChange={onAdvisorViewChange}
          isOwner={isOwner}
          isSupervisor={isSupervisor}
          isMainAdmin={isMainAdmin}
        />
      ),
    });
  }

  if (visibility.view.introducer) {
    tabs.push({
      id: VIEW_SUB_TABS.INTRODUCER,
      label: "Introducer view",
      icon: <Link2 className="w-4 h-4 shrink-0" />,
      content: <IntroducerViewPanel onViewChange={onIntroducerViewChange} />,
    });
  }

  if (visibility.view.customer) {
    tabs.push({
      id: VIEW_SUB_TABS.CUSTOMER,
      label: "Customer view",
      icon: <Users className="w-4 h-4 shrink-0" />,
      content: <CustomerViewPanel onViewChange={onCustomerViewChange} />,
    });
  }

  if (tabs.length === 0) return null;
  if (tabs.length === 1) return <div className="space-y-4">{tabs[0].content}</div>;

  return <HubSubNav tabs={tabs} defaultValue={defaultViewSubTab(visibility)} />;
}
