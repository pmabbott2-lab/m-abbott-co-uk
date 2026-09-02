import { CalendarDays } from "lucide-react";
import {
  defaultDiarySubTab,
  DIARY_SUB_TABS,
  getStaffBranchVisibility,
  type StaffBranchNavContext,
  type StaffBranchVisibility,
} from "@/lib/staff-branch-nav";
import { AdvisorDiaryPanel } from "@/components/staff/panels/diary/AdvisorDiaryPanel";
import { AllAppointmentsGridPanel } from "@/components/staff/panels/diary/AllAppointmentsGridPanel";
import { HubSubNav, type HubSubNavTab } from "@/components/ui/tabs";

type DiaryTabsPanelProps = {
  visibility: StaffBranchVisibility;
  isStaffAdvisor: boolean;
  viewAsAdvisorId?: string;
  teamsSearch?: { teams?: string; reason?: string };
};

export function DiaryTabsPanel({
  visibility,
  isStaffAdvisor,
  viewAsAdvisorId,
  teamsSearch,
}: DiaryTabsPanelProps) {
  const tabs: HubSubNavTab[] = [];

  if (visibility.diary.myDiary) {
    tabs.push({
      id: DIARY_SUB_TABS.MY_DIARY,
      label: isStaffAdvisor ? "My diary" : "Diary",
      icon: <CalendarDays className="w-4 h-4 shrink-0" />,
      content: (
        <AdvisorDiaryPanel
          viewAsAdvisorId={viewAsAdvisorId}
          allowAdvisorFilter={!isStaffAdvisor && !viewAsAdvisorId}
          showTeamsLink={isStaffAdvisor && !viewAsAdvisorId}
          title={isStaffAdvisor ? "Your diary" : "Advisor diary"}
          description={
            isStaffAdvisor
              ? "Your upcoming customer appointments. Link Microsoft Teams to sync meetings when you book or amend slots."
              : "Filter by advisor name or code to view confirmed upcoming appointments."
          }
          teamsSearch={teamsSearch}
        />
      ),
    });
  }

  if (visibility.diary.allAppointments) {
    tabs.push({
      id: DIARY_SUB_TABS.ALL_APPOINTMENTS,
      label: "All appointments",
      icon: <CalendarDays className="w-4 h-4 shrink-0" />,
      content: <AllAppointmentsGridPanel />,
    });
  }

  if (tabs.length === 0) return null;
  if (tabs.length === 1) return <div className="space-y-4">{tabs[0].content}</div>;

  return <HubSubNav tabs={tabs} defaultValue={defaultDiarySubTab(visibility)} />;
}

export function getDiaryVisibility(ctx: StaffBranchNavContext) {
  return getStaffBranchVisibility(ctx);
}
