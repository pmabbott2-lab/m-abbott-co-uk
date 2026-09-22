import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  EXTERNAL_ENTRY_REQUIRES_GRANT_COPY,
  TENANT_MEMBER_ROLE_LABELS,
  TENANT_MEMBER_ROLES,
  tenantTypePresentation,
  type PlatformCompanyDetail,
  type PlatformCompanySummary,
  type PlatformDashboardOverview,
} from "@/lib/platform-dashboard";
import {
  addPlatformTenantOwner,
  cancelPlatformOwnerInvite,
  listPlatformCompanyOwners,
  removePlatformTenantOwner,
} from "@/lib/platform-tenant-owners.functions";
import { startPlatformTenantEntry } from "@/lib/platform-tenant-entry.functions";
import { usePlatformAuthority } from "@/lib/platform-ui";
import { toast } from "sonner";

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

function EnterCompanyControl({ company }: { company: PlatformCompanyDetail }) {
  const authority = usePlatformAuthority();
  const navigate = useNavigate();
  const startFn = useServerFn(startPlatformTenantEntry);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const enter = useMutation({
    mutationFn: () =>
      startFn({ data: { companyCode: company.companyCode, confirmed: true } }),
    onSuccess: (res) => {
      setConfirmOpen(false);
      void navigate({
        to: "/$tenantSlug/workspace",
        params: { tenantSlug: res.tenantSlug },
      });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Could not enter company.");
    },
  });

  if (company.status !== "active") {
    return (
      <p className="text-sm text-muted-foreground">
        This company is not active. Platform entry is unavailable.
      </p>
    );
  }

  if (company.tenantType === "EXTERNAL") {
    return (
      <div className="space-y-2">
        <Button disabled variant="outline" type="button">
          Enter company
        </Button>
        <p className="text-xs text-muted-foreground">{EXTERNAL_ENTRY_REQUIRES_GRANT_COPY}</p>
      </div>
    );
  }

  // GROUP: Super Owner may enter; Super Admin entry requires grants (server enforces).
  if (!authority.canAccessPlatform) return null;

  return (
    <div className="space-y-2">
      <Button type="button" onClick={() => setConfirmOpen(true)}>
        Enter company
      </Button>
      <p className="text-xs text-muted-foreground">
        Explicit audited platform entry. Does not create a tenant membership.
      </p>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enter {company.companyName}?</DialogTitle>
            <DialogDescription>
              You are entering this company&apos;s operational environment using platform-level
              authority. This access will be recorded in the platform audit log and will expire
              automatically.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={enter.isPending}
              onClick={() => enter.mutate()}
            >
              {enter.isPending ? "Entering…" : "Enter company"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
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
        <EnterCompanyControl company={company} />
      </div>

      <CompanyOwnersPanel companyCode={company.companyCode} companyName={company.companyName} />
    </div>
  );
}

function CompanyOwnersPanel({
  companyCode,
  companyName,
}: {
  companyCode: string;
  companyName: string;
}) {
  const authority = usePlatformAuthority();
  const queryClient = useQueryClient();
  const listFn = useServerFn(listPlatformCompanyOwners);
  const addFn = useServerFn(addPlatformTenantOwner);
  const removeFn = useServerFn(removePlatformTenantOwner);
  const cancelFn = useServerFn(cancelPlatformOwnerInvite);
  const [addOpen, setAddOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [elevateConfirm, setElevateConfirm] = useState<{
    email: string;
    existingRoles: string[];
  } | null>(null);

  const ownersQ = useQuery({
    queryKey: ["platform-company-owners", companyCode],
    queryFn: () => listFn({ data: { companyCode } }),
    enabled: authority.isSuperOwner,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["platform-company-owners", companyCode] });
  };

  const addMut = useMutation({
    mutationFn: (opts?: { confirmElevate?: boolean }) =>
      addFn({
        data: {
          companyCode,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          confirmElevate: opts?.confirmElevate,
        },
      }),
    onSuccess: (res) => {
      if (res.outcome === "needs_confirmation") {
        setElevateConfirm({ email: res.email, existingRoles: res.existingRoles });
        return;
      }
      if (res.outcome === "already_owner") {
        toast.message(`${res.email} is already an Owner of this company.`);
      } else if (res.outcome === "added") {
        toast.success(`Owner added: ${res.email}`);
      } else if (res.outcome === "invited") {
        toast.success(`Owner invitation sent to ${res.email}`);
      }
      setAddOpen(false);
      setElevateConfirm(null);
      setFirstName("");
      setLastName("");
      setEmail("");
      refresh();
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Could not add Owner.");
    },
  });

  const removeMut = useMutation({
    mutationFn: (ownerEmail: string) =>
      removeFn({ data: { companyCode, ownerEmail } }),
    onSuccess: () => {
      toast.success("Owner removed.");
      refresh();
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Could not remove Owner.");
    },
  });

  const cancelMut = useMutation({
    mutationFn: (inviteEmail: string) =>
      cancelFn({ data: { companyCode, inviteEmail } }),
    onSuccess: () => {
      toast.success("Invitation cancelled.");
      refresh();
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Could not cancel invitation.");
    },
  });

  if (!authority.isSuperOwner) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Company Owners</CardTitle>
          <CardDescription>
            Owner administration is available to Super Owners only.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const data = ownersQ.data;
  const noOwners =
    data && !data.hasActiveOwner && !data.hasValidPendingInvite;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">Company Owners</CardTitle>
          <CardDescription>
            Platform administration of tenant Owner memberships. Does not enter the company workspace.
          </CardDescription>
        </div>
        <Button type="button" size="sm" onClick={() => setAddOpen(true)}>
          {noOwners ? "Add first owner" : "Add owner"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {ownersQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading owners…</p>
        ) : ownersQ.isError ? (
          <p className="text-sm text-destructive">Could not load Company Owners.</p>
        ) : (
          <>
            {noOwners ? (
              <p className="text-sm text-muted-foreground">No owner assigned</p>
            ) : null}

            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Active owners
              </p>
              {(data?.owners ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">None</p>
              ) : (
                <ul className="space-y-2">
                  {data!.owners.map((owner) => (
                    <li
                      key={owner.email}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium">{owner.fullName || owner.email}</p>
                        <p className="text-xs text-muted-foreground">{owner.email}</p>
                        <p className="text-xs text-muted-foreground">
                          Active
                          {owner.joinedAt
                            ? ` · Joined ${new Date(owner.joinedAt).toLocaleDateString("en-GB")}`
                            : ""}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={removeMut.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Remove Owner ${owner.email} from ${companyName}? This does not delete their account.`,
                            )
                          ) {
                            removeMut.mutate(owner.email);
                          }
                        }}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Pending invitations
              </p>
              {(data?.pendingInvites ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">None</p>
              ) : (
                <ul className="space-y-2">
                  {data!.pendingInvites.map((invite) => (
                    <li
                      key={invite.email}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium">
                          {invite.displayName || invite.email}
                        </p>
                        <p className="text-xs text-muted-foreground">{invite.email}</p>
                        <p className="text-xs text-muted-foreground">
                          Invitation expires{" "}
                          {new Date(invite.expiresAt).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={cancelMut.isPending}
                        onClick={() => cancelMut.mutate(invite.email)}
                      >
                        Cancel invitation
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add owner — {companyName}</DialogTitle>
            <DialogDescription>
              Creates an Owner membership for an existing user, or a secure Owner invitation for a
              new email. Does not create a platform role.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="owner-first">First name</Label>
              <Input
                id="owner-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="owner-last">Last name</Label>
              <Input
                id="owner-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="owner-email">Email</Label>
              <Input
                id="owner-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={addMut.isPending || !firstName.trim() || !lastName.trim() || !email.trim()}
              onClick={() => addMut.mutate({})}
            >
              {addMut.isPending ? "Saving…" : "Add owner"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(elevateConfirm)} onOpenChange={(o) => !o && setElevateConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Owner elevation</DialogTitle>
            <DialogDescription>
              {elevateConfirm?.email} is already a member of this company (
              {(elevateConfirm?.existingRoles ?? []).join(", ")}). Add Owner authority as well?
              Existing membership roles are kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setElevateConfirm(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={addMut.isPending}
              onClick={() => addMut.mutate({ confirmElevate: true })}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
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
