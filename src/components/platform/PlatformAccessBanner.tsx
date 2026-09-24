import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  endPlatformTenantEntry,
  getMyPlatformTenantAccess,
} from "@/lib/platform-tenant-entry.functions";
import { Button } from "@/components/ui/button";

/** Persistent platform-entry indicator. Not a tenant role badge. */
export function PlatformAccessBanner({ tenantSlug }: { tenantSlug: string }) {
  const navigate = useNavigate();
  const accessFn = useServerFn(getMyPlatformTenantAccess);
  const endFn = useServerFn(endPlatformTenantEntry);
  const accessQ = useQuery({
    queryKey: ["platform-tenant-access", tenantSlug],
    queryFn: () => accessFn({ data: { tenantSlug } }),
  });
  const exit = useMutation({
    mutationFn: () => endFn(),
    onSuccess: () => {
      void navigate({ to: "/platform", replace: true });
    },
  });

  const access = accessQ.data;
  if (!access) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-[55] w-full border-b border-amber-700/40 bg-amber-100 px-4 py-2 text-amber-950 dark:border-amber-500/30 dark:bg-amber-950 dark:text-amber-50"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <p className="font-semibold tracking-wide">
            {access.basisLabel.toLowerCase().includes("break-glass")
              ? "BREAK-GLASS PLATFORM ACCESS"
              : "PLATFORM ACCESS"}
          </p>
          <p>
            {access.companyName} · {access.basisLabel}
            {access.accessLevel === "read_only" ? " · Read only" : null}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={exit.isPending}
          onClick={() => exit.mutate()}
        >
          {exit.isPending ? "Exiting…" : "Exit company"}
        </Button>
      </div>
    </div>
  );
}
