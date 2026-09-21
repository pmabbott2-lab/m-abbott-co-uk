import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { TabPageNav } from "@/components/TabPageNav";
import { IntroducerPortalContent } from "@/components/introducer/IntroducerPortalContent";
import { checkIsIntroducer } from "@/lib/introducer.functions";
import { Button } from "@/components/ui/button";
import { useTenantAwareNavigate } from "@/components/tenant/TenantAppLink";

export const Route = createFileRoute("/_authenticated/introducer")({
  component: IntroducerPortalPage,
});

/** Standalone /introducer URL — same inline UI as staff dashboard Introducers tab. */
export function IntroducerPortalPage() {
  const navigate = useTenantAwareNavigate();
  const roleFn = useServerFn(checkIsIntroducer);
  const roleQ = useQuery({ queryKey: ["is-introducer"], queryFn: () => roleFn() });

  useEffect(() => {
    if (roleQ.isSuccess && !roleQ.data?.isIntroducer) {
      void navigate({ to: "/home" });
    }
  }, [roleQ.isSuccess, roleQ.data?.isIntroducer, navigate]);

  if (roleQ.isLoading) {
    return (
      <AppShell title="Introducer portal">
        <div className="py-16 text-center text-muted-foreground">Loading…</div>
      </AppShell>
    );
  }

  if (roleQ.isError) {
    return (
      <AppShell title="Introducer portal">
        <div className="py-16 text-center space-y-3 max-w-md mx-auto">
          <p className="text-muted-foreground">We couldn&apos;t verify introducer access.</p>
          <Button onClick={() => void roleQ.refetch()}>Try again</Button>
        </div>
      </AppShell>
    );
  }

  if (!roleQ.data?.isIntroducer) {
    return (
      <AppShell title="Introducer portal">
        <div className="py-16 text-center text-muted-foreground">Redirecting…</div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Introducer portal">
      <div className="space-y-6">
        <TabPageNav backTo="/home" backLabel="Home" />
        <IntroducerPortalContent />
      </div>
    </AppShell>
  );
}
