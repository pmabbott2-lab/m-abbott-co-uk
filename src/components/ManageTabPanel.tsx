import type { ReactNode } from "react";
import { Palette, Phone, TestTube2, UserPlus, Users } from "lucide-react";
import { ThemeProfilePicker } from "@/components/ThemeProfilePicker";
import { TestAccountsCard } from "@/components/TestAccountsCard";
import { TelephonyManagePanel } from "@/components/TelephonyManagePanel";
import { HubSubNav } from "@/components/ui/tabs";

/** Stable Manage sub-tab ids under Management → Manage. */
export const MANAGE_SUB_TABS = {
  TEAM_ROLES: "team-roles",
  COLOUR_SCHEME: "colour-scheme",
  TEST_ACCOUNTS: "test-accounts",
  TELEPHONY: "telephony",
  INVITES: "invites",
  REFER_A_FRIEND: "refer-a-friend",
} as const;

export type ManageSubTabId = (typeof MANAGE_SUB_TABS)[keyof typeof MANAGE_SUB_TABS];

type ManageTabPanelProps = {
  isOwner: boolean;
  showTeamRoles: boolean;
  showInvites: boolean;
  teamRolesPanel: ReactNode;
  invitesPanel: ReactNode;
};

type SubTabDef = {
  id: ManageSubTabId;
  label: string;
  icon: ReactNode;
  content: ReactNode;
};

export function ManageTabPanel({
  isOwner,
  showTeamRoles,
  showInvites,
  teamRolesPanel,
  invitesPanel,
}: ManageTabPanelProps) {
  const tabs: SubTabDef[] = [];

  if (showTeamRoles) {
    tabs.push({
      id: MANAGE_SUB_TABS.TEAM_ROLES,
      label: "Team roles",
      icon: <Users className="w-4 h-4 shrink-0" />,
      content: teamRolesPanel,
    });
  }

  if (isOwner) {
    tabs.push({
      id: MANAGE_SUB_TABS.TELEPHONY,
      label: "Telephony",
      icon: <Phone className="w-4 h-4 shrink-0" />,
      content: <TelephonyManagePanel />,
    });
    tabs.push({
      id: MANAGE_SUB_TABS.COLOUR_SCHEME,
      label: "Colour scheme",
      icon: <Palette className="w-4 h-4 shrink-0" />,
      content: <ThemeProfilePicker />,
    });
    tabs.push({
      id: MANAGE_SUB_TABS.TEST_ACCOUNTS,
      label: "Test accounts",
      icon: <TestTube2 className="w-4 h-4 shrink-0" />,
      content: <TestAccountsCard />,
    });
  }

  if (showInvites) {
    tabs.push({
      id: MANAGE_SUB_TABS.INVITES,
      label: "Invites",
      icon: <UserPlus className="w-4 h-4 shrink-0" />,
      content: invitesPanel,
    });
  }

  if (tabs.length === 0) return null;

  if (tabs.length === 1) {
    return <div className="space-y-6">{tabs[0].content}</div>;
  }

  return (
    <HubSubNav
      tabs={tabs}
      defaultValue={tabs[0].id}
      persistKey="mortgage-hub:staff-manage-sub"
    />
  );
}
