import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import {
  listTestAccountStatus,
  provisionTestAccounts,
  revokeTestAccounts,
} from "@/lib/test-accounts.functions";
import { TEST_ACCOUNT_PASSWORD, TEST_ACCOUNT_PHONE } from "@/lib/test-accounts";
import { FlaskConical, ShieldOff, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

export function TestAccountsCard() {
  const qc = useQueryClient();
  const statusFn = useServerFn(listTestAccountStatus);
  const provisionFn = useServerFn(provisionTestAccounts);
  const revokeFn = useServerFn(revokeTestAccounts);

  const statusQ = useQuery({
    queryKey: ["test-account-status"],
    queryFn: () => statusFn(),
  });

  const provision = useMutation({
    mutationFn: () => provisionFn(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["test-account-status"] });
      toast.success(
        `Provisioned ${res.results.length} test accounts. Password: ${res.password}, phone: ${res.phone}`,
      );
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not provision test accounts"),
  });

  const revoke = useMutation({
    mutationFn: () => revokeFn(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["test-account-status"] });
      toast.success(`Revoked bypass on ${res.revoked.length} accounts. You can delete profiles when ready.`);
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not revoke test accounts"),
  });

  const rows = statusQ.data ?? [];
  const anyBypass = rows.some((r) => r.bypass);

  return (
    <section className="rounded-2xl border bg-card p-6 space-y-4">
      <div className="flex items-start gap-3">
        <FlaskConical className="w-5 h-5 mt-0.5 shrink-0" />
        <div className="space-y-1 min-w-0">
          <h3 className="font-medium">Test accounts</h3>
          <p className="text-sm text-muted-foreground">
            Owner-only. Creates 1–3@test.co.uk (introducers), 4–5@test.co.uk (advisors), and
            6–12@test.co.uk (customers) with email verification bypass and shared phone{" "}
            <span className="font-mono">{TEST_ACCOUNT_PHONE}</span>. Password:{" "}
            <span className="font-mono">{TEST_ACCOUNT_PASSWORD}</span>. Run{" "}
            <strong>Revoke test accounts</strong> before deleting profiles.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button disabled={provision.isPending} onClick={() => provision.mutate()}>
          <ShieldCheck className="w-4 h-4 mr-2" />
          {provision.isPending ? "Provisioning…" : "Provision test accounts"}
        </Button>
        <Button
          variant="outline"
          disabled={revoke.isPending || !anyBypass}
          onClick={() => revoke.mutate()}
        >
          <ShieldOff className="w-4 h-4 mr-2" />
          {revoke.isPending ? "Revoking…" : "Revoke test accounts"}
        </Button>
      </div>

      {statusQ.isLoading && (
        <p className="text-sm text-muted-foreground">Loading test account status…</p>
      )}

      {!statusQ.isLoading && rows.length > 0 && (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-2 font-medium">Email</th>
                <th className="p-2 font-medium">Role</th>
                <th className="p-2 font-medium">Exists</th>
                <th className="p-2 font-medium">Bypass</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.email}>
                  <td className="p-2 font-mono text-xs">{r.email}</td>
                  <td className="p-2 capitalize">{r.role}</td>
                  <td className="p-2">{r.exists ? "Yes" : "No"}</td>
                  <td className="p-2">{r.bypass ? "Active" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
