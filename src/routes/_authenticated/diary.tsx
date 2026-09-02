import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import {
  DiaryTabsPanel,
  getDiaryVisibility,
} from "@/components/staff/panels/diary/DiaryTabsPanel";
import { getAdvisorView } from "@/lib/advisor-view";
import { getMyRole } from "@/lib/sessions.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/diary")({
  validateSearch: (search: Record<string, unknown>) => ({
    teams: typeof search.teams === "string" ? search.teams : undefined,
    reason: typeof search.reason === "string" ? search.reason : undefined,
  }),
  component: AdvisorDiaryPage,
});

function AdvisorDiaryPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const roleFn = useServerFn(getMyRole);
  const advisorViewId = getAdvisorView()?.advisorId;

  const roleQ = useQuery({ queryKey: ["my-role"], queryFn: () => roleFn() });

  const isStaffAdvisor = Boolean(roleQ.data?.isAdvisor && !roleQ.data?.isMainAdmin);
  const isMainAdmin = Boolean(roleQ.data?.isMainAdmin);
  const visibility = roleQ.data
    ? getDiaryVisibility({
        isAdvisor: roleQ.data.isAdvisor ?? false,
        isMainAdmin,
        isOwner: roleQ.data.isOwner ?? false,
        isSupervisor: roleQ.data.isSupervisor ?? false,
        isIntroducer: false,
        adminAccess: roleQ.data.adminAccess ?? null,
      })
    : null;
  const canAccess = Boolean(visibility?.branches.diary);

  useEffect(() => {
    if (!roleQ.isSuccess) return;
    if (!canAccess) {
      navigate({ to: "/home" });
    }
  }, [roleQ.isSuccess, canAccess, navigate]);

  if (roleQ.isLoading) {
    return (
      <AppShell title="Diary" backTo="/home" backLabel="Dashboard">
        <div className="py-16 text-center text-muted-foreground">Loading…</div>
      </AppShell>
    );
  }

  if (roleQ.isError) {
    return (
      <AppShell title="Diary" backTo="/home" backLabel="Dashboard">
        <div className="max-w-md mx-auto py-16 text-center space-y-3">
          <p className="text-sm text-destructive">
            Could not verify your access. Try refreshing the page.
          </p>
          <p className="text-xs text-muted-foreground">
            {roleQ.error instanceof Error ? roleQ.error.message : "Unknown error"}
          </p>
          <Button onClick={() => roleQ.refetch()}>Try again</Button>
        </div>
      </AppShell>
    );
  }

  if (!canAccess || !visibility) {
    return (
      <AppShell title="Diary" backTo="/home" backLabel="Dashboard">
        <div className="py-16 text-center text-muted-foreground">Redirecting…</div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Diary" backTo="/home" backLabel="Dashboard">
      <DiaryTabsPanel
        visibility={visibility}
        isStaffAdvisor={isStaffAdvisor}
        viewAsAdvisorId={advisorViewId}
        teamsSearch={search}
      />
    </AppShell>
  );
}
