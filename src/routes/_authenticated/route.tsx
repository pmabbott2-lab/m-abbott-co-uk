import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { shouldBlockAuthenticatedApp } from "@/lib/auth-recovery";
import { isLoginMfaSuspended } from "@/lib/auth-mfa-config";
import { requiresAuthenticatorMfa, requiresSmsLoginVerification } from "@/lib/auth-roles";
import { isLoginSmsVerified } from "@/lib/auth-sms-session";
import { PhoneCaptureGate } from "@/components/PhoneCaptureGate";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    if (typeof window !== "undefined" && shouldBlockAuthenticatedApp()) {
      throw redirect({ to: "/auth/reset" });
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) throw redirect({ to: "/auth" });
    }

    const activeUser = user ?? (await supabase.auth.getUser()).data.user;
    if (!activeUser) throw redirect({ to: "/auth" });

    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", activeUser.id);
    const roleList = (roles ?? []).map((r) => r.role);
    const session = sessionData.session ?? (await supabase.auth.getSession()).data.session;
    if (!session) throw redirect({ to: "/auth" });

    if (!isLoginMfaSuspended() && requiresAuthenticatorMfa(roleList)) {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const hasVerifiedMfa = (factors?.totp ?? []).some((f) => f.status === "verified");
      if (!hasVerifiedMfa) {
        throw redirect({ to: "/auth" });
      }
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel !== "aal2") {
        throw redirect({ to: "/auth" });
      }
    } else if (!isLoginMfaSuspended() && requiresSmsLoginVerification(roleList) && !isLoginSmsVerified(session)) {
      throw redirect({ to: "/auth" });
    }

    return { user: activeUser };
  },
  component: () => (
    <PhoneCaptureGate>
      <Outlet />
    </PhoneCaptureGate>
  ),
});
