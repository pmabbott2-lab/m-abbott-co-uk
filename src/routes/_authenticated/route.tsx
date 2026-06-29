import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { shouldBlockAuthenticatedApp } from "@/lib/auth-recovery";
import { PhoneCaptureGate } from "@/components/PhoneCaptureGate";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    if (typeof window !== "undefined" && shouldBlockAuthenticatedApp()) {
      throw redirect({ to: "/auth/reset" });
    }

    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session?.user) return { user: sessionData.session.user };

    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: () => (
    <PhoneCaptureGate>
      <Outlet />
    </PhoneCaptureGate>
  ),
});
