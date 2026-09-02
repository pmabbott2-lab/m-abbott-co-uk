import { canView, type AdminAccess } from "@/lib/admin-access";
import {
  AdvisorAccessCard,
  IntroducerAccessCard,
  RecentlyDeletedCard,
} from "@/components/staff/panels/staff-panels";

type TeamRolesPanelProps = {
  adminAccess: AdminAccess | null;
  isOwner: boolean;
  isSupervisor: boolean;
};

export function TeamRolesPanel({ adminAccess, isOwner, isSupervisor }: TeamRolesPanelProps) {
  const showAdvisors = isOwner || isSupervisor || canView(adminAccess, "advisors");
  const showIntroducers = isOwner || isSupervisor || canView(adminAccess, "introducers");
  const showDeleted = isOwner || isSupervisor;

  if (!showAdvisors && !showIntroducers && !showDeleted) {
    return (
      <p className="text-sm text-muted-foreground">
        You don&apos;t have permission to manage team roles.
      </p>
    );
  }

  return (
    <div className="space-y-8 [&>div]:!mt-0">
      {showAdvisors && <AdvisorAccessCard />}
      {showIntroducers && <IntroducerAccessCard />}
      {showDeleted && <RecentlyDeletedCard />}
    </div>
  );
}

/** @deprecated Use TeamRolesPanel */
export const TeamAccessPanel = TeamRolesPanel;
