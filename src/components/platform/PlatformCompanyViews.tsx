import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  TENANT_ACCESS_AVAILABLE,
  TENANT_ACCESS_FUTURE_LABEL,
  TENANT_MEMBER_ROLE_LABELS,
  TENANT_MEMBER_ROLES,
  tenantTypePresentation,
  type PlatformCompanyDetail,
  type PlatformCompanySummary,
  type PlatformDashboardOverview,
} from "@/lib/platform-dashboard";

export function PlatformStatCards({ overview }: { overview: PlatformDashboardOverview }) {
  const cards = [
    { label: "Total companies", value: overview.totalCompanies },
    { label: "Group companies", value: overview.groupCompanies },
    { label: "External companies", value: overview.externalCompanies },
    { label: "Active companies", value: overview.activeCompanies },
    { label: "Active memberships", value: overview.totalActiveMemberships },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardHeader className="p-4 pb-2">
            <CardDescription>{card.label}</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{card.value}</CardTitle>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

export function PlatformRoleCounts({ overview }: { overview: PlatformDashboardOverview }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Active memberships by role</CardTitle>
        <CardDescription>Aggregate counts only. No customer or staff identities.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TENANT_MEMBER_ROLES.map((role) => (
          <div key={role} className="rounded-lg border border-border px-3 py-2">
            <p className="text-xs text-muted-foreground">{TENANT_MEMBER_ROLE_LABELS[role]}</p>
            <p className="text-lg font-semibold tabular-nums">{overview.roleCounts[role]}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function TenantTypeBadge({ type }: { type: PlatformCompanySummary["tenantType"] }) {
  const presentation = tenantTypePresentation(type);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge variant={type === "GROUP" ? "default" : "secondary"}>{presentation.label}</Badge>
      <span className="text-xs text-muted-foreground">{presentation.caption}</span>
    </span>
  );
}

export function PlatformCompanyTable({
  companies,
  emptyLabel = "No companies in scope.",
}: {
  companies: PlatformCompanySummary[];
  emptyLabel?: string;
}) {
  if (companies.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Company</th>
            <th className="px-3 py-2 font-medium">Code</th>
            <th className="px-3 py-2 font-medium">Slug</th>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Active members</th>
          </tr>
        </thead>
        <tbody>
          {companies.map((company) => (
            <tr key={company.companyCode} className="border-t border-border">
              <td className="px-3 py-2">
                <Link
                  to="/platform/companies/$companyCode"
                  params={{ companyCode: company.companyCode }}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {company.companyName}
                </Link>
              </td>
              <td className="px-3 py-2 font-mono text-xs">{company.companyCode}</td>
              <td className="px-3 py-2 font-mono text-xs">{company.slug}</td>
              <td className="px-3 py-2">
                <TenantTypeBadge type={company.tenantType} />
              </td>
              <td className="px-3 py-2 capitalize">{company.status}</td>
              <td className="px-3 py-2 tabular-nums">{company.activeMemberCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FutureTenantAccessControl() {
  if (TENANT_ACCESS_AVAILABLE) return null;
  return (
    <Button disabled variant="outline" type="button">
      {TENANT_ACCESS_FUTURE_LABEL}
    </Button>
  );
}

export function PlatformCompanyDetailCard({ company }: { company: PlatformCompanyDetail }) {
  const presentation = tenantTypePresentation(company.tenantType);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Company</p>
          <h2 className="text-xl font-semibold">{company.companyName}</h2>
          {company.tradingName ? (
            <p className="text-sm text-muted-foreground">{company.tradingName}</p>
          ) : null}
        </div>
        <TenantTypeBadge type={company.tenantType} />
      </div>

      <p className="text-sm text-muted-foreground">{presentation.hint}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <MetaRow label="Company code" value={company.companyCode} mono />
        <MetaRow label="Slug" value={company.slug} mono />
        <MetaRow label="Tenant type" value={company.tenantType} />
        <MetaRow label="Status" value={company.status} />
        <MetaRow
          label="Created"
          value={company.createdAt ? new Date(company.createdAt).toLocaleDateString("en-GB") : "—"}
        />
        <MetaRow label="Active members" value={String(company.activeMemberCount)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Feature configuration</CardTitle>
          <CardDescription>
            {company.config.enabledFeatureCount} enabled · {company.features.length} configured
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {company.features.length === 0 ? (
            <p className="text-sm text-muted-foreground">No explicit feature rows. Catalogue defaults apply.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {company.features.map((feature) => (
                <li key={feature.key} className="flex flex-wrap justify-between gap-2">
                  <span>{feature.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{feature.state}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Platform configuration</CardTitle>
          <CardDescription>Presence of tenant config shells only.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <p>Settings record: {company.config.settingsPresent ? "present" : "absent"}</p>
          <p>Branding record: {company.config.brandingPresent ? "present" : "absent"}</p>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <FutureTenantAccessControl />
        <p className="text-xs text-muted-foreground">
          This screen is platform metadata only. It does not open the tenant application and does
          not grant operational access.
        </p>
      </div>
    </div>
  );
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={mono ? "font-mono text-sm" : "text-sm font-medium"}>{value}</p>
    </div>
  );
}
