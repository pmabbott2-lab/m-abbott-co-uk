import { createFileRoute, Outlet, redirect, isRedirect } from "@tanstack/react-router";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { shouldBlockAuthenticatedApp } from "@/lib/auth-recovery";
import { isLoginMfaSuspended } from "@/lib/auth-mfa-config";
import { requiresAuthenticatorMfa, requiresSmsLoginVerification } from "@/lib/auth-roles";
import { isLoginSmsVerified } from "@/lib/auth-sms-session";
import { PhoneCaptureGate } from "@/components/PhoneCaptureGate";

/** Prefer getSession — getUser() can hang indefinitely with new Supabase API keys. */
async function readSession(retries = 20): Promise<Session | null> {
  for (let i = 0; i < retries; i++) {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) return data.session;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  pendingMs: 0,
  pendingMinMs: 0,
  beforeLoad: async () => {
    try {
      if (typeof window !== "undefined" && shouldBlockAuthenticatedApp()) {
        throw redirect({ to: "/auth/reset" });
      }

      const session = await readSession();
      if (!session?.user) {
        throw redirect({ to: "/auth" });
      }

      // MFA currently suspended via .env — skip role/MFA network calls that can hang the route.
      if (isLoginMfaSuspended()) {
        return { user: session.user };
      }

      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id);
      const roleList = (roles ?? []).map((r) => r.role);

      if (requiresAuthenticatorMfa(roleList)) {
        const { data: factors } = await supabase.auth.mfa.listFactors();
        const hasVerifiedMfa = (factors?.totp ?? []).some((f) => f.status === "verified");
        if (!hasVerifiedMfa) {
          throw redirect({ to: "/auth" });
        }
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aal?.currentLevel !== "aal2") {
          throw redirect({ to: "/auth" });
        }
      } else if (requiresSmsLoginVerification(roleList) && !isLoginSmsVerified(session)) {
        throw redirect({ to: "/auth" });
      }

      return { user: session.user };
    } catch (error) {
      if (isRedirect(error)) throw error;
      console.error("[authenticated] beforeLoad failed:", error);
      throw redirect({ to: "/auth" });
    }
  },
  component: () => (
    <PhoneCaptureGate>
      <Outlet />
    </PhoneCaptureGate>
  ),
});
