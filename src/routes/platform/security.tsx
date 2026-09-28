import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PrivilegedMfaPanel } from "@/components/platform/PrivilegedMfaPanel";
import { safePlatformRedirect } from "@/lib/privileged-mfa-flow";
import { usePlatformAuthority } from "@/lib/platform-ui";

type SecuritySearch = { redirect?: string };

export const Route = createFileRoute("/platform/security")({
  validateSearch: (search: Record<string, unknown>): SecuritySearch => {
    const redirect = safePlatformRedirect(search.redirect);
    return redirect ? { redirect } : {};
  },
  component: PlatformSecurityPage,
});

function PlatformSecurityPage() {
  const authority = usePlatformAuthority();
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Security</h2>
        <p className="text-sm text-muted-foreground">
          {authority.isBreakGlass
            ? "Break-glass Super Owner accounts use an authenticator app (TOTP) for platform administration."
            : "Super Owner and Super Admin accounts use an authenticator app (TOTP) for platform administration."}{" "}
          SMS codes are not accepted for platform administration.
        </p>
      </div>
      <div className="rounded-lg border border-slate-300 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <PrivilegedMfaPanel
          purpose="manage"
          onSatisfied={() => {
            if (redirect) void navigate({ href: redirect, replace: true });
          }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Authenticator apps cannot be removed here. Replacing or resetting an authenticator is a controlled
        administrator process, and the last verified authenticator on a platform account is never removed.
      </p>
    </div>
  );
}
