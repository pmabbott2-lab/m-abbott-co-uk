import { CalendarDays, Settings } from "lucide-react";
import {
  defaultDiarySubTab,
  DIARY_SUB_TABS,
  getStaffBranchVisibility,
  type StaffBranchNavContext,
  type StaffBranchVisibility,
} from "@/lib/staff-branch-nav";
import { AdvisorDiaryPanel } from "@/components/staff/panels/diary/AdvisorDiaryPanel";
import { AllAppointmentsGridPanel } from "@/components/staff/panels/diary/AllAppointmentsGridPanel";
import { DiarySettingsPanel } from "@/components/staff/panels/diary/DiarySettingsPanel";
import { HubSubNav, type HubSubNavTab } from "@/components/ui/tabs";

type DiaryTabsPanelProps = {
  visibility: StaffBranchVisibility;
  isStaffAdvisor: boolean;
  viewAsAdvisorId?: string;
  teamsSearch?: { teams?: string; reason?: string };
  readOnly?: boolean;
};

export function DiaryTabsPanel({
  visibility,
  isStaffAdvisor,
  viewAsAdvisorId,
  teamsSearch,
  readOnly = false,
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
          showTeamsLink={!viewAsAdvisorId && !readOnly}
          readOnly={readOnly}
          title={isStaffAdvisor ? "Your diary" : "Advisor diary"}
          description={
            readOnly
              ? "Confirmed upcoming appointments. Read-only — amendments are not available."
              : isStaffAdvisor
                ? "Your upcoming customer appointments. Link Microsoft Teams to sync meetings when you book or amend slots."
                : "Filter by advisor name or code to view confirmed upcoming appointments. Connect Teams on your own advisor account from Diary."
          }
          teamsSearch={teamsSearch}
        />
      ),
    });
  }

  if (visibility.diary.diarySettings && !readOnly) {
    tabs.push({
      id: DIARY_SUB_TABS.DIARY_SETTINGS,
      label: "Diary settings",
      icon: <Settings className="w-4 h-4 shrink-0" />,
      content: (
        <DiarySettingsPanel
          viewAsAdvisorId={viewAsAdvisorId}
          allowAdvisorFilter={!isStaffAdvisor && !viewAsAdvisorId}
        />
      ),
    });
  }

  if (visibility.diary.allAppointments) {
    tabs.push({
      id: DIARY_SUB_TABS.ALL_APPOINTMENTS,
      label: "All appointments",
      icon: <CalendarDays className="w-4 h-4 shrink-0" />,
      content: <AllAppointmentsGridPanel readOnly={readOnly} />,
    });
  }

  if (tabs.length === 0) return null;
  if (tabs.length === 1) return <div className="space-y-4">{tabs[0].content}</div>;

  return <HubSubNav tabs={tabs} defaultValue={defaultDiarySubTab(visibility)} />;
}

export function getDiaryVisibility(ctx: StaffBranchNavContext) {
  return getStaffBranchVisibility(ctx);
}
