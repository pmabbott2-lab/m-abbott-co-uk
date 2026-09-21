import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPlatformCompanies } from "@/lib/company-provisioning.server";
import { usePlatformAuthority } from "@/lib/platform-ui";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/platform/")({
  component: PlatformHomePage,
});

function PlatformHomePage() {
  const authority = usePlatformAuthority();
  const listFn = useServerFn(listPlatformCompanies);
  const listQ = useQuery({
    queryKey: ["platform-companies"],
    queryFn: () => listFn(),
    enabled: authority.canListPlatformTenants,
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Mortgage Hub</h2>
        <p className="text-sm text-muted-foreground">Platform Administration</p>
      </div>

      {!authority.isSuperOwner ? (
        <p className="text-sm text-muted-foreground">
          Super Admin tenant grants are not managed in this gate. Explicit tenant access only —
          there is no all-tenant authority.
        </p>
      ) : null}

      {authority.canListPlatformTenants ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-medium">Tenants</h3>
            <Button asChild size="sm">
              <Link to="/platform/tenants">Create company</Link>
            </Button>
          </div>
          {listQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading companies…</p>
          ) : listQ.isError ? (
            <p className="text-sm text-destructive">Could not load companies.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Company</th>
                    <th className="px-3 py-2 font-medium">Code</th>
                    <th className="px-3 py-2 font-medium">Slug</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(listQ.data ?? []).map(
                    (t: {
                      id: string;
                      company_name: string;
                      company_code: string;
                      slug: string;
                      tenant_type: string;
                      status: string;
                    }) => (
                      <tr key={t.id} className="border-t border-border">
                        <td className="px-3 py-2">{t.company_name}</td>
                        <td className="px-3 py-2 font-mono text-xs">{t.company_code}</td>
                        <td className="px-3 py-2 font-mono text-xs">{t.slug}</td>
                        <td className="px-3 py-2">{t.tenant_type}</td>
                        <td className="px-3 py-2">{t.status}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Listing is platform visibility only. Entering a tenant as operational staff is a later
            audited action — not membership and not this screen.
          </p>
        </section>
      ) : null}
    </div>
  );
}
