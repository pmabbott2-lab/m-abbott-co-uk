import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  addPlatformAdministrator,
  cancelPlatformAdminInvite,
  listPlatformAdmins,
  revokePlatformAdministrator,
} from "@/lib/platform-admins.functions";
import { platformRoleLabel, type PlatformAdminRow } from "@/lib/platform-admins";
import { usePlatformAuthority } from "@/lib/platform-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/platform/admins")({
  component: PlatformAdminsPage,
});

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function AdminCard({
  row,
  selected,
  onSelect,
}: {
  row: PlatformAdminRow;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
        selected ? "border-foreground/40 bg-muted/40" : "border-border hover:bg-muted/20"
      }`}
    >
      <p className="text-sm font-medium">{row.fullName || row.email}</p>
      <p className="text-xs text-muted-foreground">{row.email}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {platformRoleLabel(row.platformRole)} · {row.status} · joined {formatDate(row.createdAt)}
      </p>
    </button>
  );
}

function PlatformAdminsPage() {
  const authority = usePlatformAuthority();
  const isSuperOwner = Boolean(authority?.isSuperOwner);
  const listFn = useServerFn(listPlatformAdmins);
  const addFn = useServerFn(addPlatformAdministrator);
  const cancelFn = useServerFn(cancelPlatformAdminInvite);
  const revokeFn = useServerFn(revokePlatformAdministrator);
  const qc = useQueryClient();

  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [platformRole, setPlatformRole] = useState<"super_admin" | "super_owner">("super_admin");
  const [confirmSo, setConfirmSo] = useState(false);

  const listQ = useQuery({
    queryKey: ["platform-admins"],
    queryFn: () => listFn(),
    enabled: isSuperOwner,
  });

  const selected = useMemo(() => {
    if (!listQ.data || !selectedEmail) return null;
    return (
      [...listQ.data.superOwners, ...listQ.data.superAdmins].find((r) => r.email === selectedEmail) ??
      null
    );
  }, [listQ.data, selectedEmail]);

  const addMut = useMutation({
    mutationFn: () =>
      addFn({
        data: {
          firstName,
          lastName,
          email,
          platformRole,
          confirmSuperOwner: platformRole === "super_owner" ? confirmSo : undefined,
        },
      }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["platform-admins"] });
      setShowAdd(false);
      setFirstName("");
      setLastName("");
      setEmail("");
      setPlatformRole("super_admin");
      setConfirmSo(false);
      if (res.outcome === "invited") {
        toast.success(`Invitation created for ${res.email} (expires ${formatDate(res.expiresAt)})`);
      } else if (res.outcome === "already_has_role") {
        toast.message(`${res.email} already has this platform role`);
      } else if (res.outcome === "changed") {
        toast.success(`Platform role updated for ${res.email}`);
      } else {
        toast.success(`Platform role granted to ${res.email}`);
      }
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Request denied"),
  });

  const cancelMut = useMutation({
    mutationFn: (inviteEmail: string) => cancelFn({ data: { inviteEmail } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["platform-admins"] });
      toast.success("Invitation cancelled");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Cancel failed"),
  });

  const revokeMut = useMutation({
    mutationFn: (adminEmail: string) =>
      revokeFn({ data: { adminEmail, confirm: true as const } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["platform-admins"] });
      setSelectedEmail(null);
      toast.success("Platform role revoked");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Revoke denied"),
  });

  if (!isSuperOwner) {
    return (
      <div className="space-y-3">
        <h2 className="text-xl font-semibold">Admins</h2>
        <p className="text-sm text-muted-foreground">
          Platform administrator management requires Super Owner authority. Super Admins cannot manage
          platform administrators.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Platform Administrators</h2>
          <p className="text-sm text-muted-foreground">
            Super Owner only. Platform roles are independent of tenant memberships.
          </p>
        </div>
        <Button type="button" onClick={() => setShowAdd((v) => !v)}>
          Add platform administrator
        </Button>
      </div>

      {showAdd ? (
        <div className="max-w-lg space-y-3 rounded-md border border-border p-4">
          <h3 className="text-sm font-semibold">Add platform administrator</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="pa-first">First name</Label>
              <Input
                id="pa-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pa-last">Last name</Label>
              <Input
                id="pa-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pa-email">Email</Label>
            <Input
              id="pa-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label>Platform role</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={platformRole === "super_admin" ? "default" : "outline"}
                onClick={() => {
                  setPlatformRole("super_admin");
                  setConfirmSo(false);
                }}
              >
                Super Admin
              </Button>
              <Button
                type="button"
                size="sm"
                variant={platformRole === "super_owner" ? "default" : "outline"}
                onClick={() => setPlatformRole("super_owner")}
              >
                Super Owner
              </Button>
            </div>
            {platformRole === "super_admin" ? (
              <p className="text-xs text-muted-foreground">
                Super Admins receive no tenant access automatically. Tenant access must be granted
                separately.
              </p>
            ) : (
              <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                <p className="text-xs text-muted-foreground">
                  Super Owners have platform-wide administrative authority. They can manage platform
                  administrators and administer GROUP companies.
                </p>
                <label className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={confirmSo}
                    onChange={(e) => setConfirmSo(e.target.checked)}
                  />
                  <span>I understand and confirm granting Super Owner.</span>
                </label>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={
                addMut.isPending ||
                !firstName.trim() ||
                !lastName.trim() ||
                !email.trim() ||
                (platformRole === "super_owner" && !confirmSo)
              }
              onClick={() => addMut.mutate()}
            >
              {addMut.isPending ? "Saving…" : "Confirm"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {listQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading administrators…</p>
      ) : listQ.isError ? (
        <p className="text-sm text-destructive">Could not load administrators.</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold tracking-wide text-muted-foreground">
                SUPER OWNERS
              </h3>
              {(listQ.data?.superOwners ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No Super Owners configured</p>
              ) : (
                <div className="space-y-2">
                  {listQ.data!.superOwners.map((row) => (
                    <AdminCard
                      key={`so-${row.email}`}
                      row={row}
                      selected={selectedEmail === row.email}
                      onSelect={() => setSelectedEmail(row.email)}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold tracking-wide text-muted-foreground">
                SUPER ADMINS
              </h3>
              {(listQ.data?.superAdmins ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No Super Admins configured</p>
              ) : (
                <div className="space-y-2">
                  {listQ.data!.superAdmins.map((row) => (
                    <AdminCard
                      key={`sa-${row.email}`}
                      row={row}
                      selected={selectedEmail === row.email}
                      onSelect={() => setSelectedEmail(row.email)}
                    />
                  ))}
                </div>
              )}
            </section>

            {(listQ.data?.pendingInvites ?? []).length > 0 ? (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold tracking-wide text-muted-foreground">
                  PENDING INVITATIONS
                </h3>
                <div className="space-y-2">
                  {listQ.data!.pendingInvites.map((invite) => (
                    <div
                      key={`${invite.email}-${invite.createdAt}`}
                      className="flex items-start justify-between gap-2 rounded-md border border-dashed border-border px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium">{invite.fullName}</p>
                        <p className="text-xs text-muted-foreground">{invite.email}</p>
                        <p className="text-xs text-muted-foreground">
                          {platformRoleLabel(invite.platformRole)} · expires{" "}
                          {formatDate(invite.expiresAt)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={cancelMut.isPending}
                        onClick={() => cancelMut.mutate(invite.email)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>

          <div className="rounded-md border border-border p-4">
            {selected ? (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Administrator detail</h3>
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Identity</dt>
                    <dd>{selected.fullName || selected.email}</dd>
                    <dd className="text-muted-foreground">{selected.email}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Platform role</dt>
                    <dd>{platformRoleLabel(selected.platformRole)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Status</dt>
                    <dd className="capitalize">{selected.status}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Created</dt>
                    <dd>{formatDate(selected.createdAt)}</dd>
                  </div>
                  {selected.platformRole === "super_admin" ? (
                    <div>
                      <dt className="text-xs text-muted-foreground">Tenant access</dt>
                      <dd>No grants configured</dd>
                    </div>
                  ) : null}
                </dl>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={revokeMut.isPending}
                  onClick={() => {
                    const label = platformRoleLabel(selected.platformRole);
                    if (
                      !window.confirm(
                        `Revoke ${label} for ${selected.email}? This does not delete their account or tenant memberships.`,
                      )
                    ) {
                      return;
                    }
                    revokeMut.mutate(selected.email);
                  }}
                >
                  Revoke platform role
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Select an administrator to view details.
              </p>
            )}
            <p className="mt-4 text-xs text-muted-foreground">
              <Link to="/platform/audit" className="underline underline-offset-2">
                View platform audit
              </Link>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
