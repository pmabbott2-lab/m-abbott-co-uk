import { Link } from "@tanstack/react-router";
import type { TenantPresentation } from "@/lib/tenant-presentation";

/** Tenant-aware public chrome. Never falls back to another tenant's brand. */
export function TenantPublicShell({
  tenant,
  children,
  showSusanCta = false,
}: {
  tenant: TenantPresentation;
  children: React.ReactNode;
  showSusanCta?: boolean;
}) {
  const displayName = tenant.tradingName || tenant.companyName;
  const accent = tenant.primaryColour || "#1e293b";
  const website = tenant.websiteUrl?.trim() || null;

  return (
    <div
      className="min-h-screen bg-background"
      style={
        tenant.primaryColour
          ? ({ ["--tenant-primary" as string]: tenant.primaryColour } as React.CSSProperties)
          : undefined
      }
    >
      <header className="border-b bg-card/70 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {tenant.logoUrl ? (
              <img
                src={tenant.logoUrl}
                alt=""
                className="h-9 w-auto max-w-[160px] object-contain"
              />
            ) : (
              <span
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
                style={{ backgroundColor: accent }}
                aria-hidden
              >
                {(displayName[0] || "T").toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate font-semibold text-foreground">{displayName}</p>
              <p className="text-xs text-muted-foreground">Powered by Mortgage Hub</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {website ? (
              <a
                href={website}
                className="hidden text-sm text-muted-foreground underline-offset-4 hover:underline sm:inline"
                rel="noopener noreferrer"
              >
                Company website
              </a>
            ) : null}
            <Link
              to="/$tenantSlug/login"
              params={{ tenantSlug: tenant.slug }}
              className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-10">{children}</main>
      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        <p>
          {displayName}
          {tenant.legalName && tenant.legalName !== displayName ? ` · ${tenant.legalName}` : ""}
        </p>
        {!showSusanCta || !tenant.susanEnabled ? (
          <p className="mt-1">Platform by Mortgage Hub</p>
        ) : (
          <p className="mt-1">Susan journeys available for this firm · Platform by Mortgage Hub</p>
        )}
      </footer>
    </div>
  );
}
