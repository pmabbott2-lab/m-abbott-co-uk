import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { listMySessions, createSession, getMyRole, listAllSessionsForAdvisor, deleteSession, restoreSession, listUsersWithRoles, setAdvisorRole, setIntroducerRole, listAdvisors, listAdvisorCustomers, allocateSession, unallocateSession, bulkAllocateSessions, softDeleteAdvisor, restoreAdvisor, softDeleteIntroducer, restoreIntroducer, listBinnedStaff, createStaffInvite, listStaffInvites, revokeStaffInvite, listMyCases } from "@/lib/sessions.functions";
import { listAdmins, setAdminLevel, setAdminPermissions, listUsersForAdminGrant } from "@/lib/admin.functions";
import { listFinanceLedger, setCommissionRate, getCommissionRate, getRafBonusAmount, listCommissionStaff, listCommissionRateHistory, listCommissionPayouts, FEE_TYPE_LABELS, RAF_BONUS_POUNDS } from "@/lib/finance.functions";
import {
  ADMIN_LEVEL_LABELS,
  DEFAULT_GENERAL_PERMISSIONS,
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  canView,
  canViewFinanceReport,
  canViewCommissionPayouts,
  canAmendCommissionPayouts,
  type PermissionAccess,
  type PermissionKey,
} from "@/lib/admin-access";
import type { AdvisorCustomerRow } from "@/lib/sessions.functions";
import { listAdvisorContacts, markContactOpened, getSessionBooking } from "@/lib/booking.functions";
import type { AdvisorContact } from "@/lib/booking.functions";
import { AssignVoicemailAdvisor } from "@/components/AssignVoicemailAdvisor";
import { PhoneCallDetailDialog } from "@/components/PhoneCallDetailDialog";
import { checkIsIntroducer } from "@/lib/introducer.functions";
import { claimReferral, createReferralLink, textReferralLink, textRafInviteToFriend, getPublicShareBaseUrl, listReferralLinks, listAllReferrals, updateReferralBonusStatus, searchCustomers, listMyReferralActivity, ensureMyReferralLink } from "@/lib/referrals.functions";
import { getRafCode, clearRafCookie, rafLinkForCode, rafShareMessage } from "@/lib/referral";
import { CommissionPayoutsPanel } from "@/components/CommissionPayoutsPanel";
import { MyCommissionStatementPanel } from "@/components/MyCommissionStatementPanel";
import { StaffCustomerBookingCard } from "@/components/StaffCustomerBookingCard";
import { AdvisorViewBanner } from "@/components/AdvisorViewBanner";
import { ManageListControls, ManageListScroll, type ManageListSort } from "@/components/ManageListControls";
import { TestAccountsCard } from "@/components/TestAccountsCard";
import { ReportExportBox } from "@/components/ReportExportBox";
import { ReportTableScroll } from "@/components/ReportTableScroll";
import { OwnerCustomerExportBox } from "@/components/OwnerCustomerExportBox";
import { commissionRowsToSheet, ledgerRowsToSheet } from "@/lib/report-mappers";
import { getAdvisorView } from "@/lib/advisor-view";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Mic, MessageSquare, FileText, ArrowRight, Trash2, RotateCcw, ShieldCheck, ShieldOff, CalendarCheck, CalendarDays, Link2, UserPlus, UserMinus, Users, UserCog, Search, Hash, KeyRound, Copy, Check, Clock, Mail, Gift, Send, Phone, Briefcase, ChevronRight, PhoneCall, Inbox, PoundSterling, Eye } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  PostCompletionBooking,
  CALLBACK_WINDOW_RANGES,
} from "@/components/PostCompletionBooking";

export const Route = createFileRoute("/_authenticated/home")({
  component: Home,
});

function DeleteButton({ sessionId, onDeleted }: { sessionId: string; onDeleted: () => void }) {
  const deleteFn = useServerFn(deleteSession);
  const del = useMutation({
    mutationFn: () => deleteFn({ data: { sessionId } }),
    onSuccess: () => {
      toast.success("Customer moved to Recently deleted");
      onDeleted();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not delete"),
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive"
          onClick={(e) => e.stopPropagation()}
          aria-label="Delete customer fact-find"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this customer fact-find?</AlertDialogTitle>
          <AlertDialogDescription>
            The fact-find is moved to Recently deleted and can be restored by the Owner or an Admin
            Supervisor. Answers, messages and notes are kept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={del.isPending}
            onClick={(e) => {
              e.preventDefault();
              del.mutate();
            }}
          >
            {del.isPending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Confirm + bin (soft-delete) a staff member. The bin keeps the row recoverable
// from the "Recently deleted" panel below.
function BinStaffButton({
  title,
  description,
  pending,
  onConfirm,
}: {
  title: string;
  description: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive"
          disabled={pending}
          aria-label={title}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            Move to bin
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Small copy-to-clipboard button that flips to a check for a moment.
function CopyLinkButton({
  value,
  label = "Copy link",
  successToast = "Link copied",
}: {
  value: string;
  label?: string;
  successToast?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success(successToast);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Couldn't copy — select and copy manually.");
        }
      }}
    >
      {copied ? <Check className="w-4 h-4 mr-1.5" /> : <Copy className="w-4 h-4 mr-1.5" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

function AdminPermissionMatrix({
  permissions,
  onChange,
}: {
  permissions: Record<PermissionKey, PermissionAccess>;
  onChange: (next: Record<PermissionKey, PermissionAccess>) => void;
}) {
  return (
    <div className="grid sm:grid-cols-2 gap-2">
      {PERMISSION_KEYS.map((key) => (
        <div key={key} className="flex items-center justify-between gap-2 text-sm">
          <span>{PERMISSION_LABELS[key]}</span>
          <select
            className="h-8 rounded-md border bg-background px-2 text-xs"
            value={permissions[key]}
            onChange={(e) =>
              onChange({
                ...permissions,
                [key]: e.target.value as PermissionAccess,
              })
            }
          >
            <option value="none">None</option>
            <option value="view">View</option>
            <option value="amend">Amend</option>
          </select>
        </div>
      ))}
    </div>
  );
}

function AdminAccessPanel({ isOwner }: { isOwner: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listAdmins);
  const usersFn = useServerFn(listUsersForAdminGrant);
  const setLevelFn = useServerFn(setAdminLevel);
  const setPermsFn = useServerFn(setAdminPermissions);

  const [grantUserId, setGrantUserId] = useState("");
  const [grantLevel, setGrantLevel] = useState<"supervisor" | "general">("general");
  const [grantPerms, setGrantPerms] = useState<Record<PermissionKey, PermissionAccess>>({
    ...DEFAULT_GENERAL_PERMISSIONS,
  });
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [editPerms, setEditPerms] = useState<Record<PermissionKey, PermissionAccess> | null>(null);

  const adminsQ = useQuery({ queryKey: ["admins"], queryFn: () => listFn() });
  const usersQ = useQuery({ queryKey: ["users-for-admin-grant"], queryFn: () => usersFn() });

  const setLevel = useMutation({
    mutationFn: async (vars: {
      userId: string;
      level: "supervisor" | "general" | "none";
      permissions?: Record<PermissionKey, PermissionAccess>;
    }) => {
      await setLevelFn({ data: { userId: vars.userId, level: vars.level } });
      if (vars.level === "general" && vars.permissions) {
        await setPermsFn({ data: { userId: vars.userId, permissions: vars.permissions } });
      }
    },
    onSuccess: () => {
      toast.success("Admin access updated");
      setGrantUserId("");
      setGrantPerms({ ...DEFAULT_GENERAL_PERMISSIONS });
      qc.invalidateQueries({ queryKey: ["admins"] });
      qc.invalidateQueries({ queryKey: ["my-role"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not update"),
  });

  const savePerms = useMutation({
    mutationFn: () =>
      setPermsFn({ data: { userId: editUserId!, permissions: editPerms! } }),
    onSuccess: () => {
      toast.success("Permissions saved");
      setEditUserId(null);
      qc.invalidateQueries({ queryKey: ["admins"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  const admins = adminsQ.data?.admins ?? [];
  const migrationRequired = adminsQ.data?.migrationRequired ?? false;
  const users = usersQ.data ?? [];

  return (
    <div className="space-y-6">
      {migrationRequired && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <p className="font-medium text-amber-900 dark:text-amber-100">Supabase setup needed</p>
          <p className="text-muted-foreground mt-1">
            You can preview the permission matrix below, but grants won&apos;t save until you run
            one SQL script. In Supabase → SQL Editor, paste and run{" "}
            <code className="text-xs bg-background/80 px-1 py-0.5 rounded">
              supabase/RUN_ADMIN_AND_BIN.sql
            </code>
            , then refresh this page.
          </p>
        </div>
      )}

      <div className="rounded-2xl border bg-card p-6 space-y-4">
        <div>
          <h3 className="font-semibold text-lg">Admin access</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Owner has full control. Supervisors can grant General Admin only. General Admins get a
            permission matrix (view / amend / none).
          </p>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 items-end">
          <div className="space-y-1 sm:col-span-1">
            <Label>User</Label>
            <select
              className="w-full h-9 rounded-md border bg-background px-2 text-sm"
              value={grantUserId}
              onChange={(e) => setGrantUserId(e.target.value)}
            >
              <option value="">Select user…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name || u.email || u.id}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Level</Label>
            <select
              className="w-full h-9 rounded-md border bg-background px-2 text-sm"
              value={grantLevel}
              onChange={(e) => setGrantLevel(e.target.value as "supervisor" | "general")}
            >
              {isOwner && <option value="supervisor">Admin Supervisor</option>}
              <option value="general">General Admin</option>
            </select>
          </div>
          <Button
            disabled={!grantUserId || setLevel.isPending}
            onClick={() =>
              setLevel.mutate({
                userId: grantUserId,
                level: grantLevel,
                permissions: grantLevel === "general" ? grantPerms : undefined,
              })
            }
          >
            Grant access
          </Button>
        </div>

        {grantLevel === "general" && (
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div>
              <p className="text-sm font-medium">Permission matrix</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Set each module to None, View, or Amend for this General Admin.
              </p>
            </div>
            <AdminPermissionMatrix permissions={grantPerms} onChange={setGrantPerms} />
          </div>
        )}
      </div>

      <div className="rounded-2xl border bg-card overflow-hidden">
        <div className="p-4 border-b font-medium">Current admins</div>
        {adminsQ.isLoading && <p className="p-4 text-sm text-muted-foreground">Loading…</p>}
        {adminsQ.isError && (
          <p className="p-4 text-sm text-destructive">
            {adminsQ.error instanceof Error ? adminsQ.error.message : "Could not load admins"}
          </p>
        )}
        {admins.length === 0 && !adminsQ.isLoading && !adminsQ.isError && (
          <p className="p-4 text-sm text-muted-foreground">No admins listed yet.</p>
        )}
        <ul className="divide-y">
          {admins.map((a) => (
            <li key={a.userId} className="p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium">{a.fullName || a.email || a.userId}</div>
                  <div className="text-xs text-muted-foreground">
                    {a.email} ·{" "}
                    <span className="font-medium">{ADMIN_LEVEL_LABELS[a.level]}</span>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {isOwner && a.level === "general" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={setLevel.isPending}
                      onClick={() => setLevel.mutate({ userId: a.userId, level: "supervisor" })}
                    >
                      Make supervisor
                    </Button>
                  )}
                  {a.level === "general" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditUserId(a.userId);
                        setEditPerms({ ...a.permissions });
                      }}
                    >
                      Permissions
                    </Button>
                  )}
                  {a.level !== "owner" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={setLevel.isPending}
                      onClick={() => setLevel.mutate({ userId: a.userId, level: "none" })}
                    >
                      Remove admin
                    </Button>
                  )}
                </div>
              </div>
              {editUserId === a.userId && editPerms && (
                <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Set each module to None, View, or Amend.
                  </p>
                  <AdminPermissionMatrix
                    permissions={editPerms}
                    onChange={(next) => setEditPerms(next)}
                  />
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" disabled={savePerms.isPending} onClick={() => savePerms.mutate()}>
                      Save permissions
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditUserId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function OwnerFinanceReport() {
  const ledgerFn = useServerFn(listFinanceLedger);
  const staffFn = useServerFn(listCommissionStaff);
  const setRateFn = useServerFn(setCommissionRate);
  const getRateFn = useServerFn(getCommissionRate);
  const historyFn = useServerFn(listCommissionRateHistory);
  const rafBonusFn = useServerFn(getRafBonusAmount);
  const commissionExportFn = useServerFn(listCommissionPayouts);
  const ledgerQ = useQuery({ queryKey: ["finance-ledger"], queryFn: () => ledgerFn() });
  const commissionExportQ = useQuery({
    queryKey: ["finance-export-commission"],
    queryFn: () => commissionExportFn({ data: {} }),
  });
  const rafBonusQ = useQuery({ queryKey: ["raf-bonus-amount"], queryFn: () => rafBonusFn() });
  const [rateRole, setRateRole] = useState<"advisor" | "introducer">("advisor");
  const [rateUserId, setRateUserId] = useState("");
  const [staffSearch, setStaffSearch] = useState("");
  const [pctFee, setPctFee] = useState("10");
  const [pctMortgage, setPctMortgage] = useState("10");
  const [pctInsurance, setPctInsurance] = useState("10");
  const [pctOther, setPctOther] = useState("10");
  const [introPctFee, setIntroPctFee] = useState("10");
  const [introPctMortgage, setIntroPctMortgage] = useState("10");
  const [introPctInsurance, setIntroPctInsurance] = useState("10");
  const [introPctOther, setIntroPctOther] = useState("10");

  const staffQ = useQuery({
    queryKey: ["commission-staff", rateRole, staffSearch],
    queryFn: () => staffFn({ data: { role: rateRole, query: staffSearch || undefined } }),
  });

  const existingRateQ = useQuery({
    queryKey: ["commission-rate", rateUserId, rateRole],
    queryFn: () => getRateFn({ data: { userId: rateUserId, role: rateRole } }),
    enabled: Boolean(rateUserId),
  });

  const existingIntroRateQ = useQuery({
    queryKey: ["commission-rate", rateUserId, "introducer"],
    queryFn: () => getRateFn({ data: { userId: rateUserId, role: "introducer" } }),
    enabled: Boolean(rateUserId) && rateRole === "advisor",
  });

  const historyQ = useQuery({
    queryKey: ["commission-history", rateUserId, rateRole],
    queryFn: () => historyFn({ data: { userId: rateUserId, role: rateRole } }),
    enabled: Boolean(rateUserId),
  });

  useEffect(() => {
    setRateUserId("");
  }, [rateRole]);

  useEffect(() => {
    const r = existingRateQ.data;
    if (!r || !rateUserId) return;
    if (r.pctFee != null) setPctFee(String(r.pctFee));
    if (r.pctMortgageFee != null) setPctMortgage(String(r.pctMortgageFee));
    if (r.pctInsuranceFee != null) setPctInsurance(String(r.pctInsuranceFee));
    if (r.pctOtherFee != null) setPctOther(String(r.pctOtherFee));
  }, [existingRateQ.data, rateUserId]);

  useEffect(() => {
    const r = existingIntroRateQ.data;
    if (!r || !rateUserId || rateRole !== "advisor") return;
    if (r.pctFee != null) setIntroPctFee(String(r.pctFee));
    if (r.pctMortgageFee != null) setIntroPctMortgage(String(r.pctMortgageFee));
    if (r.pctInsuranceFee != null) setIntroPctInsurance(String(r.pctInsuranceFee));
    if (r.pctOtherFee != null) setIntroPctOther(String(r.pctOtherFee));
  }, [existingIntroRateQ.data, rateUserId, rateRole]);

  const setRate = useMutation({
    mutationFn: async () => {
      await setRateFn({
        data: {
          userId: rateUserId,
          role: rateRole,
          pctFee: Number(pctFee),
          pctMortgageFee: Number(pctMortgage),
          pctInsuranceFee: Number(pctInsurance),
          pctOtherFee: Number(pctOther),
        },
      });
      if (rateRole === "advisor") {
        await setRateFn({
          data: {
            userId: rateUserId,
            role: "introducer",
            pctFee: Number(introPctFee),
            pctMortgageFee: Number(introPctMortgage),
            pctInsuranceFee: Number(introPctInsurance),
            pctOtherFee: Number(introPctOther),
          },
        });
      }
    },
    onSuccess: () => {
      toast.success("Commission rates saved — applies to new fees only");
      historyQ.refetch();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save rates"),
  });

  const rows = ledgerQ.data?.rows ?? [];
  const staff = staffQ.data ?? [];
  const rafBonusPounds =
    rafBonusQ.data?.amountPence != null ? rafBonusQ.data.amountPence / 100 : RAF_BONUS_POUNDS;
  const exportSheets = [
    ledgerRowsToSheet(rows),
    commissionRowsToSheet(commissionExportQ.data?.rows ?? []),
  ];
  const exportPdfSections = exportSheets.map((s) => ({
    title: s.name,
    headers: s.headers,
    rows: s.rows,
  }));

  if (ledgerQ.data?.migrationRequired) {
    return (
      <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
        Run the admin/finance SQL migration to enable the finance ledger.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-6 min-w-0">
    <div className="rounded-2xl border bg-card p-6 space-y-4">
      <div>
        <h3 className="font-semibold text-lg">Commission rates</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Set a separate % for each fee type. Changes apply to newly posted fees only — historical
          commission stays unchanged.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Role</Label>
          <select
            className="w-full h-9 rounded-md border bg-background px-2 text-sm"
            value={rateRole}
            onChange={(e) => setRateRole(e.target.value as "advisor" | "introducer")}
          >
            <option value="advisor">Advisor</option>
            <option value="introducer">Introducer</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label>Search</Label>
          <Input
            placeholder="Name or reference code…"
            value={staffSearch}
            onChange={(e) => setStaffSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label>{rateRole === "advisor" ? "Advisor" : "Introducer"}</Label>
        <select
          className="w-full h-9 rounded-md border bg-background px-2 text-sm"
          value={rateUserId}
          onChange={(e) => setRateUserId(e.target.value)}
        >
          <option value="">Select…</option>
          {staff.map((u) => (
            <option key={u.id} value={u.id}>
              {u.full_name || u.email}
              {u.referenceCode ? ` · ${u.referenceCode}` : ""}
            </option>
          ))}
        </select>
      </div>
      {rateUserId && (
        <>
        <div className="grid sm:grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-4">
          <div className="sm:col-span-2 text-sm font-medium">
            {rateRole === "advisor" ? "Advisor commission %" : "Introducer commission %"}
          </div>
          <div className="space-y-1">
            <Label>{FEE_TYPE_LABELS.fee} %</Label>
            <Input type="number" min="0" max="100" step="0.1" value={pctFee} onChange={(e) => setPctFee(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{FEE_TYPE_LABELS.mortgage_fee} %</Label>
            <Input type="number" min="0" max="100" step="0.1" value={pctMortgage} onChange={(e) => setPctMortgage(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{FEE_TYPE_LABELS.insurance_fee} %</Label>
            <Input type="number" min="0" max="100" step="0.1" value={pctInsurance} onChange={(e) => setPctInsurance(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{FEE_TYPE_LABELS.other_fee} %</Label>
            <Input type="number" min="0" max="100" step="0.1" value={pctOther} onChange={(e) => setPctOther(e.target.value)} />
          </div>
        </div>
        {rateRole === "advisor" && (
          <div className="grid sm:grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-4">
            <div className="sm:col-span-2 text-sm font-medium">Introducer commission % (when this advisor refers)</div>
            <div className="space-y-1">
              <Label>{FEE_TYPE_LABELS.fee} %</Label>
              <Input type="number" min="0" max="100" step="0.1" value={introPctFee} onChange={(e) => setIntroPctFee(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{FEE_TYPE_LABELS.mortgage_fee} %</Label>
              <Input type="number" min="0" max="100" step="0.1" value={introPctMortgage} onChange={(e) => setIntroPctMortgage(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{FEE_TYPE_LABELS.insurance_fee} %</Label>
              <Input type="number" min="0" max="100" step="0.1" value={introPctInsurance} onChange={(e) => setIntroPctInsurance(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{FEE_TYPE_LABELS.other_fee} %</Label>
              <Input type="number" min="0" max="100" step="0.1" value={introPctOther} onChange={(e) => setIntroPctOther(e.target.value)} />
            </div>
          </div>
        )}
        </>
      )}
      <Button disabled={!rateUserId || setRate.isPending} onClick={() => setRate.mutate()}>
        Save commission rates
      </Button>
      {rateUserId && (historyQ.data ?? []).length > 0 && (
        <div className="rounded-lg border p-4 space-y-2">
          <h4 className="text-sm font-medium">Rate change history</h4>
          <ReportTableScroll visibleRows={10}>
            <ul className="text-xs space-y-1.5 text-muted-foreground p-1">
              {(historyQ.data ?? []).map((h, i) => (
                <li key={i}>
                  {format(new Date(h.created_at), "d MMM yyyy HH:mm")} ·{" "}
                  {FEE_TYPE_LABELS[h.fee_type as keyof typeof FEE_TYPE_LABELS] ?? h.fee_type}:{" "}
                  {h.pct_from != null ? `${h.pct_from}% → ` : "new "}
                  {h.pct_to}%
                </li>
              ))}
            </ul>
          </ReportTableScroll>
        </div>
      )}
    </div>

    <div className="rounded-2xl border bg-card p-6 space-y-2">
      <h3 className="font-semibold text-lg">Refer a Friend bonus</h3>
      <p className="text-sm text-muted-foreground">
        Standard reward paid to referrers when a friend completes their fact-find and the bonus is
        marked eligible or paid.
      </p>
      <p className="text-2xl font-semibold">£{rafBonusPounds.toFixed(0)}</p>
    </div>

    <div className="rounded-2xl border bg-card p-6 space-y-4">
      <div>
        <h3 className="font-semibold text-lg">Finance ledger</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Owner only. Posted fees and commission pull-through. Amendments and deletions show in red.
        </p>
      </div>
      {ledgerQ.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {rows.length === 0 && !ledgerQ.isLoading && (
        <p className="text-sm text-muted-foreground">No finance transactions yet.</p>
      )}
      <ReportTableScroll visibleRows={10}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground bg-muted/40">
              <th className="p-2 font-medium sticky top-0 bg-muted/40">When</th>
              <th className="p-2 font-medium sticky top-0 bg-muted/40">Kind</th>
              <th className="p-2 font-medium sticky top-0 bg-muted/40">Type</th>
              <th className="p-2 font-medium text-right sticky top-0 bg-muted/40">Amount</th>
              <th className="p-2 font-medium sticky top-0 bg-muted/40">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => {
              const red = r.is_reversal || r.kind === "amend" || r.kind === "delete";
              return (
                <tr key={r.id} className={red ? "text-destructive" : ""}>
                  <td className="p-2 whitespace-nowrap">
                    {format(new Date(r.created_at), "d MMM yyyy HH:mm")}
                  </td>
                  <td className="p-2 capitalize">{r.kind}</td>
                  <td className="p-2">{r.fee_type ?? "—"}</td>
                  <td className="p-2 text-right font-medium">
                    £{(r.amount_pence / 100).toFixed(2)}
                  </td>
                  <td className="p-2 text-muted-foreground max-w-xs truncate">
                    {r.note ??
                      (r.beneficiary_role
                        ? `${r.beneficiary_role} ${r.commission_pct ?? ""}%`
                        : "—")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ReportTableScroll>
    </div>
      </div>
      <div className="self-start pt-1">
        <ReportExportBox
          filename={`finance-report-${new Date().toISOString().slice(0, 10)}`}
          label="Reports"
          sheets={exportSheets}
          pdfSections={exportPdfSections}
        />
      </div>
    </div>
  );
}

function AdvisorAccessCard() {
  const qc = useQueryClient();
  const usersFn = useServerFn(listUsersWithRoles);
  const setRoleFn = useServerFn(setAdvisorRole);
  const binFn = useServerFn(softDeleteAdvisor);

  const usersQ = useQuery({ queryKey: ["users-with-roles"], queryFn: () => usersFn() });

  const setRole = useMutation({
    mutationFn: (vars: { userId: string; makeAdvisor: boolean }) => setRoleFn({ data: vars }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users-with-roles"] });
      toast.success("Access updated");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not update access"),
  });

  const bin = useMutation({
    mutationFn: (vars: { userId: string }) => binFn({ data: vars }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users-with-roles"] });
      qc.invalidateQueries({ queryKey: ["binned-staff"] });
      toast.success("Advisor moved to bin — restore any time below.");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not bin advisor"),
  });

  const users = usersQ.data ?? [];

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ManageListSort>("alpha");
  const q = search.trim().toLowerCase();
  const advisorUsers = users.filter((u) => u.isAdvisor);
  const filteredUsers = advisorUsers
    .filter((u) => {
      if (!q) return true;
      return [u.full_name, u.email].filter(Boolean).join(" ").toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (sort === "alpha") {
        return (a.full_name || a.email || "").localeCompare(b.full_name || b.email || "");
      }
      return 0;
    });

  return (
    <div className="mt-10">
      <h3 className="text-sm font-medium text-muted-foreground mb-3">Team access</h3>
      <div className="rounded-2xl border bg-card overflow-hidden">
        <div className="p-4 text-xs text-muted-foreground border-b">
          Advisors can view allocated customers and book appointments. Add new advisors using invite
          links below — existing advisors can be removed or moved to the deleted bin.
        </div>
        <ManageListControls
          search={search}
          onSearchChange={setSearch}
          sort={sort}
          onSortChange={setSort}
          searchPlaceholder="Search advisors by name or email…"
        />
        <ManageListScroll>
        {usersQ.isLoading && <div className="p-4 text-sm text-muted-foreground">Loading people…</div>}
        {usersQ.isError && (
          <div className="p-4 text-sm text-muted-foreground">Couldn&apos;t load the people list.</div>
        )}
        {!usersQ.isLoading && advisorUsers.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">No advisors yet — send an invite link.</div>
        )}
        {!usersQ.isLoading && advisorUsers.length > 0 && filteredUsers.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">No matches.</div>
        )}
        {filteredUsers.map((u) => (
          <div key={u.id} className="flex items-center gap-3 p-4">
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{u.full_name || u.email || "Unnamed user"}</div>
              <div className="text-xs text-muted-foreground truncate">
                {u.email}
                {u.isAdvisor && <span className="ml-2 text-accent-foreground">· Advisor</span>}
                {u.isAdvisor && u.advisorCode && (
                  <span className="ml-2 inline-flex items-center gap-1 font-mono text-foreground">
                    <KeyRound className="w-3 h-3" />
                    {u.advisorCode}
                  </span>
                )}
                {u.isSelf && <span className="ml-2">· You</span>}
              </div>
            </div>
            {u.isAdvisor ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={u.isSelf || (setRole.isPending && setRole.variables?.userId === u.id)}
                  title={u.isSelf ? "You can't remove your own access" : undefined}
                  onClick={() => setRole.mutate({ userId: u.id, makeAdvisor: false })}
                >
                  <ShieldOff className="w-4 h-4 mr-1.5" />
                  Remove advisor
                </Button>
                {!u.isSelf && (
                  <BinStaffButton
                    title="Move advisor to bin?"
                    description="This removes their advisor access but keeps their advisor code and data. You can restore them any time from Recently deleted. Their account and any customer data are not deleted."
                    pending={bin.isPending && bin.variables?.userId === u.id}
                    onConfirm={() => bin.mutate({ userId: u.id })}
                  />
                )}
              </>
            ) : null}
          </div>
        ))}
        </ManageListScroll>
      </div>
    </div>
  );
}

type IntroducerSetVars = {
  userId: string;
  makeIntroducer: boolean;
  companyMode?: "new" | "join";
  companyCode?: string;
};

function MakeIntroducerDialog({
  userId,
  pending,
  onConfirm,
}: {
  userId: string;
  pending: boolean;
  onConfirm: (vars: IntroducerSetVars) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"new" | "join">("new");
  const [code, setCode] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" disabled={pending}>
          <UserPlus className="w-4 h-4 mr-1.5" />
          Make introducer
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Grant introducer access</DialogTitle>
          <DialogDescription>
            Introducers belong to a company identified by a shared 4-digit code. Create a new company
            or link this person to an existing one.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer">
            <input
              type="radio"
              className="mt-1"
              checked={mode === "new"}
              onChange={() => setMode("new")}
            />
            <span className="text-sm">
              <span className="font-medium">Create new company</span>
              <span className="block text-xs text-muted-foreground">
                Generates a fresh unique 4-digit company code.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer">
            <input
              type="radio"
              className="mt-1"
              checked={mode === "join"}
              onChange={() => setMode("join")}
            />
            <span className="text-sm flex-1">
              <span className="font-medium">Join existing company</span>
              <span className="block text-xs text-muted-foreground mb-2">
                Enter the company&apos;s 4-digit code to link this person to it.
              </span>
              {mode === "join" && (
                <Input
                  autoFocus
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="0000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  className="font-mono w-28"
                />
              )}
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button
            disabled={pending || (mode === "join" && code.length !== 4)}
            onClick={() => {
              onConfirm({
                userId,
                makeIntroducer: true,
                companyMode: mode,
                companyCode: mode === "join" ? code : undefined,
              });
              setOpen(false);
            }}
          >
            {mode === "join" ? "Link to company" : "Create & grant"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IntroducerAccessCard() {
  const qc = useQueryClient();
  const usersFn = useServerFn(listUsersWithRoles);
  const setRoleFn = useServerFn(setIntroducerRole);
  const binFn = useServerFn(softDeleteIntroducer);

  const usersQ = useQuery({ queryKey: ["users-with-roles"], queryFn: () => usersFn() });

  const setRole = useMutation({
    mutationFn: (vars: IntroducerSetVars) => setRoleFn({ data: vars }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["users-with-roles"] });
      qc.invalidateQueries({ queryKey: ["is-introducer"] });
      const code = (res as { companyCode?: string }).companyCode;
      toast.success(code ? `Introducer access updated · company code ${code}` : "Introducer access updated");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not update access"),
  });

  const bin = useMutation({
    mutationFn: (vars: { userId: string }) => binFn({ data: vars }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users-with-roles"] });
      qc.invalidateQueries({ queryKey: ["is-introducer"] });
      qc.invalidateQueries({ queryKey: ["binned-staff"] });
      toast.success("Introducer moved to bin — restore any time below.");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not bin introducer"),
  });

  const users = usersQ.data ?? [];

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ManageListSort>("alpha");
  const q = search.trim().toLowerCase();
  const introducerUsers = users;
  const filteredUsers = introducerUsers
    .filter((u) => {
      if (!q) return true;
      return [u.full_name, u.email].filter(Boolean).join(" ").toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (sort === "alpha") {
        return (a.full_name || a.email || "").localeCompare(b.full_name || b.email || "");
      }
      return 0;
    });

  return (
    <div className="mt-10">
      <h3 className="text-sm font-medium text-muted-foreground mb-3">Introducer access</h3>
      <div className="rounded-2xl border bg-card overflow-hidden">
        <div className="p-4 text-xs text-muted-foreground border-b">
          Introducers get a referral portal with shareable links and lead tracking. Multiple
          introducers can share a company via its 4-digit code so referrals credit the company.
        </div>
        <ManageListControls
          search={search}
          onSearchChange={setSearch}
          sort={sort}
          onSortChange={setSort}
          searchPlaceholder="Search introducers by name or email…"
        />
        <ManageListScroll>
        {usersQ.isLoading && <div className="p-4 text-sm text-muted-foreground">Loading people…</div>}
        {usersQ.isError && (
          <div className="p-4 text-sm text-muted-foreground">Couldn&apos;t load the people list.</div>
        )}
        {!usersQ.isLoading && introducerUsers.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">No introducers yet.</div>
        )}
        {!usersQ.isLoading && introducerUsers.length > 0 && filteredUsers.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">No matches.</div>
        )}
        {filteredUsers.map((u) => (
          <div key={u.id} className="flex items-center gap-3 p-4">
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{u.full_name || u.email || "Unnamed user"}</div>
              <div className="text-xs text-muted-foreground truncate">
                {u.email}
                {u.isIntroducer && <span className="ml-2 text-accent-foreground">· Introducer</span>}
                {u.isIntroducer && u.companyCode && (
                  <span className="ml-2 inline-flex items-center gap-1 font-mono text-foreground">
                    <Hash className="w-3 h-3" />
                    {u.companyCode}
                    {u.companyName ? ` · ${u.companyName}` : ""}
                  </span>
                )}
                {u.isSelf && <span className="ml-2">· You</span>}
              </div>
            </div>
            {u.isIntroducer ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={setRole.isPending && setRole.variables?.userId === u.id}
                  onClick={() => setRole.mutate({ userId: u.id, makeIntroducer: false })}
                >
                  <UserMinus className="w-4 h-4 mr-1.5" />
                  Remove introducer
                </Button>
                <BinStaffButton
                  title="Move introducer to bin?"
                  description="This removes their introducer access and deactivates their referral links, but keeps their company linkage and lead data. You can restore them any time from Recently deleted. Their account is not deleted."
                  pending={bin.isPending && bin.variables?.userId === u.id}
                  onConfirm={() => bin.mutate({ userId: u.id })}
                />
              </>
            ) : (
              <MakeIntroducerDialog
                userId={u.id}
                pending={setRole.isPending && setRole.variables?.userId === u.id}
                onConfirm={(vars) => setRole.mutate(vars)}
              />
            )}
          </div>
        ))}
        </ManageListScroll>
      </div>
    </div>
  );
}

// "Recently deleted" bin: lists soft-deleted advisors, introducers, and customer
// fact-finds with a Restore action. Owner / Admin Supervisor only.
function RecentlyDeletedCard() {
  const qc = useQueryClient();
  const binnedFn = useServerFn(listBinnedStaff);
  const restoreAdvisorFn = useServerFn(restoreAdvisor);
  const restoreIntroducerFn = useServerFn(restoreIntroducer);
  const restoreSessionFn = useServerFn(restoreSession);

  const binnedQ = useQuery({ queryKey: ["binned-staff"], queryFn: () => binnedFn() });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["binned-staff"] });
    qc.invalidateQueries({ queryKey: ["users-with-roles"] });
    qc.invalidateQueries({ queryKey: ["is-introducer"] });
    qc.invalidateQueries({ queryKey: ["all-sessions"] });
    qc.invalidateQueries({ queryKey: ["my-sessions"] });
  };

  const restoreAdv = useMutation({
    mutationFn: (vars: { userId: string }) => restoreAdvisorFn({ data: vars }),
    onSuccess: () => {
      invalidateAll();
      toast.success("Advisor restored");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not restore"),
  });

  const restoreIntro = useMutation({
    mutationFn: (vars: { userId: string }) => restoreIntroducerFn({ data: vars }),
    onSuccess: () => {
      invalidateAll();
      toast.success("Introducer restored");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not restore"),
  });

  const restoreCustomer = useMutation({
    mutationFn: (vars: { sessionId: string }) => restoreSessionFn({ data: vars }),
    onSuccess: () => {
      invalidateAll();
      toast.success("Customer fact-find restored");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not restore"),
  });

  const [deletedSearch, setDeletedSearch] = useState("");
  const [deletedSort, setDeletedSort] = useState<ManageListSort>("date");
  const deletedQ = deletedSearch.trim().toLowerCase();
  const sortDeleted = <T extends { customerName?: string | null; customerEmail?: string | null; full_name?: string | null; email?: string | null }>(
    items: T[],
    nameFn: (i: T) => string,
  ) =>
    [...items]
      .filter((i) => {
        if (!deletedQ) return true;
        return nameFn(i).toLowerCase().includes(deletedQ);
      })
      .sort((a, b) => {
        if (deletedSort === "alpha") return nameFn(a).localeCompare(nameFn(b));
        return 0;
      });

  const advisors = sortDeleted(binnedQ.data?.advisors ?? [], (a) => a.full_name || a.email || "");
  const introducers = sortDeleted(binnedQ.data?.introducers ?? [], (i) => i.full_name || i.email || "");
  const customers = sortDeleted(
    binnedQ.data?.customers ?? [],
    (c) => c.customerName || c.customerEmail || "",
  );
  const isEmpty = advisors.length === 0 && introducers.length === 0 && customers.length === 0;

  return (
    <div className="mt-10">
      <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
        <Trash2 className="w-4 h-4" />
        Recently deleted
      </h3>
      <div className="rounded-2xl border bg-card divide-y">
        <div className="p-4 text-xs text-muted-foreground">
          Binned customers, advisors and introducers are kept here and can be restored any time by
          the Owner or an Admin Supervisor. Restoring reinstates access; data is never permanently
          removed from the bin.
        </div>
        <ManageListControls
          search={deletedSearch}
          onSearchChange={setDeletedSearch}
          sort={deletedSort}
          onSortChange={setDeletedSort}
          searchPlaceholder="Search deleted records…"
        />
        <ManageListScroll>
        {binnedQ.isLoading && <div className="p-4 text-sm text-muted-foreground">Loading bin…</div>}
        {binnedQ.isError && (
          <div className="p-4 text-sm text-destructive">
            {binnedQ.error instanceof Error ? binnedQ.error.message : "Could not load bin"}
          </div>
        )}
        {!binnedQ.isLoading && !binnedQ.isError && isEmpty && (
          <div className="p-4 text-sm text-muted-foreground">Nothing in the bin.</div>
        )}
        {customers.map((c) => (
          <div key={`cust-${c.sessionId}`} className="flex items-center gap-3 p-4">
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">
                {c.customerName || c.customerEmail || "Unnamed customer"}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {c.customerEmail}
                <span className="ml-2 text-accent-foreground">· Customer fact-find (binned)</span>
                <span className="ml-2">
                  · {c.status === "submitted" ? "Submitted" : "In progress"}
                </span>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={
                restoreCustomer.isPending && restoreCustomer.variables?.sessionId === c.sessionId
              }
              onClick={() => restoreCustomer.mutate({ sessionId: c.sessionId })}
            >
              <RotateCcw className="w-4 h-4 mr-1.5" />
              Restore
            </Button>
          </div>
        ))}
        {advisors.map((a) => (
          <div key={`adv-${a.id}`} className="flex items-center gap-3 p-4">
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{a.full_name || a.email || "Unnamed user"}</div>
              <div className="text-xs text-muted-foreground truncate">
                {a.email}
                <span className="ml-2 text-accent-foreground">· Advisor (binned)</span>
                {a.code && (
                  <span className="ml-2 inline-flex items-center gap-1 font-mono text-foreground">
                    <KeyRound className="w-3 h-3" />
                    {a.code}
                  </span>
                )}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={restoreAdv.isPending && restoreAdv.variables?.userId === a.id}
              onClick={() => restoreAdv.mutate({ userId: a.id })}
            >
              <RotateCcw className="w-4 h-4 mr-1.5" />
              Restore
            </Button>
          </div>
        ))}
        {introducers.map((i) => (
          <div key={`intro-${i.id}`} className="flex items-center gap-3 p-4">
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{i.full_name || i.email || "Unnamed user"}</div>
              <div className="text-xs text-muted-foreground truncate">
                {i.email}
                <span className="ml-2 text-accent-foreground">· Introducer (binned)</span>
                {i.companyCode && (
                  <span className="ml-2 inline-flex items-center gap-1 font-mono text-foreground">
                    <Hash className="w-3 h-3" />
                    {i.companyCode}
                    {i.companyName ? ` · ${i.companyName}` : ""}
                  </span>
                )}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={restoreIntro.isPending && restoreIntro.variables?.userId === i.id}
              onClick={() => restoreIntro.mutate({ userId: i.id })}
            >
              <RotateCcw className="w-4 h-4 mr-1.5" />
              Restore
            </Button>
          </div>
        ))}
        </ManageListScroll>
      </div>
    </div>
  );
}

type CreatedInvite = { token: string; role: string; email: string | null; expires_at: string };

function inviteLink(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/register?invite=${token}`;
}

// Create shareable staff invite links + manage existing invites.
function InviteStaffCard() {
  const qc = useQueryClient();
  const createFn = useServerFn(createStaffInvite);
  const listFn = useServerFn(listStaffInvites);
  const revokeFn = useServerFn(revokeStaffInvite);

  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<"advisor" | "introducer">("advisor");
  const [email, setEmail] = useState("");
  const [companyMode, setCompanyMode] = useState<"new" | "join">("new");
  const [companyCode, setCompanyCode] = useState("");
  const [created, setCreated] = useState<CreatedInvite | null>(null);

  const invitesQ = useQuery({ queryKey: ["staff-invites"], queryFn: () => listFn() });

  const create = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          role,
          email: email.trim() || undefined,
          companyMode: role === "introducer" ? companyMode : undefined,
          companyCode: role === "introducer" && companyMode === "join" ? companyCode : undefined,
        },
      }),
    onSuccess: (res) => {
      setCreated(res as CreatedInvite);
      qc.invalidateQueries({ queryKey: ["staff-invites"] });
      toast.success("Invite link created");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not create invite"),
  });

  const revoke = useMutation({
    mutationFn: (vars: { id: string }) => revokeFn({ data: vars }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-invites"] });
      toast.success("Invite revoked");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not revoke invite"),
  });

  const resetForm = () => {
    setRole("advisor");
    setEmail("");
    setCompanyMode("new");
    setCompanyCode("");
    setCreated(null);
  };

  const invites = invitesQ.data ?? [];

  const inviteStatus = (inv: {
    used_at: string | null;
    expires_at: string;
  }): { label: string; tone: string } => {
    if (inv.used_at) return { label: "Used", tone: "text-muted-foreground" };
    if (new Date(inv.expires_at).getTime() < Date.now()) {
      return { label: "Expired", tone: "text-amber-600 dark:text-amber-500" };
    }
    return { label: "Open", tone: "text-accent-foreground" };
  };

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Mail className="w-4 h-4" />
          Invite new staff
        </h3>
        <Dialog
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm">
              <UserPlus className="w-4 h-4 mr-1.5" />
              Create invite link
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create a staff invite link</DialogTitle>
              <DialogDescription>
                Generates a shareable registration link. The recipient sets their own password and is
                granted the chosen role automatically — no customer signup required.
              </DialogDescription>
            </DialogHeader>

            {created ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
                  <p className="text-sm font-medium text-foreground">
                    Invite ready — share this link with the new {created.role}.
                  </p>
                  <p className="text-xs text-muted-foreground break-all font-mono">
                    {inviteLink(created.token)}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <CopyLinkButton value={inviteLink(created.token)} />
                    {created.email && (
                      <Button asChild variant="outline" size="sm">
                        <a
                          href={`mailto:${created.email}?subject=${encodeURIComponent("Your Mortgage Hub invitation")}&body=${encodeURIComponent(`You've been invited to join Mortgage Hub. Use this link to set up your account:\n\n${inviteLink(created.token)}`)}`}
                        >
                          <Mail className="w-4 h-4 mr-1.5" />
                          Email link
                        </a>
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Expires {formatDistanceToNow(new Date(created.expires_at), { addSuffix: true })}.
                  </p>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={resetForm}>
                    Create another
                  </Button>
                  <Button onClick={() => setOpen(false)}>Done</Button>
                </DialogFooter>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <span className="text-sm font-medium">Role</span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRole("advisor")}
                      className={`flex items-center gap-2 rounded-lg border p-3 text-sm text-left ${role === "advisor" ? "border-primary bg-primary/5" : ""}`}
                    >
                      <ShieldCheck className="w-4 h-4" /> Advisor
                    </button>
                    <button
                      type="button"
                      onClick={() => setRole("introducer")}
                      className={`flex items-center gap-2 rounded-lg border p-3 text-sm text-left ${role === "introducer" ? "border-primary bg-primary/5" : ""}`}
                    >
                      <Link2 className="w-4 h-4" /> Introducer
                    </button>
                  </div>
                </div>

                {role === "introducer" && (
                  <div className="space-y-2">
                    <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer">
                      <input
                        type="radio"
                        className="mt-1"
                        checked={companyMode === "new"}
                        onChange={() => setCompanyMode("new")}
                      />
                      <span className="text-sm">
                        <span className="font-medium">Create new company</span>
                        <span className="block text-xs text-muted-foreground">
                          A fresh 4-digit company code is generated when they register.
                        </span>
                      </span>
                    </label>
                    <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer">
                      <input
                        type="radio"
                        className="mt-1"
                        checked={companyMode === "join"}
                        onChange={() => setCompanyMode("join")}
                      />
                      <span className="text-sm flex-1">
                        <span className="font-medium">Join existing company</span>
                        <span className="block text-xs text-muted-foreground mb-2">
                          Enter the company&apos;s 4-digit code to link them to it.
                        </span>
                        {companyMode === "join" && (
                          <Input
                            inputMode="numeric"
                            maxLength={4}
                            placeholder="0000"
                            value={companyCode}
                            onChange={(e) => setCompanyCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                            className="font-mono w-28"
                          />
                        )}
                      </span>
                    </label>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="invite-email">Email (optional)</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Pre-fills their email on the registration page and lets you email the link. The
                    link works without it.
                  </p>
                </div>

                <DialogFooter>
                  <Button
                    disabled={
                      create.isPending ||
                      (role === "introducer" && companyMode === "join" && companyCode.length !== 4)
                    }
                    onClick={() => create.mutate()}
                  >
                    {create.isPending ? "Creating…" : "Create link"}
                  </Button>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-2xl border bg-card divide-y">
        <div className="p-4 text-xs text-muted-foreground">
          Invite links let new advisors or introducers register themselves with the right role. Links
          expire after 14 days.
        </div>
        {invitesQ.isLoading && <div className="p-4 text-sm text-muted-foreground">Loading invites…</div>}
        {!invitesQ.isLoading && invites.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">No invites yet.</div>
        )}
        {invites.map((inv) => {
          const st = inviteStatus(inv);
          const isOpen = !inv.used_at && new Date(inv.expires_at).getTime() >= Date.now();
          return (
            <div key={inv.id} className="flex items-center gap-3 p-4">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate capitalize flex items-center gap-2">
                  {inv.role}
                  {inv.role === "introducer" && (
                    <span className="text-xs font-normal text-muted-foreground">
                      {inv.create_company ? "· new company" : inv.company_code ? `· joins ${inv.company_code}` : ""}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate flex items-center gap-2">
                  <span className={st.tone}>{st.label}</span>
                  {inv.email && <span>· {inv.email}</span>}
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {inv.used_at
                      ? `used ${formatDistanceToNow(new Date(inv.used_at), { addSuffix: true })}`
                      : `expires ${formatDistanceToNow(new Date(inv.expires_at), { addSuffix: true })}`}
                  </span>
                </div>
              </div>
              {isOpen && (
                <>
                  <CopyLinkButton value={inviteLink(inv.token)} />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Revoke invite"
                    disabled={revoke.isPending && revoke.variables?.id === inv.id}
                    onClick={() => revoke.mutate({ id: inv.id })}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// Refer a friend (RAF) — ADMIN panel.
// The admin mints a referral link tied to a REFERRER (existing user or
// name+phone), can text/copy it to the referrer, and monitors all referrals +
// bonus statuses. Bonus is tracked-only (no payouts).
// ============================================================================

type ReferralLink = {
  id: string;
  code: string;
  referrer_user_id: string | null;
  referrer_name: string | null;
  referrer_phone: string | null;
  active: boolean;
  created_at: string;
  referralCount: number;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  signed_up: "Signed up",
  qualified: "Qualified",
  rewarded: "Rewarded",
};

const BONUS_LABEL: Record<string, string> = {
  none: "No bonus",
  eligible: "Eligible",
  paid: "Paid",
};

type CustomerResult = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
};

function customerLabel(c: CustomerResult): string {
  return c.full_name || c.email || "Unnamed user";
}

// Small debounce so the customer search hits the server at most ~3x/second.
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function CreateReferralLinkDialog({ onCreated }: { onCreated: () => void }) {
  const createFn = useServerFn(createReferralLink);
  const textFn = useServerFn(textReferralLink);
  const textFriendFn = useServerFn(textRafInviteToFriend);
  const publicUrlFn = useServerFn(getPublicShareBaseUrl);
  const searchFn = useServerFn(searchCustomers);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"existing" | "external">("existing");
  const [customerQuery, setCustomerQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerResult | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [friendPhone, setFriendPhone] = useState("");
  const [created, setCreated] = useState<ReferralLink | null>(null);

  const publicUrlQ = useQuery({
    queryKey: ["public-share-url"],
    queryFn: () => publicUrlFn(),
    enabled: open,
  });
  const shareBase = publicUrlQ.data?.baseUrl;

  const debouncedQuery = useDebouncedValue(customerQuery.trim(), 300);
  const searchQ = useQuery({
    queryKey: ["search-customers", debouncedQuery],
    queryFn: () => searchFn({ data: { query: debouncedQuery } }),
    enabled: open && mode === "existing" && !selectedCustomer && debouncedQuery.length >= 2,
  });
  const results = (searchQ.data ?? []) as CustomerResult[];

  const create = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          referrerUserId: mode === "existing" ? selectedCustomer?.id || undefined : undefined,
          referrerName: mode === "external" ? name.trim() || undefined : undefined,
          referrerPhone: mode === "external" ? phone.trim() || undefined : undefined,
        },
      }),
    onSuccess: (res) => {
      setCreated({ ...(res as ReferralLink), referralCount: 0 });
      onCreated();
      toast.success("Referral link created");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not create link"),
  });

  const text = useMutation({
    mutationFn: (vars: { id: string }) => textFn({ data: vars }),
    onSuccess: () => toast.success("Link texted to the referrer"),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not text link"),
  });

  const textFriend = useMutation({
    mutationFn: (vars: { id: string; friendPhone: string }) => textFriendFn({ data: vars }),
    onSuccess: () => toast.success("Invite texted to your friend"),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not text friend"),
  });

  const reset = () => {
    setMode("existing");
    setCustomerQuery("");
    setSelectedCustomer(null);
    setName("");
    setPhone("");
    setFriendPhone("");
    setCreated(null);
  };

  const canSubmit = mode === "existing" ? !!selectedCustomer : name.trim().length >= 2;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Gift className="w-4 h-4 mr-1.5" />
          Create referral link
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a referral link</DialogTitle>
          <DialogDescription>
            Mint a personal link for a referrer. They share it with friends; when a friend signs up
            the referral is credited to the referrer and their bonus is tracked here.
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
              <p className="text-sm font-medium text-foreground">
                Link ready for {created.referrer_name || "your referrer"}.
              </p>
              <p className="text-xs text-muted-foreground break-all font-mono">
                {rafLinkForCode(created.code, shareBase)}
              </p>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap border rounded-lg p-3 bg-muted/30">
                {rafShareMessage(created.referrer_name, created.code, shareBase)}
              </p>
              <div className="flex flex-wrap gap-2">
                <CopyLinkButton
                  value={rafShareMessage(created.referrer_name, created.code, shareBase)}
                  label="Copy message for friend"
                  successToast="Share message copied"
                />
                <CopyLinkButton value={rafLinkForCode(created.code, shareBase)} label="Copy link only" />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!created.referrer_phone || text.isPending}
                  title={created.referrer_phone ? "Texts the referrer so they can forward the link" : "No phone on file for this referrer"}
                  onClick={() => text.mutate({ id: created.id })}
                >
                  <Send className="w-4 h-4 mr-1.5" />
                  {text.isPending ? "Texting…" : "Text referrer"}
                </Button>
              </div>
              <div className="space-y-2 pt-2 border-t">
                <Label htmlFor="raf-friend-phone">Text a friend directly</Label>
                <div className="flex flex-wrap gap-2">
                  <Input
                    id="raf-friend-phone"
                    type="tel"
                    placeholder="Friend's mobile (07…)"
                    value={friendPhone}
                    onChange={(e) => setFriendPhone(e.target.value)}
                    className="max-w-xs"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!friendPhone.trim() || textFriend.isPending}
                    onClick={() =>
                      textFriend.mutate({ id: created.id, friendPhone: friendPhone.trim() })
                    }
                  >
                    <Send className="w-4 h-4 mr-1.5" />
                    {textFriend.isPending ? "Sending…" : "Text friend"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Sends the full message including who recommended Mortgage Hub — ready for SMS or WhatsApp.
                </p>
              </div>
              {!created.referrer_phone && (
                <p className="text-xs text-muted-foreground">
                  No phone number on file — copy the message above and share it manually (SMS, email or WhatsApp).
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                Create another
              </Button>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("existing")}
                className={`flex items-center gap-2 rounded-lg border p-3 text-sm text-left ${mode === "existing" ? "border-primary bg-primary/5" : ""}`}
              >
                <Users className="w-4 h-4" /> Existing customer
              </button>
              <button
                type="button"
                onClick={() => setMode("external")}
                className={`flex items-center gap-2 rounded-lg border p-3 text-sm text-left ${mode === "external" ? "border-primary bg-primary/5" : ""}`}
              >
                <UserPlus className="w-4 h-4" /> Someone new
              </button>
            </div>

            {mode === "existing" ? (
              <div className="space-y-1.5">
                <Label htmlFor="raf-user">Referrer</Label>
                {selectedCustomer ? (
                  <div className="flex items-center gap-3 rounded-lg border p-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{customerLabel(selectedCustomer)}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {[selectedCustomer.email, selectedCustomer.phone].filter(Boolean).join(" · ") || "No contact details on file"}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedCustomer(null);
                        setCustomerQuery("");
                      }}
                    >
                      Change
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="raf-user"
                        autoComplete="off"
                        placeholder="Search by name, email or phone…"
                        value={customerQuery}
                        onChange={(e) => setCustomerQuery(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                    {debouncedQuery.length >= 2 && (
                      <div className="rounded-lg border divide-y max-h-56 overflow-y-auto">
                        {searchQ.isLoading && (
                          <div className="p-3 text-sm text-muted-foreground">Searching…</div>
                        )}
                        {searchQ.isError && (
                          <div className="p-3 text-sm text-muted-foreground">
                            Couldn&apos;t search customers. Try again.
                          </div>
                        )}
                        {!searchQ.isLoading && !searchQ.isError && results.length === 0 && (
                          <div className="p-3 text-sm text-muted-foreground">
                            No customers match &quot;{debouncedQuery}&quot;.
                          </div>
                        )}
                        {results.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setSelectedCustomer(c)}
                            className="w-full text-left p-3 hover:bg-muted/50 transition"
                          >
                            <div className="font-medium truncate">{customerLabel(c)}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {[c.email, c.phone].filter(Boolean).join(" · ") || "No contact details"}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Search to find the referrer. We&apos;ll use their saved name and phone for the
                      link and the &quot;Text link&quot; button.
                    </p>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="raf-name">Referrer name</Label>
                  <Input
                    id="raf-name"
                    placeholder="Jane Smith"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="raf-phone">Mobile number (optional)</Label>
                  <Input
                    id="raf-phone"
                    type="tel"
                    inputMode="tel"
                    placeholder="07…"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Add a number to text them the link. Without it you can still copy and share it.
                  </p>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button disabled={!canSubmit || create.isPending} onClick={() => create.mutate()}>
                {create.isPending ? "Creating…" : "Create link"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RafLinksAccessCard() {
  const qc = useQueryClient();
  const linksFn = useServerFn(listReferralLinks);
  const referralsFn = useServerFn(listAllReferrals);
  const textFn = useServerFn(textReferralLink);
  const publicUrlFn = useServerFn(getPublicShareBaseUrl);
  const updateFn = useServerFn(updateReferralBonusStatus);

  const linksQ = useQuery({ queryKey: ["referral-links"], queryFn: () => linksFn() });
  const referralsQ = useQuery({ queryKey: ["all-referrals"], queryFn: () => referralsFn() });
  const publicUrlQ = useQuery({ queryKey: ["public-share-url"], queryFn: () => publicUrlFn() });
  const shareBase = publicUrlQ.data?.baseUrl;

  const text = useMutation({
    mutationFn: (vars: { id: string }) => textFn({ data: vars }),
    onSuccess: () => toast.success("Link texted to the referrer"),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not text link"),
  });

  const updateBonus = useMutation({
    mutationFn: (vars: { id: string; bonusStatus: "none" | "eligible" | "paid" }) =>
      updateFn({ data: vars }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["all-referrals"] });
      toast.success("Bonus status updated");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not update bonus"),
  });

  const links = (linksQ.data ?? []) as ReferralLink[];
  const referrals = referralsQ.data ?? [];

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Gift className="w-4 h-4" />
          Refer-a-friend links
        </h3>
        <CreateReferralLinkDialog
          onCreated={() => qc.invalidateQueries({ queryKey: ["referral-links"] })}
        />
      </div>

      <div className="rounded-2xl border bg-card divide-y">
        <div className="p-4 text-xs text-muted-foreground">
          Create personal links for referrers (existing customers or external contacts). Friends
          sign up via the link; qualified referrals appear on the Commission tab for payout.
        </div>
        {linksQ.isLoading && <div className="p-4 text-sm text-muted-foreground">Loading links…</div>}
        {!linksQ.isLoading && links.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">
            No referral links yet — create one above.
          </div>
        )}
        {links.map((l) => {
          const linkReferrals = referrals.filter((r) => r.code === l.code);
          return (
            <div key={l.id} className="p-4 sm:p-5 space-y-4 border-b last:border-b-0">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-3">
                  <div>
                    <div className="font-semibold text-base">{l.referrer_name || "Referrer"}</div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {l.referralCount} referral{l.referralCount === 1 ? "" : "s"} · £75 bonus when
                      eligible
                    </p>
                  </div>
                  <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                    {l.referrer_phone && (
                      <>
                        <dt className="text-muted-foreground">Referrer mobile</dt>
                        <dd>{l.referrer_phone}</dd>
                      </>
                    )}
                    <dt className="text-muted-foreground">Link code</dt>
                    <dd className="font-mono">{l.code}</dd>
                    <dt className="text-muted-foreground">Share link</dt>
                    <dd className="break-all text-xs font-mono">
                      {rafLinkForCode(l.code, shareBase)}
                    </dd>
                  </dl>
                </div>
                <div className="flex flex-col sm:flex-row flex-wrap gap-2 shrink-0">
                  <CopyLinkButton
                    value={rafShareMessage(l.referrer_name, l.code, shareBase)}
                    label="Copy message"
                    successToast="Share message copied"
                  />
                  <CopyLinkButton value={rafLinkForCode(l.code, shareBase)} label="Copy link" />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!l.referrer_phone || (text.isPending && text.variables?.id === l.id)}
                    title={
                      l.referrer_phone
                        ? "Texts the referrer so they can forward the link"
                        : "No phone on file for this referrer"
                    }
                    onClick={() => text.mutate({ id: l.id })}
                  >
                    <Send className="w-4 h-4 mr-1.5" />
                    Text referrer
                  </Button>
                </div>
              </div>

              {linkReferrals.length > 0 ? (
                <div className="rounded-xl border bg-muted/30 p-3 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Referred friends
                  </p>
                  <ul className="divide-y rounded-lg border bg-background">
                    {linkReferrals.map((r) => (
                      <li
                        key={r.id}
                        className="p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm"
                      >
                        <div className="min-w-0">
                          <div className="font-medium">{r.referredName}</div>
                          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                            {r.referredEmail && <span>{r.referredEmail}</span>}
                            {r.referredPhone && <span>{r.referredPhone}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 flex-wrap">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-muted">
                            {STATUS_LABEL[r.status] ?? r.status}
                          </span>
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${r.bonus_status === "paid" ? "bg-accent/30" : r.bonus_status === "eligible" ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400" : "bg-muted"}`}
                          >
                            {BONUS_LABEL[r.bonus_status] ?? r.bonus_status}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No friends have used this link yet.</p>
              )}
            </div>
          );
        })}
      </div>

      <h3 className="text-sm font-medium text-muted-foreground mb-3 mt-8 flex items-center gap-2">
        <Users className="w-4 h-4" />
        All referrals &amp; bonuses
      </h3>
      <div className="rounded-2xl border bg-card divide-y">
        <div className="p-4 text-xs text-muted-foreground">
          Every friend credited to a referrer. Status advances automatically (signed up → qualified
          when they complete a fact-find). Update the bonus status as you process rewards.
        </div>
        {referralsQ.isLoading && (
          <div className="p-4 text-sm text-muted-foreground">Loading referrals…</div>
        )}
        {!referralsQ.isLoading && referrals.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">No referrals yet.</div>
        )}
        {referrals.map((r) => (
          <div key={r.id} className="p-4 sm:p-5 space-y-3 border-b last:border-b-0">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{r.referredName}</div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Referred by <span className="text-foreground">{r.referrerName}</span>
                </p>
                <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-1 mt-2 text-sm">
                  {r.referredEmail && (
                    <>
                      <dt className="text-muted-foreground">Friend email</dt>
                      <dd className="break-all">{r.referredEmail}</dd>
                    </>
                  )}
                  {r.referredPhone && (
                    <>
                      <dt className="text-muted-foreground">Friend phone</dt>
                      <dd>{r.referredPhone}</dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">Link code</dt>
                  <dd className="font-mono">{r.code}</dd>
                  <dt className="text-muted-foreground">Signed up</dt>
                  <dd>{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</dd>
                  <dt className="text-muted-foreground">Bonus amount</dt>
                  <dd className="font-medium">£75</dd>
                </dl>
              </div>
              <div className="flex flex-col gap-2 shrink-0 min-w-[140px]">
                <span className="text-xs px-2 py-1 rounded-full bg-muted text-center">
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
                <span
                  className={`text-xs px-2 py-1 rounded-full text-center ${r.bonus_status === "paid" ? "bg-accent/30" : r.bonus_status === "eligible" ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400" : "bg-muted"}`}
                >
                  {BONUS_LABEL[r.bonus_status] ?? r.bonus_status}
                </span>
                <select
                  className="rounded-md border bg-background px-2 py-1.5 text-sm"
                  value={r.bonus_status}
                  disabled={updateBonus.isPending && updateBonus.variables?.id === r.id}
                  onChange={(e) =>
                    updateBonus.mutate({
                      id: r.id,
                      bonusStatus: e.target.value as "none" | "eligible" | "paid",
                    })
                  }
                >
                  <option value="none">No bonus</option>
                  <option value="eligible">Eligible (£75)</option>
                  <option value="paid">Paid (£75)</option>
                </select>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type AssignedAdvisor = { id: string; full_name: string | null; email: string | null };

function advisorLabel(a: AssignedAdvisor): string {
  return a.full_name || a.email || "Advisor";
}

function AllocateDialog({
  sessionId,
  assigned,
  onChanged,
}: {
  sessionId: string;
  assigned: AssignedAdvisor[];
  onChanged: () => void;
}) {
  const advisorsFn = useServerFn(listAdvisors);
  const allocateFn = useServerFn(allocateSession);
  const unallocateFn = useServerFn(unallocateSession);
  const [open, setOpen] = useState(false);

  const advisorsQ = useQuery({
    queryKey: ["advisors"],
    queryFn: () => advisorsFn(),
    enabled: open,
  });

  const assignedIds = new Set(assigned.map((a) => a.id));

  const toggle = useMutation({
    mutationFn: (vars: { advisorId: string; assign: boolean }) =>
      vars.assign
        ? allocateFn({ data: { sessionId, advisorId: vars.advisorId } })
        : unallocateFn({ data: { sessionId, advisorId: vars.advisorId } }),
    onSuccess: () => onChanged(),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not update allocation"),
  });

  const advisors = advisorsQ.data ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" onClick={(e) => e.stopPropagation()}>
          <UserCog className="w-4 h-4 mr-1.5" />
          Assign
        </Button>
      </DialogTrigger>
      <DialogContent onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Assign advisors</DialogTitle>
          <DialogDescription>
            Choose which advisors can see and work this fact-find.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1 max-h-80 overflow-y-auto">
          {advisorsQ.isLoading && <div className="text-sm text-muted-foreground py-4">Loading advisors…</div>}
          {!advisorsQ.isLoading && advisors.length === 0 && (
            <div className="text-sm text-muted-foreground py-4">No advisors found.</div>
          )}
          {advisors.map((a) => {
            const checked = assignedIds.has(a.id);
            return (
              <label
                key={a.id}
                className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/50 cursor-pointer"
              >
                <Checkbox
                  checked={checked}
                  disabled={toggle.isPending && toggle.variables?.advisorId === a.id}
                  onCheckedChange={(v) => toggle.mutate({ advisorId: a.id, assign: v === true })}
                />
                <span className="text-sm">
                  <span className="font-medium">{advisorLabel(a)}</span>
                  {(a as { code?: string | null }).code && (
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {(a as { code?: string | null }).code}
                    </span>
                  )}
                  {a.email && a.full_name && (
                    <span className="text-muted-foreground"> · {a.email}</span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BulkAllocateDialog({
  selectedIds,
  onDone,
}: {
  selectedIds: string[];
  onDone: () => void;
}) {
  const advisorsFn = useServerFn(listAdvisors);
  const bulkFn = useServerFn(bulkAllocateSessions);
  const [open, setOpen] = useState(false);
  const [advisorId, setAdvisorId] = useState("");
  const [code, setCode] = useState("");

  const advisorsQ = useQuery({
    queryKey: ["advisors"],
    queryFn: () => advisorsFn(),
    enabled: open,
  });
  const advisors = advisorsQ.data ?? [];

  const allocate = useMutation({
    mutationFn: () =>
      bulkFn({
        data: {
          sessionIds: selectedIds,
          advisorId: advisorId || undefined,
          advisorCode: !advisorId && code ? code : undefined,
        },
      }),
    onSuccess: (res) => {
      const skipped = res.skipped?.length ?? 0;
      if (skipped > 0) {
        toast.warning(
          `Allocated ${res.allocatedCount}. Skipped ${skipped} already at the 3-advisor limit.`,
        );
      } else {
        toast.success(`Allocated ${res.allocatedCount} customer${res.allocatedCount === 1 ? "" : "s"}.`);
      }
      setOpen(false);
      setAdvisorId("");
      setCode("");
      onDone();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not allocate"),
  });

  const canSubmit = (advisorId || code.trim().length > 0) && selectedIds.length > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={selectedIds.length === 0}>
          <UserCog className="w-4 h-4 mr-1.5" />
          Bulk allocate ({selectedIds.length})
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Allocate {selectedIds.length} customer{selectedIds.length === 1 ? "" : "s"}</DialogTitle>
          <DialogDescription>
            Assign the selected customer files to one advisor. Files already at the 3-advisor limit
            are skipped. Pick an advisor or enter their code.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Choose an advisor</label>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={advisorId}
              onChange={(e) => {
                setAdvisorId(e.target.value);
                if (e.target.value) setCode("");
              }}
            >
              <option value="">— Select advisor —</option>
              {advisors.map((a) => (
                <option key={a.id} value={a.id}>
                  {advisorLabel(a)}
                  {(a as { code?: string | null }).code ? ` (${(a as { code?: string | null }).code})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="text-center text-xs text-muted-foreground">or</div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Enter advisor code</label>
            <Input
              placeholder="e.g. 7KQ2M"
              value={code}
              maxLength={5}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5));
                if (e.target.value) setAdvisorId("");
              }}
              className="font-mono w-40 uppercase"
            />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!canSubmit || allocate.isPending} onClick={() => allocate.mutate()}>
            {allocate.isPending ? "Allocating…" : "Allocate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Advisors tab (ADMIN-ONLY). Lists every advisor with their code + a count of
// allocated customers; selecting one shows that advisor's customers (fact-finds
// allocated to them, plus sessions tied to an appointment they hold) with a
// search box and a link through to each customer's fact-find detail page.
//
// This is the foundation for a future CRM / case-status layer: each customer
// row already carries a `caseStatus` field (null today, see CaseStatus in
// sessions.functions.ts) so a status column can be surfaced here without
// reshaping the data or the row UI.
// ============================================================================

type AdvisorListItem = {
  id: string;
  full_name: string | null;
  email: string | null;
  code: string | null;
  customerCount: number;
};

function SessionReferenceBadge({ caseRef }: { caseRef: string | null }) {
  if (caseRef) {
    return (
      <span className="inline-flex items-center rounded-md border border-primary/20 bg-primary/5 px-2 py-0.5 font-mono text-[11px] font-medium text-primary whitespace-nowrap">
        {caseRef}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-md border border-dashed px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
      Fact-find
    </span>
  );
}

function SessionProgressBadge({
  isCase,
  status,
}: {
  isCase: boolean;
  status: string;
}) {
  const label = isCase ? "Case" : status === "submitted" ? "Ready" : "Active";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
        isCase
          ? "bg-primary/10 text-primary"
          : status === "submitted"
            ? "bg-accent/40 text-accent-foreground"
            : "bg-muted text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

function DashboardSessionsListHeader({ showCheckbox }: { showCheckbox: boolean }) {
  return (
    <div
      className={cn(
        "hidden sm:grid gap-x-4 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground border-b bg-muted/30",
        showCheckbox
          ? "sm:grid-cols-[auto_minmax(0,1.3fr)_6.75rem_5.25rem_minmax(0,1fr)_auto]"
          : "sm:grid-cols-[minmax(0,1.3fr)_6.75rem_5.25rem_minmax(0,1fr)_auto]",
      )}
    >
      {showCheckbox && <span aria-hidden className="w-4" />}
      <span>Customer</span>
      <span>Reference</span>
      <span>Stage</span>
      <span>Details</span>
      <span className="sr-only">Actions</span>
    </div>
  );
}

function AdvisorCustomerRowView({ row }: { row: AdvisorCustomerRow }) {
  const c = row.customer;
  const name = c?.full_name || c?.email || "Unnamed customer";
  const contact = [c?.email, c?.phone].filter(Boolean).join(" · ") || "No contact on file";
  const isCase = Boolean(row.caseRef);
  const statusLabel = row.status === "submitted" ? "Submitted" : "In progress";
  const startedLabel = formatDistanceToNow(new Date(row.startedAt), { addSuffix: true });

  return (
    <Link
      to="/sessions/$sessionId"
      params={{ sessionId: row.sessionId }}
      className="grid grid-cols-[1fr_auto] items-start gap-x-3 gap-y-2 px-4 py-3.5 sm:grid-cols-[minmax(0,1.3fr)_6.75rem_5.25rem_minmax(0,1fr)_auto] sm:items-center sm:gap-x-4 sm:py-3 hover:bg-muted/30 transition-colors group"
    >
      <div className="min-w-0 sm:contents">
        <div className="min-w-0">
          <p className="font-medium text-sm leading-snug truncate">{name}</p>
          <p className="text-xs text-muted-foreground truncate mt-0.5">{contact}</p>
        </div>
        <div className="hidden sm:flex">
          <SessionReferenceBadge caseRef={row.caseRef} />
        </div>
        <div className="hidden sm:flex">
          <SessionProgressBadge isCase={isCase} status={row.status} />
        </div>
        <div className="hidden sm:block min-w-0 text-xs text-muted-foreground space-y-0.5">
          <p className="truncate">
            {statusLabel} · {startedLabel}
          </p>
          <p className="truncate flex items-center gap-1.5 flex-wrap">
            <span className="inline-flex items-center gap-1">
              {row.channel === "text" ? (
                <MessageSquare className="w-3 h-3 shrink-0" />
              ) : (
                <Mic className="w-3 h-3 shrink-0" />
              )}
              {row.channel === "text" ? "Chat" : "Voice"}
            </span>
            {row.source === "appointment" && (
              <span className="inline-flex items-center gap-1">
                <CalendarCheck className="w-3 h-3 shrink-0" />
                Appointment
              </span>
            )}
          </p>
        </div>
      </div>
      <div className="col-span-2 sm:hidden flex flex-wrap items-center gap-2">
        <SessionReferenceBadge caseRef={row.caseRef} />
        <SessionProgressBadge isCase={isCase} status={row.status} />
        <span className="text-xs text-muted-foreground">
          {statusLabel} · {startedLabel}
        </span>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 col-start-2 row-start-1 self-center opacity-60 group-hover:opacity-100 transition-opacity sm:col-start-auto sm:row-start-auto hidden sm:block" />
    </Link>
  );
}

function DashboardSessionRow({
  session,
  isMainAdmin,
  isOwner,
  isSupervisor,
  selected,
  onToggleSelect,
  onCallbackOpen,
  onInvalidate,
}: {
  session: {
    id: string;
    customer_id: string;
    status: string;
    started_at: string;
    case_ref?: string | null;
    customer?: { full_name?: string | null; email?: string | null; phone?: string | null } | null;
    assignedAdvisors?: AssignedAdvisor[];
    nextContactAt?: string | null;
    callback?: { id: string; window: string | null } | null;
  };
  isMainAdmin: boolean;
  isOwner: boolean;
  isSupervisor: boolean;
  selected: boolean;
  onToggleSelect: (on: boolean) => void;
  onCallbackOpen: (contactId: string) => void;
  onInvalidate: () => void;
}) {
  const assigned = session.assignedAdvisors ?? [];
  const callback = session.callback ?? null;
  const nextContactAt = session.nextContactAt ?? null;
  const caseRef = session.case_ref ?? null;
  const isCase = Boolean(caseRef);
  const name = session.customer?.full_name || session.customer?.email || "Unnamed customer";
  const contactLine =
    [session.customer?.email, session.customer?.phone].filter(Boolean).join(" · ") ||
    "No contact on file";
  const statusLabel = session.status === "submitted" ? "Submitted" : "In progress";
  const startedLabel = formatDistanceToNow(new Date(session.started_at), { addSuffix: true });
  const advisorLine =
    assigned.length > 0
      ? assigned.map(advisorLabel).join(", ")
      : !isCase
        ? "Unallocated"
        : null;

  const gridCols = isMainAdmin
    ? "sm:grid-cols-[auto_minmax(0,1.3fr)_6.75rem_5.25rem_minmax(0,1fr)_auto]"
    : "sm:grid-cols-[minmax(0,1.3fr)_6.75rem_5.25rem_minmax(0,1fr)_auto]";

  return (
    <div
      className={cn(
        "grid grid-cols-[1fr_auto] items-start gap-x-3 gap-y-2 px-4 py-3.5 sm:items-center sm:gap-x-4 sm:py-3 border-b border-border/60 last:border-0 transition-colors",
        gridCols,
        callback ? "bg-primary/[0.04] hover:bg-primary/[0.07]" : "hover:bg-muted/25",
      )}
    >
      {isMainAdmin && (
        <Checkbox
          className="hidden sm:block shrink-0"
          checked={selected}
          onCheckedChange={(v) => onToggleSelect(v === true)}
          aria-label="Select record"
        />
      )}

      <Link
        to="/sessions/$sessionId"
        params={{ sessionId: session.id }}
        onClick={() => {
          if (callback) onCallbackOpen(callback.id);
        }}
        className="min-w-0 col-start-1 row-start-1 sm:contents group/link"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <p className="font-medium text-sm leading-snug truncate">{name}</p>
            {callback && (
              <span className="inline-flex shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
                New
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">{contactLine}</p>
        </div>

        <div className="hidden sm:flex">
          <SessionReferenceBadge caseRef={caseRef} />
        </div>

        <div className="hidden sm:flex">
          <SessionProgressBadge isCase={isCase} status={session.status} />
        </div>

        <div className="hidden sm:block min-w-0 text-xs text-muted-foreground space-y-1">
          <p className="truncate">
            {statusLabel} · {startedLabel}
          </p>
          {advisorLine && (
            <p
              className={cn(
                "truncate",
                !isCase && assigned.length === 0 && "text-amber-600 dark:text-amber-500 font-medium",
              )}
            >
              {assigned.length > 0 ? `Advisor: ${advisorLine}` : advisorLine}
            </p>
          )}
          {(callback || nextContactAt) && (
            <div className="flex flex-wrap gap-1.5">
              {callback && (
                <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                  <PhoneCall className="w-3 h-3 shrink-0" />
                  Call-back
                  {callback.window
                    ? ` · ${CALLBACK_WINDOW_LABELS[callback.window] ?? callback.window}`
                    : ""}
                </span>
              )}
              {nextContactAt && (
                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px]">
                  <Clock className="w-3 h-3 shrink-0" />
                  {format(new Date(nextContactAt), "EEE d MMM, HH:mm")}
                </span>
              )}
            </div>
          )}
        </div>
      </Link>

      <div className="col-span-2 sm:hidden space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <SessionReferenceBadge caseRef={caseRef} />
          <SessionProgressBadge isCase={isCase} status={session.status} />
          <span className="text-xs text-muted-foreground">
            {statusLabel} · {startedLabel}
          </span>
        </div>
        {advisorLine && (
          <p
            className={cn(
              "text-xs truncate",
              !isCase && assigned.length === 0
                ? "text-amber-600 dark:text-amber-500 font-medium"
                : "text-muted-foreground",
            )}
          >
            {assigned.length > 0 ? `Advisor: ${advisorLine}` : advisorLine}
          </p>
        )}
        {(callback || nextContactAt) && (
          <div className="flex flex-wrap gap-1.5">
            {callback && (
              <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                <PhoneCall className="w-3 h-3 shrink-0" />
                Call-back
              </span>
            )}
            {nextContactAt && (
              <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                <Clock className="w-3 h-3 shrink-0" />
                {format(new Date(nextContactAt), "EEE d MMM")}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto flex items-center gap-0.5 shrink-0 self-center">
        {isMainAdmin && (
          <Checkbox
            className="sm:hidden shrink-0 mr-1"
            checked={selected}
            onCheckedChange={(v) => onToggleSelect(v === true)}
            aria-label="Select record"
          />
        )}
        <Link to="/customers/$customerId" params={{ customerId: session.customer_id }}>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs hidden md:inline-flex"
            onClick={(e) => e.stopPropagation()}
          >
            Customer
          </Button>
        </Link>
        {isMainAdmin && !isCase && (
          <AllocateDialog sessionId={session.id} assigned={assigned} onChanged={onInvalidate} />
        )}
        {(isOwner || isSupervisor) && (
          <DeleteButton sessionId={session.id} onDeleted={onInvalidate} />
        )}
        <Link
          to="/sessions/$sessionId"
          params={{ sessionId: session.id }}
          className="hidden sm:inline-flex p-1.5 text-muted-foreground hover:text-foreground"
          aria-label="Open record"
        >
          <ChevronRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}

function AdvisorsCard() {
  const advisorsFn = useServerFn(listAdvisors);
  const customersFn = useServerFn(listAdvisorCustomers);

  const [selectedAdvisorId, setSelectedAdvisorId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const advisorsQ = useQuery({ queryKey: ["advisors"], queryFn: () => advisorsFn() });
  const advisors = (advisorsQ.data ?? []) as AdvisorListItem[];
  const selectedAdvisor = advisors.find((a) => a.id === selectedAdvisorId) ?? null;

  const customersQ = useQuery({
    queryKey: ["advisor-customers", selectedAdvisorId],
    queryFn: () => customersFn({ data: { advisorId: selectedAdvisorId as string } }),
    enabled: !!selectedAdvisorId,
  });

  const q = search.trim().toLowerCase();
  const customers = (customersQ.data ?? []).filter((row) => {
    if (!q) return true;
    const haystack = [row.customer?.full_name, row.customer?.email, row.customer?.phone]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });

  const selectAdvisor = (id: string) => {
    setSelectedAdvisorId(id);
    setSearch("");
  };

  return (
    <div className="mt-2">
      <p className="text-sm text-muted-foreground mb-4">
        Pick an advisor to see the customers allocated to them. Allocate customers from the
        Customers tab.
      </p>
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* Advisor list */}
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <Briefcase className="w-4 h-4" />
            Advisors
          </h3>
          <div className="rounded-2xl border bg-card divide-y overflow-hidden">
            {advisorsQ.isLoading && (
              <div className="p-4 text-sm text-muted-foreground">Loading advisors…</div>
            )}
            {advisorsQ.isError && (
              <div className="p-4 text-sm text-muted-foreground">Couldn&apos;t load advisors.</div>
            )}
            {!advisorsQ.isLoading && advisors.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground">No advisors yet.</div>
            )}
            {advisors.map((a) => {
              const active = a.id === selectedAdvisorId;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => selectAdvisor(a.id)}
                  className={`w-full text-left flex items-center gap-3 p-4 transition ${active ? "bg-primary/5" : "hover:bg-muted/40"}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">
                      {a.full_name || a.email || "Unnamed advisor"}
                    </div>
                    <div className="text-xs text-muted-foreground truncate flex items-center gap-2 flex-wrap">
                      {a.email && <span className="truncate">{a.email}</span>}
                      {a.code && (
                        <span className="inline-flex items-center gap-1 font-mono text-foreground">
                          <KeyRound className="w-3 h-3" />
                          {a.code}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-xs shrink-0">
                    <Users className="w-3 h-3" />
                    {a.customerCount}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected advisor's customers */}
        <div>
          {!selectedAdvisor ? (
            <div className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground h-full flex items-center justify-center">
              Select an advisor to see their customers.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <h3 className="text-sm font-medium text-muted-foreground truncate">
                  {selectedAdvisor.full_name || selectedAdvisor.email || "Advisor"}&apos;s customers
                </h3>
              </div>
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search this advisor's customers by name, email or phone…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="rounded-2xl border bg-card overflow-hidden">
                <DashboardSessionsListHeader showCheckbox={false} />
                {customersQ.isLoading && (
                  <div className="p-4 text-sm text-muted-foreground">Loading customers…</div>
                )}
                {customersQ.isError && (
                  <div className="p-4 text-sm text-muted-foreground">
                    Couldn&apos;t load this advisor&apos;s customers.
                  </div>
                )}
                {!customersQ.isLoading && customers.length === 0 && (
                  <div className="p-4 text-sm text-muted-foreground">
                    {search.trim()
                      ? "No customers match your search."
                      : "No customers allocated to this advisor yet."}
                  </div>
                )}
                {customers.map((row) => (
                  <AdvisorCustomerRowView key={row.sessionId} row={row} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const CALLBACK_WINDOW_LABELS: Record<string, string> = {
  "9-12": "9am – 12pm",
  "12-4": "12pm – 4pm",
  "4-8": "4pm – 8pm",
};

// Advisor Contacts tab: appointments + call-back requests for the signed-in
// advisor, with NEW / unopened ones highlighted. Opening one (or following the
// link to the customer) marks it seen for this advisor.
function ContactsCard() {
  const qc = useQueryClient();
  const contactsFn = useServerFn(listAdvisorContacts);
  const openFn = useServerFn(markContactOpened);
  const [voicemailCallId, setVoicemailCallId] = useState<string | null>(null);

  const contactsQ = useQuery({ queryKey: ["advisor-contacts"], queryFn: () => contactsFn() });
  const contacts = (contactsQ.data ?? []) as AdvisorContact[];

  const open = useMutation({
    mutationFn: (vars: { contactType: "appointment" | "callback"; contactId: string }) =>
      openFn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["advisor-contacts"] }),
  });

  const unopenedCount = contacts.filter((c) => !c.opened).length;
  const unallocatedCount = contacts.filter((c) => c.unallocated).length;

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Inbox className="w-4 h-4" />
          Appointments &amp; call-backs
        </h3>
        {unopenedCount > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
            {unopenedCount} new
          </span>
        )}
        {unallocatedCount > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200 font-medium">
            {unallocatedCount} unallocated
          </span>
        )}
      </div>
      <div className="rounded-2xl border bg-card divide-y overflow-hidden">
        <div className="p-4 text-xs text-muted-foreground">
          Booked appointments, call-back requests, and office-line voicemails. Voicemails are linked
          to the allocated advisor when we recognise the caller; unknown numbers appear as unallocated
          for owner and admin supervisors.
        </div>
        {contactsQ.isLoading && <div className="p-4 text-sm text-muted-foreground">Loading contacts…</div>}
        {!contactsQ.isLoading && contacts.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">No appointments or call-backs yet.</div>
        )}
        {contacts.map((c) => {
          const markSeen = () => {
            if (!c.opened) open.mutate({ contactType: c.kind, contactId: c.id });
          };
          const body = (
            <div className={`flex items-center gap-3 p-4 transition ${c.opened ? "" : "bg-primary/5"}`}>
              <span
                className={`inline-flex w-9 h-9 items-center justify-center rounded-full shrink-0 ${c.kind === "appointment" ? "bg-accent/30" : "bg-primary/10 text-primary"}`}
              >
                {c.kind === "appointment" ? <CalendarCheck className="w-4 h-4" /> : <PhoneCall className="w-4 h-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate flex items-center gap-2 flex-wrap">
                  {c.customerName}
                  {!c.opened && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground">
                      New
                    </span>
                  )}
                  {c.isVoicemail && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
                      Voicemail
                    </span>
                  )}
                  {c.unallocated && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                      Unallocated
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {c.kind === "appointment"
                    ? c.startsAt
                      ? `Appointment · ${format(new Date(c.startsAt), "EEE d MMM, HH:mm")}`
                      : "Appointment"
                    : c.isVoicemail
                      ? "Voicemail · call back requested"
                      : `Call back · ${CALLBACK_WINDOW_LABELS[c.window ?? ""] ?? c.window}`}
                  {c.customerPhone ? ` · ${c.customerPhone}` : ""}
                </div>
                {c.summary && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.summary}</p>
                )}
              </div>
              <div className="flex flex-col gap-1 shrink-0 items-end">
                {c.unallocated && (
                  <AssignVoicemailAdvisor
                    callbackId={c.id}
                    onAssigned={() => qc.invalidateQueries({ queryKey: ["advisor-contacts"] })}
                  />
                )}
                {c.phoneCallId && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      markSeen();
                      setVoicemailCallId(c.phoneCallId!);
                    }}
                    disabled={c.aiStatus === "processing" || c.aiStatus === "pending"}
                  >
                    {c.aiStatus === "complete" ? "View summary" : c.aiStatus === "processing" ? "Transcribing…" : "View"}
                  </Button>
                )}
                {c.sessionId && <ChevronRight className="w-4 h-4 text-muted-foreground self-end" />}
              </div>
            </div>
          );
          return c.sessionId ? (
            <Link
              key={`${c.kind}-${c.id}`}
              to="/sessions/$sessionId"
              params={{ sessionId: c.sessionId }}
              onClick={markSeen}
              className="block hover:bg-muted/40"
            >
              {body}
            </Link>
          ) : (
            <button
              key={`${c.kind}-${c.id}`}
              type="button"
              onClick={markSeen}
              className="block w-full text-left hover:bg-muted/40"
            >
              {body}
            </button>
          );
        })}
      </div>
      <PhoneCallDetailDialog
        callId={voicemailCallId}
        open={Boolean(voicemailCallId)}
        onOpenChange={(open) => !open && setVoicemailCallId(null)}
      />
    </div>
  );
}

function CustomerAppointmentCard() {
  const qc = useQueryClient();
  const casesFn = useServerFn(listMyCases);
  const bookingFn = useServerFn(getSessionBooking);
  const casesQ = useQuery({ queryKey: ["my-cases"], queryFn: () => casesFn() });

  const [panel, setPanel] = useState<"none" | "amend" | "callback">("none");
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");

  useQuery({
    queryKey: ["profile-for-home-booking"],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", user.id)
        .maybeSingle();
      if (profile?.full_name) setProfileName(profile.full_name);
      if (profile?.email) setProfileEmail(profile.email);
      return profile;
    },
  });

  const cases = casesQ.data ?? [];
  const withAppt = cases
    .filter((c) => c.appointment)
    .sort(
      (a, b) =>
        new Date(a.appointment!.startsAt).getTime() - new Date(b.appointment!.startsAt).getTime(),
    );
  const now = Date.now();
  const upcoming =
    withAppt.find((c) => new Date(c.appointment!.startsAt).getTime() >= now) ?? withAppt[0] ?? null;

  const bookingQ = useQuery({
    queryKey: ["landing-booking", upcoming?.id],
    queryFn: () => bookingFn({ data: { sessionId: upcoming!.id } }),
    enabled: Boolean(upcoming?.id),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["my-cases"] });
    qc.invalidateQueries({ queryKey: ["landing-booking"] });
    setPanel("none");
  };

  if (casesQ.isLoading) {
    return (
      <div className="rounded-2xl border p-5 text-sm text-muted-foreground">
        Loading appointment…
      </div>
    );
  }

  if (!upcoming?.appointment) {
    return (
      <Link
        to="/booking"
        className="group text-left rounded-2xl border p-5 hover:border-primary hover:bg-muted/40 transition block"
      >
        <div className="flex items-center gap-3">
          <span className="inline-flex w-11 h-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CalendarCheck className="w-5 h-5" />
          </span>
          <div>
            <div className="font-semibold flex items-center gap-1">
              Book an appointment
              <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition" />
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Pick a time to speak with your advisor.
            </div>
          </div>
        </div>
      </Link>
    );
  }

  const appt = upcoming.appointment;
  const callback = bookingQ.data?.callback ?? null;
  const callbackOpen = callback && callback.status !== "closed";

  return (
    <div className="rounded-2xl border bg-card p-5 space-y-4 sm:col-span-2 lg:col-span-3">
      <div className="flex items-start gap-3">
        <span className="inline-flex w-11 h-11 items-center justify-center rounded-full bg-primary/10 text-primary shrink-0">
          <CalendarCheck className="w-5 h-5" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold">Your appointment</div>
          {panel === "none" && (
            <>
              <dl className="mt-2 grid sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Date &amp; time</dt>
                  <dd className="font-medium">
                    {format(new Date(appt.startsAt), "EEE d MMM yyyy, HH:mm")}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Advisor</dt>
                  <dd className="font-medium">{appt.advisorName}</dd>
                </div>
                {upcoming.case_ref && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Case</dt>
                    <dd className="font-mono text-xs">{upcoming.case_ref}</dd>
                  </div>
                )}
              </dl>
              {callbackOpen && (
                <p className="text-xs text-primary mt-2 inline-flex items-center gap-1">
                  <PhoneCall className="w-3 h-3" />
                  Call-back requested ·{" "}
                  {CALLBACK_WINDOW_RANGES[callback.preferredWindow as "9-12" | "12-4" | "4-8"] ??
                    callback.preferredWindow}
                </p>
              )}
              <div className="flex flex-wrap gap-2 mt-3">
                <Button type="button" size="sm" variant="outline" onClick={() => setPanel("amend")}>
                  Amend appointment
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setPanel("callback")}>
                  <PhoneCall className="w-4 h-4 mr-1.5" />
                  Request a call back
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {panel === "amend" && (
        <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-medium text-sm">Change your appointment</h4>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPanel("none")}>
              Cancel
            </Button>
          </div>
          <PostCompletionBooking
            sessionId={upcoming.id}
            channel="text"
            defaultName={profileName}
            defaultEmail={profileEmail}
            initialMode="appointment"
            hideModeToggle
            compact
            onComplete={() => {
              refresh();
              toast.success("Appointment updated");
            }}
          />
        </div>
      )}

      {panel === "callback" && (
        <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-medium text-sm">When should we call you?</h4>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPanel("none")}>
              Cancel
            </Button>
          </div>
          <PostCompletionBooking
            sessionId={upcoming.id}
            channel="text"
            defaultName={profileName}
            defaultEmail={profileEmail}
            initialMode="callback"
            hideModeToggle
            compact
            onComplete={() => {
              refresh();
              toast.success("Call-back requested");
            }}
          />
        </div>
      )}
    </div>
  );
}

function CustomerRafSelfServeCard() {
  const qc = useQueryClient();
  const activityFn = useServerFn(listMyReferralActivity);
  const ensureFn = useServerFn(ensureMyReferralLink);
  const publicUrlFn = useServerFn(getPublicShareBaseUrl);

  const activityQ = useQuery({ queryKey: ["my-raf-activity"], queryFn: () => activityFn() });
  const publicUrlQ = useQuery({ queryKey: ["public-share-url"], queryFn: () => publicUrlFn() });
  const shareBase = publicUrlQ.data?.baseUrl;

  const ensure = useMutation({
    mutationFn: () => ensureFn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-raf-activity"] }),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not create link"),
  });

  const code = activityQ.data?.codes?.[0]?.code;
  const referrals = activityQ.data?.referrals ?? [];

  return (
    <div className="rounded-2xl border bg-card p-5 space-y-4 sm:col-span-2 lg:col-span-1">
      <div className="flex items-center gap-3">
        <span className="inline-flex w-11 h-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Gift className="w-5 h-5" />
        </span>
        <div>
          <div className="font-semibold">Refer a friend</div>
          <div className="text-xs text-muted-foreground">Share your link and track referrals · £75 bonus</div>
        </div>
      </div>
      {activityQ.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!activityQ.isLoading && !code && (
        <Button size="sm" onClick={() => ensure.mutate()} disabled={ensure.isPending}>
          {ensure.isPending ? "Creating…" : "Get my referral link"}
        </Button>
      )}
      {code && (
        <div className="space-y-2">
          <p className="text-xs font-mono break-all">{rafLinkForCode(code, shareBase)}</p>
          <CopyLinkButton value={rafShareMessage(null, code, shareBase)} label="Copy share message" />
        </div>
      )}
      {referrals.length > 0 && (
        <div className="rounded-xl border bg-muted/30 p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Your referrals</p>
          {referrals.slice(0, 5).map((r) => (
            <div key={r.id} className="text-sm flex justify-between gap-2">
              <span className="truncate">{r.referredEmail ?? r.referredPhone ?? "Friend"}</span>
              <span className="text-xs text-muted-foreground shrink-0 capitalize">{r.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Home() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const roleFn = useServerFn(getMyRole);
  const sessionsFn = useServerFn(listMySessions);
  const casesFn = useServerFn(listMyCases);
  const allFn = useServerFn(listAllSessionsForAdvisor);
  const createFn = useServerFn(createSession);

  const introducerFn = useServerFn(checkIsIntroducer);
  const markOpenedFn = useServerFn(markContactOpened);

  const roleQ = useQuery({ queryKey: ["my-role"], queryFn: () => roleFn() });
  const isAdvisor = roleQ.data?.isAdvisor ?? false;
  const isMainAdmin = roleQ.data?.isMainAdmin ?? false;
  const isOwner = roleQ.data?.isOwner ?? false;
  const isSupervisor = roleQ.data?.isSupervisor ?? false;
  const adminLevel = roleQ.data?.adminLevel ?? null;
  const adminAccess = roleQ.data?.adminAccess ?? null;
  const showCommissionPayouts = canViewCommissionPayouts(adminAccess);
  const canAmendPayouts = canAmendCommissionPayouts(adminAccess);
  const showManage =
    canView(adminAccess, "advisors") ||
    canView(adminAccess, "introducers") ||
    canView(adminAccess, "invites") ||
    canView(adminAccess, "raf");
  const showAccessTab = isOwner || isSupervisor;
  const showFinanceReport = canViewFinanceReport(adminAccess);
  const showAdvisorViewTab = (isOwner || isSupervisor) && isMainAdmin;

  const introducerQ = useQuery({ queryKey: ["is-introducer"], queryFn: () => introducerFn() });
  const isIntroducer = introducerQ.data?.isIntroducer ?? false;
  const advisorCode = roleQ.data?.advisorCode ?? null;

  const [unallocatedOnly, setUnallocatedOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "next_contact">("recent");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [advisorViewTick, setAdvisorViewTick] = useState(0);
  const advisorViewId = getAdvisorView()?.advisorId;

  const sessionsQ = useQuery({
    queryKey: ["my-sessions"],
    queryFn: () => sessionsFn(),
    enabled: !roleQ.isLoading && !isAdvisor,
  });

  const casesQ = useQuery({
    queryKey: ["my-cases"],
    queryFn: () => casesFn(),
    enabled: !roleQ.isLoading && !isAdvisor,
  });

  const allQ = useQuery({
    queryKey: ["all-sessions", advisorViewId, advisorViewTick],
    queryFn: () => allFn({ data: { viewAsAdvisorId: advisorViewId } }),
    enabled: !roleQ.isLoading && (isAdvisor || (isMainAdmin && !isOwner)),
  });

  // Opening a customer with a pending call-back marks it seen for this advisor,
  // clearing the highlight (consistent with the Contacts tab).
  const markCallbackOpened = useMutation({
    mutationFn: (vars: { contactId: string }) =>
      markOpenedFn({ data: { contactType: "callback", contactId: vars.contactId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["all-sessions"] }),
  });

  const create = useMutation({
    mutationFn: async (mode: "voice" | "chat") => ({ session: await createFn(), mode }),
    onSuccess: ({ session, mode }) =>
      navigate({
        to: mode === "chat" ? "/chat/$sessionId" : "/interview/$sessionId",
        params: { sessionId: session.id },
      }),
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Could not start interview — please try again.");
    },
  });

  // RAF attribution: if a friend arrived via /raf/<code> a 'raf_ref' cookie is
  // set. On their first authenticated load we record the referral crediting the
  // referrer, then clear the cookie so it only fires once. Self-referral and
  // duplicate guards live server-side; failures are silent for the customer.
  const claimReferralFn = useServerFn(claimReferral);
  useEffect(() => {
    const code = getRafCode();
    if (!code) return;
    let cancelled = false;
    (async () => {
      try {
        await claimReferralFn({ data: { code } });
      } catch {
        // Non-fatal — never block the customer's dashboard on attribution.
      } finally {
        if (!cancelled) clearRafCookie();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [claimReferralFn]);

  if (roleQ.isLoading || sessionsQ.isLoading) {
    return <AppShell title="Home"><div className="py-16 text-center text-muted-foreground">Loading…</div></AppShell>;
  }

  if (sessionsQ.isError) {
    return (
      <AppShell title="Home">
        <div className="py-16 text-center space-y-3 max-w-md mx-auto">
          <p className="text-muted-foreground">We couldn&apos;t load your fact-finds.</p>
          <Button onClick={() => sessionsQ.refetch()}>Try again</Button>
        </div>
      </AppShell>
    );
  }

  if (isAdvisor || (isMainAdmin && !isOwner)) {
    const q = search.trim().toLowerCase();
    const sessions = (allQ.data ?? [])
      .filter((s) => {
        const assigned = (s as { assignedAdvisors?: AssignedAdvisor[] }).assignedAdvisors ?? [];
        const isCase = Boolean((s as { case_ref?: string | null }).case_ref);
        if (unallocatedOnly && (isCase || assigned.length !== 0)) {
          return false;
        }
        if (!q) return true;
        const c = (s as { customer?: { full_name?: string | null; email?: string | null; phone?: string | null } | null }).customer;
        const caseRef = (s as { case_ref?: string | null }).case_ref ?? "";
        const haystack = [c?.full_name, c?.email, c?.phone, caseRef].filter(Boolean).join(" ").toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => {
        if (sortBy !== "next_contact") return 0;
        // Soonest planned next contact first; sessions without one sink to the bottom.
        const an = (a as { nextContactAt?: string | null }).nextContactAt;
        const bn = (b as { nextContactAt?: string | null }).nextContactAt;
        if (!an && !bn) return 0;
        if (!an) return 1;
        if (!bn) return -1;
        return new Date(an).getTime() - new Date(bn).getTime();
      });

    const invalidateSessions = () => qc.invalidateQueries({ queryKey: ["all-sessions"] });

    const visibleIds = sessions.map((s) => s.id);
    const selectedVisible = selectedIds.filter((id) => visibleIds.includes(id));
    const allVisibleSelected = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
    const toggleSelected = (id: string, on: boolean) =>
      setSelectedIds((prev) => (on ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));
    const clearSelection = () => setSelectedIds([]);

    const tabCount =
      2 +
      (isIntroducer ? 1 : 0) +
      1 +
      (isMainAdmin ? 1 : 0) +
      (showAdvisorViewTab ? 1 : 0) +
      (showCommissionPayouts ? 1 : 0) +
      (showManage ? 1 : 0) +
      (showAccessTab ? 1 : 0) +
      (showFinanceReport ? 1 : 0);

    return (
      <AppShell title="Advisor dashboard">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-2xl font-semibold">
              {isMainAdmin ? "Admin dashboard" : "Your customers"}
            </h2>
            {adminLevel && (
              <span className="inline-flex items-center rounded-full border bg-muted px-3 py-1 text-xs font-medium">
                {ADMIN_LEVEL_LABELS[adminLevel]}
              </span>
            )}
            {advisorCode && (
              <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-sm">
                <KeyRound className="w-3.5 h-3.5 text-muted-foreground" />
                Your code: <span className="font-mono font-medium">{advisorCode}</span>
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {isOwner ? (
              <>
                <Button onClick={() => create.mutate("voice")} disabled={create.isPending}>
                  <Mic className="w-4 h-4 mr-2" />
                  {create.isPending && create.variables === "voice" ? "Starting…" : "Spoken"}
                </Button>
                <Button variant="outline" onClick={() => create.mutate("chat")} disabled={create.isPending}>
                  <MessageSquare className="w-4 h-4 mr-2" />
                  {create.isPending && create.variables === "chat" ? "Starting…" : "Type"}
                </Button>
              </>
            ) : (
              <StaffCustomerBookingCard onBooked={invalidateSessions} />
            )}
            <Link to="/diary">
              <Button variant="secondary">
                <CalendarDays className="w-4 h-4 mr-2" />
                Diary
              </Button>
            </Link>
          </div>
        </div>

        <Tabs defaultValue="customers">
          {tabCount > 1 && (
            <TabsList className="mb-4 mx-auto flex h-auto w-full max-w-4xl flex-wrap justify-center gap-1 p-1">
              <TabsTrigger value="customers">
                <Users className="w-4 h-4 mr-1.5" />
                Customers
              </TabsTrigger>
              <TabsTrigger value="contacts">
                <Inbox className="w-4 h-4 mr-1.5" />
                Contacts
              </TabsTrigger>
              {isMainAdmin && (
                <TabsTrigger value="advisors">
                  <Briefcase className="w-4 h-4 mr-1.5" />
                  Advisors
                </TabsTrigger>
              )}
              {showAdvisorViewTab && (
                <TabsTrigger value="advisor-view">
                  <Eye className="w-4 h-4 mr-1.5" />
                  Advisor view
                </TabsTrigger>
              )}
              {isIntroducer && (
                <TabsTrigger value="introducer">
                  <Link2 className="w-4 h-4 mr-1.5" />
                  Introducer
                </TabsTrigger>
              )}
              <TabsTrigger value="my-commission">
                <PoundSterling className="w-4 h-4 mr-1.5" />
                My commission
              </TabsTrigger>
              {showCommissionPayouts && (
                <TabsTrigger value="commission">
                  <PoundSterling className="w-4 h-4 mr-1.5" />
                  Commission mgmt
                </TabsTrigger>
              )}
              {showManage && (
                <TabsTrigger value="manage">
                  <ShieldCheck className="w-4 h-4 mr-1.5" />
                  Manage
                </TabsTrigger>
              )}
              {showAccessTab && (
                <TabsTrigger value="access">
                  <UserCog className="w-4 h-4 mr-1.5" />
                  Admin access
                </TabsTrigger>
              )}
              {showFinanceReport && (
                <TabsTrigger value="finance">
                  <PoundSterling className="w-4 h-4 mr-1.5" />
                  Finance
                </TabsTrigger>
              )}
            </TabsList>
          )}

          <TabsContent value="customers">
            <div className="flex flex-col gap-4">
            {isMainAdmin && (
              <div className="space-y-3 mb-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-sm text-muted-foreground">
                    One row per fact-find or case — customer name, reference, and status at a glance.
                  </p>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={unallocatedOnly}
                      onCheckedChange={(v) => setUnallocatedOnly(v === true)}
                    />
                    Unallocated only
                  </label>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative flex-1 min-w-[220px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search customers by name, email or phone…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <select
                    className="rounded-md border bg-background px-3 py-2 text-sm"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as "recent" | "next_contact")}
                    aria-label="Sort customers"
                  >
                    <option value="recent">Sort: Most recent</option>
                    <option value="next_contact">Sort: Next contact</option>
                  </select>
                </div>
                <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl border bg-muted/40 px-3 py-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={allVisibleSelected}
                      onCheckedChange={(v) =>
                        v === true ? setSelectedIds(visibleIds) : clearSelection()
                      }
                    />
                    {selectedVisible.length > 0
                      ? `${selectedVisible.length} selected`
                      : "Select all"}
                  </label>
                  <div className="flex items-center gap-2">
                    {selectedVisible.length > 0 && (
                      <Button variant="ghost" size="sm" onClick={clearSelection}>
                        Clear
                      </Button>
                    )}
                    <BulkAllocateDialog
                      selectedIds={selectedVisible}
                      onDone={() => {
                        clearSelection();
                        invalidateSessions();
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
            <div className="rounded-2xl border bg-card overflow-hidden">
              <DashboardSessionsListHeader showCheckbox={isMainAdmin} />
              {sessions.length === 0 && (
                <div className="p-6 text-muted-foreground text-sm">
                  {search.trim()
                    ? "No customers match your search."
                    : unallocatedOnly
                      ? "No unallocated fact-finds."
                      : "No customers yet."}
                </div>
              )}
              {sessions.map((s) => (
                <DashboardSessionRow
                  key={s.id}
                  session={{
                    id: s.id,
                    customer_id: (s as { customer_id: string }).customer_id,
                    status: s.status,
                    started_at: s.started_at,
                    case_ref: (s as { case_ref?: string | null }).case_ref,
                    customer: (s as { customer?: { full_name?: string | null; email?: string | null; phone?: string | null } | null }).customer,
                    assignedAdvisors: (s as { assignedAdvisors?: AssignedAdvisor[] }).assignedAdvisors,
                    nextContactAt: (s as { nextContactAt?: string | null }).nextContactAt,
                    callback: (s as { callback?: { id: string; window: string | null } | null }).callback,
                  }}
                  isMainAdmin={isMainAdmin}
                  isOwner={isOwner}
                  isSupervisor={isSupervisor}
                  selected={selectedIds.includes(s.id)}
                  onToggleSelect={(on) => toggleSelected(s.id, on)}
                  onCallbackOpen={(id) => markCallbackOpened.mutate({ contactId: id })}
                  onInvalidate={invalidateSessions}
                />
              ))}
            </div>
            {isOwner && (
              <div className="self-start pt-1">
                <OwnerCustomerExportBox />
              </div>
            )}
            </div>
          </TabsContent>

          <TabsContent value="contacts">
            <ContactsCard />
          </TabsContent>

          {isMainAdmin && (
            <TabsContent value="advisors">
              <AdvisorsCard />
            </TabsContent>
          )}

          {showAdvisorViewTab && (
            <TabsContent value="advisor-view">
              <AdvisorViewBanner
                canUse
                onViewChange={() => {
                  setAdvisorViewTick((n) => n + 1);
                  invalidateSessions();
                }}
              />
              <p className="text-sm text-muted-foreground mt-4">
                When advisor view is active, open the <strong>Customers</strong> tab to see that
                advisor&apos;s dashboard, diary, and cases.
              </p>
            </TabsContent>
          )}

          {isIntroducer && (
            <TabsContent value="introducer">
              <div className="rounded-2xl border bg-card p-6 space-y-3">
                <div className="flex items-center gap-2 font-medium">
                  <Link2 className="w-4 h-4" />
                  Introducer portal
                </div>
                <p className="text-sm text-muted-foreground">
                  Share referral links, log leads, and track booked appointments in your introducer
                  portal.
                </p>
                <Link to="/introducer">
                  <Button>
                    Open introducer portal
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </Link>
              </div>
            </TabsContent>
          )}

          <TabsContent value="my-commission">
            <MyCommissionStatementPanel />
          </TabsContent>

          {showCommissionPayouts && (
            <TabsContent value="commission">
              <CommissionPayoutsPanel canAmend={canAmendPayouts} />
            </TabsContent>
          )}

          {showManage && (
            <TabsContent value="manage">
              <div className="space-y-6">
                {isOwner && <TestAccountsCard />}
                {canView(adminAccess, "invites") && <InviteStaffCard />}
                {canView(adminAccess, "advisors") && <AdvisorAccessCard />}
                {canView(adminAccess, "introducers") && <IntroducerAccessCard />}
                {canView(adminAccess, "raf") && <RafLinksAccessCard />}
                {(isOwner || isSupervisor) && <RecentlyDeletedCard />}
              </div>
            </TabsContent>
          )}

          {showAccessTab && (
            <TabsContent value="access">
              <AdminAccessPanel isOwner={isOwner} />
            </TabsContent>
          )}

          {showFinanceReport && (
            <TabsContent value="finance">
              <OwnerFinanceReport />
            </TabsContent>
          )}
        </Tabs>
      </AppShell>
    );
  }

  const sessions = sessionsQ.data ?? [];
  const inProgress = sessions.find((s) => s.status === "in_progress");
  const hasSubmitted = sessions.some((s) => s.status === "submitted");
  const hasCases = (casesQ.data ?? []).length > 0;
  const caseCount = casesQ.data?.length ?? 0;

  return (
    <AppShell title="Your fact-finds">
      <div className="rounded-3xl bg-card border p-6 sm:p-8 mb-6">
        <div>
          <h2 className="text-2xl font-semibold">
            {inProgress ? "Continue your fact-find" : "Start a new fact-find"}
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            {inProgress
              ? "Pick up where you left off with Susan. You can switch between talking and typing any time."
              : hasSubmitted
                ? "You can start a fresh fact-find any time — useful if your details have changed. Choose how you'd like to answer."
                : "Choose how you'd like to answer Susan's questions. It takes around 5–10 minutes."}
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-5">
          <button
            type="button"
            disabled={create.isPending}
            onClick={() =>
              inProgress
                ? navigate({ to: "/interview/$sessionId", params: { sessionId: inProgress.id } })
                : create.mutate("voice")
            }
            className="group text-left rounded-2xl border p-5 hover:border-primary hover:bg-muted/40 transition disabled:opacity-60"
          >
            <div className="flex items-center gap-3">
              <span className="inline-flex w-11 h-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Mic className="w-5 h-5" />
              </span>
              <div>
                <div className="font-semibold flex items-center gap-1">
                  {inProgress ? "Continue talking" : "Talk to a spoken assistant"}
                  <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition" />
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {create.isPending && create.variables === "voice"
                    ? "Starting…"
                    : "Susan speaks each question and listens to your voice."}
                </div>
              </div>
            </div>
          </button>
          <button
            type="button"
            disabled={create.isPending}
            onClick={() =>
              inProgress
                ? navigate({ to: "/chat/$sessionId", params: { sessionId: inProgress.id } })
                : create.mutate("chat")
            }
            className="group text-left rounded-2xl border p-5 hover:border-primary hover:bg-muted/40 transition disabled:opacity-60"
          >
            <div className="flex items-center gap-3">
              <span className="inline-flex w-11 h-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                <MessageSquare className="w-5 h-5" />
              </span>
              <div>
                <div className="font-semibold flex items-center gap-1">
                  {inProgress ? "Continue typing" : "Type to a chat assistant"}
                  <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition" />
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {create.isPending && create.variables === "chat"
                    ? "Starting…"
                    : "Answer in a quiet, typed chat — no microphone needed."}
                </div>
              </div>
            </div>
          </button>
          <CustomerAppointmentCard />
          {hasCases && (
            <>
              <Link
                to="/cases"
                className="group text-left rounded-2xl border p-5 hover:border-primary hover:bg-muted/40 transition block"
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex w-11 h-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <FileText className="w-5 h-5" />
                  </span>
                  <div>
                    <div className="font-semibold flex items-center gap-1">
                      Your summary
                      <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition" />
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Journey progress, next steps, and your cases ({caseCount}).
                    </div>
                  </div>
                </div>
              </Link>
              <CustomerRafSelfServeCard />
            </>
          )}
        </div>
      </div>
      {isIntroducer && (
        <div className="mb-6">
          <Link to="/introducer">
            <Button variant="outline" size="sm">
              <Link2 className="w-4 h-4 mr-2" />
              Introducer portal
            </Button>
          </Link>
        </div>
      )}
      {inProgress && hasCases && (
        <p className="text-sm text-muted-foreground mb-4">
          You have a fact-find in progress — use Talk or Type above to continue, or open{" "}
          <Link to="/cases" className="text-primary underline-offset-2 hover:underline">
            Your summary
          </Link>{" "}
          for journey and booking details.
        </p>
      )}
      {inProgress && !hasCases && (
        <p className="text-sm text-muted-foreground mb-4">
          You have a fact-find in progress — use Talk or Type above to continue.
        </p>
      )}
    </AppShell>
  );
}
