import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import {
  listTestAccountStatus,
  provisionTestAccounts,
  resetTestAccount,
  revokeTestAccounts,
} from "@/lib/test-accounts.functions";
import { TEST_ACCOUNTS, TEST_ACCOUNT_PASSWORD, TEST_ACCOUNT_PHONE } from "@/lib/test-accounts";
import { FlaskConical, RotateCcw, ShieldOff, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

function roleLabel(role: string, adminLevel?: string): string {
  if (role === "admin" && adminLevel === "general") return "General admin";
  return role;
}

function StatusPill({
  ok,
  yesLabel = "Yes",
  noLabel = "No",
}: {
  ok: boolean;
  yesLabel?: string;
  noLabel?: string;
}) {
  return (
    <span
      className={
        ok
          ? "inline-flex items-center rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300"
          : "inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
      }
    >
      {ok ? yesLabel : noLabel}
    </span>
  );
}

export function TestAccountsCard() {
  const qc = useQueryClient();
  const statusFn = useServerFn(listTestAccountStatus);
  const provisionFn = useServerFn(provisionTestAccounts);
  const revokeFn = useServerFn(revokeTestAccounts);
  const resetFn = useServerFn(resetTestAccount);

  const statusQ = useQuery({
    queryKey: ["test-account-status"],
    queryFn: () => statusFn(),
  });

  const provision = useMutation({
    mutationFn: () => provisionFn(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["test-account-status"] });
      qc.invalidateQueries({ queryKey: ["admins"] });
      qc.invalidateQueries({ queryKey: ["users-for-admin-grant"] });
      const failed = res.errors?.length ?? 0;
      if (failed) {
        toast.error(
          `Provisioned ${res.results.length}, ${failed} failed: ${res.errors!.map((e) => e.email).join(", ")}`,
        );
      } else {
        toast.success(
          `Provisioned ${res.results.length} test accounts. Password: ${res.password}, phone: ${res.phone}`,
        );
      }
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

  const reset = useMutation({
    mutationFn: (email: string) => resetFn({ data: { email } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["test-account-status"] });
      qc.invalidateQueries({ queryKey: ["admins"] });
      qc.invalidateQueries({ queryKey: ["users-for-admin-grant"] });
      toast.success(`Reset ${res.email} — fresh test profile ready.`);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not reset account"),
  });

  const confirmReset = (email: string) => {
    const ok = window.confirm(
      `Reset ${email}? This wipes their Hub activity and restores the default test profile.`,
    );
    if (ok) reset.mutate(email);
  };

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
    <section className="rounded-2xl border bg-card p-4 sm:p-6 space-y-4 min-w-0 w-full max-w-full overflow-x-hidden">
      <div className="flex items-start gap-3 min-w-0">
        <FlaskConical className="w-5 h-5 mt-0.5 shrink-0" />
        <div className="space-y-1 min-w-0">
          <h3 className="font-medium">Test accounts</h3>
          <p className="text-sm text-muted-foreground break-words">
            Owner-only. Provisions {TEST_ACCOUNTS.length} accounts: 1–3 introducers, 4–5 advisors,
            6–12 customers, and <strong>13@test.co.uk</strong> (general admin). Shared phone{" "}
            <span className="font-mono">{TEST_ACCOUNT_PHONE}</span>, password{" "}
            <span className="font-mono break-all">{TEST_ACCOUNT_PASSWORD}</span>. Use{" "}
            <strong>Reset</strong> on a row to wipe that account&apos;s Hub activity and start again.
            Revoke before deleting profiles.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
        <Button className="w-full sm:w-auto" disabled={provision.isPending} onClick={() => provision.mutate()}>
          <ShieldCheck className="w-4 h-4 mr-2" />
          {provision.isPending ? "Provisioning…" : "Provision test accounts"}
        </Button>
        <Button
          className="w-full sm:w-auto"
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

      {/* Mobile / tablet: stacked cards — no sideways scroll, Reset always visible */}
      <ul className="space-y-2 lg:hidden">
        {rows.map((r) => (
          <li key={r.email} className="rounded-xl border bg-background p-3 space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-xs font-semibold break-all">{r.email}</p>
                <p className="text-sm text-muted-foreground truncate">{r.fullName}</p>
              </div>
              <span className="shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-medium capitalize">
                {r.role}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                Exists <StatusPill ok={r.exists} />
              </span>
              <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                Bypass <StatusPill ok={r.bypass} yesLabel="Active" noLabel="—" />
              </span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full"
              disabled={reset.isPending}
              onClick={() => confirmReset(r.email)}
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
              {reset.isPending && reset.variables === r.email ? "Resetting…" : "Reset account"}
            </Button>
          </li>
        ))}
      </ul>

      {/* Desktop: compact table with Reset column */}
      <div className="hidden lg:block rounded-xl border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-2 font-medium">Email</th>
              <th className="p-2 font-medium">Name</th>
              <th className="p-2 font-medium">Role</th>
              <th className="p-2 font-medium">Exists</th>
              <th className="p-2 font-medium">Bypass</th>
              <th className="p-2 font-medium text-right"> </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.email}>
                <td className="p-2 font-mono text-xs whitespace-nowrap">{r.email}</td>
                <td className="p-2">{r.fullName}</td>
                <td className="p-2 capitalize">{r.role}</td>
                <td className="p-2">
                  <StatusPill ok={r.exists} />
                </td>
                <td className="p-2">
                  <StatusPill ok={r.bypass} yesLabel="Active" noLabel="—" />
                </td>
                <td className="p-2 text-right">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={reset.isPending}
                    onClick={() => confirmReset(r.email)}
                  >
                    <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                    {reset.isPending && reset.variables === r.email ? "Resetting…" : "Reset"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
