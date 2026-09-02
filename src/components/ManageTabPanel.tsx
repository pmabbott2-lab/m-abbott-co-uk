import type { ReactNode } from "react";
import { Gift, Palette, TestTube2, UserPlus, Users } from "lucide-react";
import { ThemeProfilePicker } from "@/components/ThemeProfilePicker";
import { TestAccountsCard } from "@/components/TestAccountsCard";
import { HubSubNav } from "@/components/ui/tabs";

/** Stable Manage sub-tab ids under Management → Manage. */
export const MANAGE_SUB_TABS = {
  TEAM_ROLES: "team-roles",
  COLOUR_SCHEME: "colour-scheme",
  TEST_ACCOUNTS: "test-accounts",
  INVITES: "invites",
  REFER_A_FRIEND: "refer-a-friend",
} as const;

export type ManageSubTabId = (typeof MANAGE_SUB_TABS)[keyof typeof MANAGE_SUB_TABS];

type ManageTabPanelProps = {
  isOwner: boolean;
  showTeamRoles: boolean;
  showInvites: boolean;
  showReferAFriend: boolean;
  teamRolesPanel: ReactNode;
  invitesPanel: ReactNode;
  referAFriendPanel: ReactNode;
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
  showReferAFriend,
  teamRolesPanel,
  invitesPanel,
  referAFriendPanel,
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

  if (showReferAFriend) {
    tabs.push({
      id: MANAGE_SUB_TABS.REFER_A_FRIEND,
      label: "Refer a friend",
      icon: <Gift className="w-4 h-4 shrink-0" />,
      content: referAFriendPanel,
    });
  }

  if (tabs.length === 0) return null;

  if (tabs.length === 1) {
    return <div className="space-y-6">{tabs[0].content}</div>;
  }

  return <HubSubNav tabs={tabs} defaultValue={tabs[0].id} />;
}
