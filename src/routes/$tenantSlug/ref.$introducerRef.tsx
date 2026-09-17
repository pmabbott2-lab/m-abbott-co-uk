import { createFileRoute, Link } from "@tanstack/react-router";
import { useRequiredTenantUi } from "@/lib/tenant-ui";
import { TenantPublicShell } from "@/components/tenant/TenantPublicShell";

/**
 * Tenant-scoped introducer reference entry (G4 routing shell).
 * Security: tenant + introducer relationship must be verified before data access (G5/G6).
 * G4 only preserves tenant context in the URL.
 */
export const Route = createFileRoute("/$tenantSlug/ref/$introducerRef")({
  component: TenantRefEntry,
});

function TenantRefEntry() {
  const tenant = useRequiredTenantUi();
  const { introducerRef } = Route.useParams();

  return (
    <TenantPublicShell tenant={tenant}>
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="text-2xl font-semibold">Introducer link</h1>
        <p className="text-sm text-muted-foreground">
          Firm context: <strong>{tenant.tradingName || tenant.companyName}</strong> (
          <code>{tenant.slug}</code>). Reference <code>{introducerRef}</code> is retained for a
          later gate that will verify the introducer belongs to this tenant before any data access.
        </p>
        <p className="text-sm text-muted-foreground">
          Legacy flat links <code>/go/…</code> and <code>/book/…</code> remain available; prefer
          tenant-prefixed routes going forward.
        </p>
        <Link
          to="/$tenantSlug/login"
          params={{ tenantSlug: tenant.slug }}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          Continue to {tenant.tradingName || tenant.companyName} sign in
        </Link>
      </div>
    </TenantPublicShell>
  );
}
