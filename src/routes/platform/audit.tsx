import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPlatformAuditEvents } from "@/lib/platform-dashboard.server";
import { usePlatformAuthority } from "@/lib/platform-ui";

export const Route = createFileRoute("/platform/audit")({
  component: PlatformAuditPage,
});

function PlatformAuditPage() {
  const authority = usePlatformAuthority();
  const listFn = useServerFn(listPlatformAuditEvents);
  const listQ = useQuery({
    queryKey: ["platform-audit-events"],
    queryFn: () => listFn(),
    enabled: authority.canAccessPlatform,
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Audit</h2>
        <p className="text-sm text-muted-foreground">
          Read-only platform and security events. Tokens, secrets, and raw metadata are not shown.
        </p>
      </div>

      {!authority.isSuperOwner ? (
        <p className="text-sm text-muted-foreground">
          Super Admin sees company events only for tenants with an explicit grant. Platform-wide
          role events stay Super Owner only.
        </p>
      ) : null}

      {listQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading audit events…</p>
      ) : listQ.isError ? (
        <p className="text-sm text-destructive">Could not load audit events.</p>
      ) : (listQ.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No platform audit events in scope.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Event</th>
                <th className="px-3 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">Actor</th>
                <th className="px-3 py-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {(listQ.data ?? []).map((event, index) => (
                <tr key={`${event.occurredAt}-${event.eventType}-${index}`} className="border-t border-border">
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {new Date(event.occurredAt).toLocaleString("en-GB")}
                  </td>
                  <td className="px-3 py-2">{event.eventLabel}</td>
                  <td className="px-3 py-2">{event.companyLabel ?? "—"}</td>
                  <td className="px-3 py-2">{event.actorLabel}</td>
                  <td className="px-3 py-2 text-muted-foreground">{event.description || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
