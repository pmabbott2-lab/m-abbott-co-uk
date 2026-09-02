import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import {
  listTestAccountStatus,
  provisionTestAccounts,
  revokeTestAccounts,
} from "@/lib/test-accounts.functions";
import { TEST_ACCOUNTS, TEST_ACCOUNT_PASSWORD, TEST_ACCOUNT_PHONE } from "@/lib/test-accounts";
import { FlaskConical, ShieldOff, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

function roleLabel(role: string, adminLevel?: string): string {
  if (role === "admin" && adminLevel === "general") return "General admin";
  return role;
}

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

  const statusByEmail = new Map((statusQ.data ?? []).map((r) => [r.email, r]));
  const rows = TEST_ACCOUNTS.map((spec) => {
    const live = statusByEmail.get(spec.email);
    return {
      email: spec.email,
      fullName: spec.fullName,
      role: roleLabel(spec.role, spec.adminLevel),
      exists: live?.exists ?? false,
      bypass: live?.bypass ?? false,
    };
  });
  const anyBypass = rows.some((r) => r.bypass);

  return (
    <section className="rounded-2xl border bg-card p-6 space-y-4">
      <div className="flex items-start gap-3">
        <FlaskConical className="w-5 h-5 mt-0.5 shrink-0" />
        <div className="space-y-1 min-w-0">
          <h3 className="font-medium">Test accounts</h3>
          <p className="text-sm text-muted-foreground">
            Owner-only. Provisions {TEST_ACCOUNTS.length} accounts: 1–3 introducers, 4–5 advisors,
            6–12 customers, and <strong>13@test.co.uk</strong> (general admin — set permissions in
            Admin access). Shared phone{" "}
            <span className="font-mono">{TEST_ACCOUNT_PHONE}</span>, password{" "}
            <span className="font-mono">{TEST_ACCOUNT_PASSWORD}</span>. Revoke before deleting profiles.
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

      <div className="rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-2 font-medium">Email</th>
              <th className="p-2 font-medium">Name</th>
              <th className="p-2 font-medium">Role</th>
              <th className="p-2 font-medium">Exists</th>
              <th className="p-2 font-medium">Bypass</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.email}>
                <td className="p-2 font-mono text-xs">{r.email}</td>
                <td className="p-2">{r.fullName}</td>
                <td className="p-2 capitalize">{r.role}</td>
                <td className="p-2">{r.exists ? "Yes" : "No"}</td>
                <td className="p-2">{r.bypass ? "Active" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
