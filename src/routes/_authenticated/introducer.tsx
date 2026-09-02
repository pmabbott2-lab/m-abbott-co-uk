import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/AppShell";
import { TabPageNav } from "@/components/TabPageNav";
import { IntroducerPortalContent } from "@/components/introducer/IntroducerPortalContent";
import { checkIsIntroducer } from "@/lib/introducer.functions";

export const Route = createFileRoute("/_authenticated/introducer")({
  component: IntroducerPortalPage,
});

/** Standalone /introducer URL — same inline UI as staff dashboard Introducers tab. */
function IntroducerPortalPage() {
  const roleFn = useServerFn(checkIsIntroducer);
  const roleQ = useQuery({ queryKey: ["is-introducer"], queryFn: () => roleFn() });

  if (roleQ.isLoading) {
    return (
      <AppShell title="Introducer portal">
        <div className="py-16 text-center text-muted-foreground">Loading…</div>
      </AppShell>
    );
  }

  if (!roleQ.data?.isIntroducer) {
    throw redirect({ to: "/home" });
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
