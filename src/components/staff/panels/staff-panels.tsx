import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import {
  deleteSession,
  restoreSession,
  listUsersWithRoles,
  setAdvisorRole,
  setIntroducerRole,
  listAdvisors,
  listAdvisorCustomers,
  allocateSession,
  unallocateSession,
  bulkAllocateSessions,
  transferSession,
  bulkTransferSessions,
  softDeleteAdvisor,
  restoreAdvisor,
  softDeleteIntroducer,
  restoreIntroducer,
  listBinnedStaff,
  createStaffInvite,
  listStaffInvites,
  revokeStaffInvite,
} from "@/lib/sessions.functions";
import { listAdmins, setAdminLevel, setAdminPermissions, listUsersForAdminGrant } from "@/lib/admin.functions";
import {
  listFinanceLedger,
  setCommissionRate,
  getCommissionRate,
  getRafBonusAmount,
  listCommissionStaff,
  listCommissionRateHistory,
  listFinanceAuditLog,
  listCurrentCommissionArrangements,
  listCommissionPayouts,
  FEE_TYPE_LABELS,
  RAF_BONUS_POUNDS,
  type EnrichedLedgerRow,
} from "@/lib/finance.functions";
import {
  ADMIN_LEVEL_LABELS,
  DEFAULT_GENERAL_PERMISSIONS,
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  canView,
  canEditAdminPermissions,
  canGrantAdminLevel,
  type AdminAccess,
  type PermissionAccess,
  type PermissionKey,
} from "@/lib/admin-access";
import type { AdvisorCustomerRow } from "@/lib/sessions.functions";
import { listAdvisorContacts, markContactOpened } from "@/lib/booking.functions";
import type { AdvisorContact } from "@/lib/booking.functions";
import { completeStaffContactTask } from "@/lib/staff-contact-tasks.functions";
import { isStaffTaskOverdue, STAFF_TASK_LABELS } from "@/lib/staff-contact-tasks";
import { AssignVoicemailAdvisor } from "@/components/AssignVoicemailAdvisor";
import { MarkContactedButton } from "@/components/MarkContactedButton";
import { PhoneCallDetailDialog } from "@/components/PhoneCallDetailDialog";
import {
  createReferralLink,
  textReferralLink,
  textRafInviteToFriend,
  getPublicShareBaseUrl,
  listReferralLinks,
  listAllReferrals,
  updateReferralBonusStatus,
  searchCustomers,
} from "@/lib/referrals.functions";
import { rafLinkForCode, rafShareMessage } from "@/lib/referral";
import { ManageListControls, ManageListScroll, type ManageListSort } from "@/components/ManageListControls";
import { ReportExportBox } from "@/components/ReportExportBox";
import { ReportTableScroll } from "@/components/ReportTableScroll";
import { commissionRowsToSheet, ledgerRowsToSheet, rateHistoryToSheet, financeAuditToSheet } from "@/lib/report-mappers";
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
import {
  Trash2,
  RotateCcw,
  ShieldCheck,
  ShieldOff,
  CalendarCheck,
  Link2,
  UserPlus,
  UserMinus,
  Users,
  UserCog,
  Search,
  KeyRound,
  Copy,
  Check,
  Mail,
  Gift,
  Send,
  Phone,
  Hash,
  Briefcase,
  ChevronRight,
  PhoneCall,
  Inbox,
  PoundSterling,
  ArrowRightLeft,
  Clock,
} from "lucide-react";
import { safeFormat, safeFormatDistanceToNow } from "@/lib/safe-format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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

export function AdminAccessPanel({ isOwner, canEditPerms }: { isOwner: boolean; canEditPerms: boolean }) {
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
            Admins register via an invite link from Manage. If that email already exists
            (for example a test account), they can open the invite and sign in with the
            existing password to attach the admin role. Then grant supervisor/general
            access and the permission matrix here.
          </p>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 items-end">
          <div className="space-y-1 sm:col-span-1">
            <Label>Registered admin</Label>
            <select
              className="w-full h-9 rounded-md border bg-background px-2 text-sm"
              value={grantUserId}
              onChange={(e) => setGrantUserId(e.target.value)}
            >
              <option value="">Select registered admin…</option>
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
                  {a.level === "general" && canEditPerms && (
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

export function OwnerFinanceReport() {
  const ledgerFn = useServerFn(listFinanceLedger);
  const staffFn = useServerFn(listCommissionStaff);
  const setRateFn = useServerFn(setCommissionRate);
  const getRateFn = useServerFn(getCommissionRate);
  const historyFn = useServerFn(listCommissionRateHistory);
  const auditFn = useServerFn(listFinanceAuditLog);
  const arrangementsFn = useServerFn(listCurrentCommissionArrangements);
  const rafBonusFn = useServerFn(getRafBonusAmount);
  const commissionExportFn = useServerFn(listCommissionPayouts);
  const ledgerQ = useQuery({ queryKey: ["finance-ledger"], queryFn: () => ledgerFn() });
  const auditQ = useQuery({ queryKey: ["finance-audit"], queryFn: () => auditFn() });
  const [arrangementRole, setArrangementRole] = useState<"all" | "advisor" | "introducer">("all");
  const arrangementsQ = useQuery({
    queryKey: ["commission-arrangements", arrangementRole],
    queryFn: () => arrangementsFn({ data: { role: arrangementRole } }),
  });
  const [rateHistoryFrom, setRateHistoryFrom] = useState("");
  const [rateHistoryTo, setRateHistoryTo] = useState("");
  const [rateHistoryFeeType, setRateHistoryFeeType] = useState<string>("");
  const [rateHistoryRole, setRateHistoryRole] = useState<"" | "advisor" | "introducer">("");
  const [rateHistoryUserId, setRateHistoryUserId] = useState("");
  const [rateHistoryStaffSearch, setRateHistoryStaffSearch] = useState("");
  const [showRateHistoryBrowse, setShowRateHistoryBrowse] = useState(false);
  const browseStaffQ = useQuery({
    queryKey: ["commission-staff-browse", rateHistoryRole, rateHistoryStaffSearch],
    queryFn: () =>
      staffFn({
        data: {
          role: rateHistoryRole || "advisor",
          query: rateHistoryStaffSearch || undefined,
        },
      }),
    enabled: showRateHistoryBrowse && Boolean(rateHistoryRole),
  });
  const browseHistoryQ = useQuery({
    queryKey: [
      "commission-history-browse",
      rateHistoryFrom,
      rateHistoryTo,
      rateHistoryFeeType,
      rateHistoryRole,
      rateHistoryUserId,
    ],
    queryFn: () =>
      historyFn({
        data: {
          from: rateHistoryFrom || undefined,
          to: rateHistoryTo || undefined,
          feeType: rateHistoryFeeType
            ? (rateHistoryFeeType as "fee" | "mortgage_fee" | "insurance_fee" | "other_fee")
            : undefined,
          role: rateHistoryRole || undefined,
          userId: rateHistoryUserId || undefined,
        },
      }),
    enabled: showRateHistoryBrowse,
  });

  const commissionExportQ = useQuery({
    queryKey: ["finance-export-commission"],
    queryFn: () => commissionExportFn({ data: {} }),
  });
  const rafBonusQ = useQuery({ queryKey: ["raf-bonus-amount"], queryFn: () => rafBonusFn() });
  const [rateRole, setRateRole] = useState<"advisor" | "introducer" | "admin">("advisor");
  const [rateUserId, setRateUserId] = useState("");
  const [staffSearch, setStaffSearch] = useState("");
  const [pctFee, setPctFee] = useState("10");
  const [pctMortgage, setPctMortgage] = useState("10");
  const [pctInsurance, setPctInsurance] = useState("10");
  const [pctOther, setPctOther] = useState("10");
  const [introPctFee, setIntroPctFee] = useState("10");
  const [introPctMortgage, setIntroPctMortgage] = useState("10");

  const staffQ = useQuery({
    queryKey: ["commission-staff", rateRole, staffSearch],
    queryFn: () => staffFn({ data: { role: rateRole, query: staffSearch || undefined } }),
  });

  // DB rate role: admins only store introducer % (for bookings they make).
  const storedRateRole = rateRole === "admin" ? "introducer" : rateRole;

  const existingRateQ = useQuery({
    queryKey: ["commission-rate", rateUserId, storedRateRole],
    queryFn: () => getRateFn({ data: { userId: rateUserId, role: storedRateRole } }),
    enabled: Boolean(rateUserId),
  });

  const existingIntroRateQ = useQuery({
    queryKey: ["commission-rate", rateUserId, "introducer"],
    queryFn: () => getRateFn({ data: { userId: rateUserId, role: "introducer" } }),
    enabled: Boolean(rateUserId) && rateRole === "advisor",
  });

  const historyQ = useQuery({
    queryKey: ["commission-history", rateUserId, storedRateRole],
    queryFn: () => historyFn({ data: { userId: rateUserId, role: storedRateRole } }),
    enabled: Boolean(rateUserId),
  });

  useEffect(() => {
    setRateUserId("");
  }, [rateRole]);

  useEffect(() => {
    setRateHistoryUserId("");
  }, [rateHistoryRole]);

  useEffect(() => {
    const r = existingRateQ.data;
    if (!r || !rateUserId) return;
    if (r.pctFee != null) setPctFee(String(r.pctFee));
    if (r.pctMortgageFee != null) setPctMortgage(String(r.pctMortgageFee));
    if (rateRole === "advisor") {
      if (r.pctInsuranceFee != null) setPctInsurance(String(r.pctInsuranceFee));
      if (r.pctOtherFee != null) setPctOther(String(r.pctOtherFee));
    }
  }, [existingRateQ.data, rateUserId, rateRole]);

  useEffect(() => {
    const r = existingIntroRateQ.data;
    if (!r || !rateUserId || rateRole !== "advisor") return;
    if (r.pctFee != null) setIntroPctFee(String(r.pctFee));
    if (r.pctMortgageFee != null) setIntroPctMortgage(String(r.pctMortgageFee));
  }, [existingIntroRateQ.data, rateUserId, rateRole]);

  const setRate = useMutation({
    mutationFn: async () => {
      if (rateRole === "admin") {
        // Admins only earn introducer commission on appointments they book.
        await setRateFn({
          data: {
            userId: rateUserId,
            role: "introducer",
            pctFee: Number(pctFee),
            pctMortgageFee: Number(pctMortgage),
            pctInsuranceFee: 0,
            pctOtherFee: 0,
          },
        });
        return;
      }
      if (rateRole === "introducer") {
        await setRateFn({
          data: {
            userId: rateUserId,
            role: "introducer",
            pctFee: Number(pctFee),
            pctMortgageFee: Number(pctMortgage),
            pctInsuranceFee: 0,
            pctOtherFee: 0,
          },
        });
        return;
      }
      await setRateFn({
        data: {
          userId: rateUserId,
          role: "advisor",
          pctFee: Number(pctFee),
          pctMortgageFee: Number(pctMortgage),
          pctInsuranceFee: Number(pctInsurance),
          pctOtherFee: Number(pctOther),
        },
      });
      await setRateFn({
        data: {
          userId: rateUserId,
          role: "introducer",
          pctFee: Number(introPctFee),
          pctMortgageFee: Number(introPctMortgage),
          pctInsuranceFee: 0,
          pctOtherFee: 0,
        },
      });
    },
    onSuccess: () => {
      toast.success("Commission rates saved — applies to new fees only");
      historyQ.refetch();
      existingRateQ.refetch();
      if (rateRole === "advisor") existingIntroRateQ.refetch();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save rates"),
  });

  const rows = (ledgerQ.data?.rows ?? []) as EnrichedLedgerRow[];
  const auditRows = auditQ.data ?? [];
  const arrangements = arrangementsQ.data ?? [];
  const staff = staffQ.data ?? [];
  const rafBonusPounds =
    rafBonusQ.data?.amountPence != null ? rafBonusQ.data.amountPence / 100 : RAF_BONUS_POUNDS;
  const exportSheets = [
    ledgerRowsToSheet(rows),
    commissionRowsToSheet(commissionExportQ.data?.rows ?? []),
    financeAuditToSheet(auditRows),
    rateHistoryToSheet(browseHistoryQ.data ?? []),
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

  const personLabel =
    rateRole === "advisor" ? "Advisor" : rateRole === "admin" ? "Admin" : "Introducer";

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-6 min-w-0">
    <div className="rounded-2xl border bg-card p-6 space-y-4">
      <div>
        <h3 className="font-semibold text-lg">Commission rates</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Advisors: case commission by fee type, plus introducer % when they book a customer.
          Admins: introducer % only (appointments they book — shown on the customer profile).
          Introducers: fee + mortgage fee only. Changes apply to newly posted fees.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Role</Label>
          <select
            className="w-full h-9 rounded-md border bg-background px-2 text-sm"
            value={rateRole}
            onChange={(e) => setRateRole(e.target.value as "advisor" | "introducer" | "admin")}
          >
            <option value="advisor">Advisor</option>
            <option value="admin">Admin</option>
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
        <Label>{personLabel}</Label>
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
        {(rateRole === "advisor" || rateRole === "introducer" || rateRole === "admin") && (
        <div className="grid sm:grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-4">
          <div className="sm:col-span-2 text-sm font-medium">
            {rateRole === "advisor"
              ? "Advisor commission %"
              : rateRole === "admin"
                ? "Introducer commission % (admin bookings — fee + mortgage fee)"
                : "Introducer commission % (fee + mortgage fee only)"}
          </div>
          <div className="space-y-1">
            <Label>{FEE_TYPE_LABELS.fee} %</Label>
            <Input type="number" min="0" max="100" step="0.1" value={pctFee} onChange={(e) => setPctFee(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{FEE_TYPE_LABELS.mortgage_fee} %</Label>
            <Input type="number" min="0" max="100" step="0.1" value={pctMortgage} onChange={(e) => setPctMortgage(e.target.value)} />
          </div>
          {rateRole === "advisor" && (
            <>
              <div className="space-y-1">
                <Label>{FEE_TYPE_LABELS.insurance_fee} %</Label>
                <Input type="number" min="0" max="100" step="0.1" value={pctInsurance} onChange={(e) => setPctInsurance(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{FEE_TYPE_LABELS.other_fee} %</Label>
                <Input type="number" min="0" max="100" step="0.1" value={pctOther} onChange={(e) => setPctOther(e.target.value)} />
              </div>
            </>
          )}
          {(rateRole === "introducer" || rateRole === "admin") && (
            <p className="sm:col-span-2 text-xs text-muted-foreground">
              {rateRole === "admin"
                ? "When this admin books a customer, they appear as introducer on the customer profile. Payable introducer commission uses these rates (fee + mortgage fee only)."
                : "Introducers earn on fee and mortgage fee only. Insurance and other rates are advisor-only."}
            </p>
          )}
        </div>
        )}
        {rateRole === "advisor" && (
          <div className="grid sm:grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-4">
            <div className="sm:col-span-2 text-sm font-medium">
              Introducer commission % (when this advisor is the customer&apos;s introducer)
            </div>
            <div className="space-y-1">
              <Label>{FEE_TYPE_LABELS.fee} %</Label>
              <Input type="number" min="0" max="100" step="0.1" value={introPctFee} onChange={(e) => setIntroPctFee(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{FEE_TYPE_LABELS.mortgage_fee} %</Label>
              <Input type="number" min="0" max="100" step="0.1" value={introPctMortgage} onChange={(e) => setIntroPctMortgage(e.target.value)} />
            </div>
            <p className="sm:col-span-2 text-xs text-muted-foreground">
              Fee + mortgage fee only — insurance / other commission stays on the advisor rates above.
            </p>
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
          <ReportTableScroll visibleRows={5}>
            <ul className="text-xs space-y-1.5 text-muted-foreground p-1">
              {(historyQ.data ?? []).map((h, i) => (
                <li key={i}>
                  {safeFormat(h.created_at, "d MMM yyyy HH:mm")} ·{" "}
                  <span className="capitalize">{h.role}</span> ·{" "}
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

    <div className="rounded-2xl border bg-card p-6 space-y-4">
      <div>
        <h3 className="font-semibold text-lg">Commission audit history</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Rate changes and introducer amendments. Showing latest entries.
        </p>
      </div>
      <ReportTableScroll visibleRows={5}>
        <ul className="text-xs divide-y">
          {auditRows.length === 0 && (
            <li className="p-3 text-muted-foreground">No audit entries yet.</li>
          )}
          {auditRows.slice(0, 50).map((a) => (
            <li key={a.id} className="p-2.5 text-muted-foreground">
              <span className="text-foreground font-medium">
                {safeFormat(a.created_at, "d MMM yyyy HH:mm")}
              </span>
              {" · "}
              {a.summary}
            </li>
          ))}
        </ul>
      </ReportTableScroll>
      <ReportExportBox
        filename={`finance-audit-${new Date().toISOString().slice(0, 10)}`}
        label="Audit export"
        sheets={[financeAuditToSheet(auditRows)]}
        pdfSections={[{ title: "Finance audit", headers: financeAuditToSheet(auditRows).headers, rows: financeAuditToSheet(auditRows).rows }]}
      />
    </div>

    <div className="rounded-2xl border bg-card p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 justify-between">
        <div>
          <h3 className="font-semibold text-lg">Current commission arrangements</h3>
          <p className="text-sm text-muted-foreground mt-1">Active % by role and staff member.</p>
        </div>
        <div className="space-y-1 shrink-0">
          <Label>Role</Label>
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm w-full sm:w-44"
            value={arrangementRole}
            onChange={(e) => setArrangementRole(e.target.value as "all" | "advisor" | "introducer")}
          >
            <option value="all">All roles</option>
            <option value="advisor">Advisors</option>
            <option value="introducer">Introducers</option>
          </select>
        </div>
      </div>
      <ReportTableScroll visibleRows={5}>
        <table className="w-full text-xs sm:text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground bg-muted/40">
              <th className="p-2 font-medium sticky top-0 bg-muted/40">Name</th>
              <th className="p-2 font-medium sticky top-0 bg-muted/40">Role</th>
              <th className="p-2 font-medium sticky top-0 bg-muted/40">Ref</th>
              <th className="p-2 font-medium text-right sticky top-0 bg-muted/40">Fee</th>
              <th className="p-2 font-medium text-right sticky top-0 bg-muted/40">Mortgage</th>
              <th className="p-2 font-medium text-right sticky top-0 bg-muted/40">Insurance</th>
              <th className="p-2 font-medium text-right sticky top-0 bg-muted/40">Other</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {arrangements.map((a) => (
              <tr key={`${a.userId}-${a.role}`}>
                <td className="p-2 font-medium max-w-[8rem] truncate">{a.name}</td>
                <td className="p-2 capitalize">{a.role}</td>
                <td className="p-2 font-mono text-xs">{a.referenceCode ?? "—"}</td>
                <td className="p-2 text-right">{a.pctFee}%</td>
                <td className="p-2 text-right">{a.pctMortgageFee}%</td>
                <td className="p-2 text-right">{a.pctInsuranceFee}%</td>
                <td className="p-2 text-right">{a.pctOtherFee}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ReportTableScroll>
      <Button type="button" variant="outline" size="sm" onClick={() => setShowRateHistoryBrowse((v) => !v)}>
        {showRateHistoryBrowse ? "Hide" : "Browse"} previous rates by date
      </Button>
      {showRateHistoryBrowse && (
        <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>From</Label>
              <Input type="date" value={rateHistoryFrom} onChange={(e) => setRateHistoryFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>To</Label>
              <Input type="date" value={rateHistoryTo} onChange={(e) => setRateHistoryTo(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Fee type</Label>
              <select
                className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                value={rateHistoryFeeType}
                onChange={(e) => setRateHistoryFeeType(e.target.value)}
              >
                <option value="">All types</option>
                {Object.entries(FEE_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <select
                className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                value={rateHistoryRole}
                onChange={(e) => setRateHistoryRole(e.target.value as "" | "advisor" | "introducer")}
              >
                <option value="">All roles</option>
                <option value="advisor">Advisor</option>
                <option value="introducer">Introducer</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>Search name</Label>
              <Input
                placeholder="Name or reference code…"
                value={rateHistoryStaffSearch}
                onChange={(e) => setRateHistoryStaffSearch(e.target.value)}
                disabled={!rateHistoryRole}
              />
            </div>
            <div className="space-y-1">
              <Label>{rateHistoryRole === "introducer" ? "Introducer" : rateHistoryRole === "advisor" ? "Advisor" : "Staff member"}</Label>
              <select
                className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                value={rateHistoryUserId}
                onChange={(e) => setRateHistoryUserId(e.target.value)}
                disabled={!rateHistoryRole}
              >
                <option value="">{rateHistoryRole ? "All in role" : "Select a role first"}</option>
                {(browseStaffQ.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name || u.email}
                    {u.referenceCode ? ` · ${u.referenceCode}` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <ReportTableScroll visibleRows={5}>
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground bg-muted/40">
                  <th className="p-2 font-medium sticky top-0 bg-muted/40">When</th>
                  <th className="p-2 font-medium sticky top-0 bg-muted/40">Name</th>
                  <th className="p-2 font-medium sticky top-0 bg-muted/40">Role</th>
                  <th className="p-2 font-medium sticky top-0 bg-muted/40">Fee type</th>
                  <th className="p-2 font-medium sticky top-0 bg-muted/40">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(browseHistoryQ.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-3 text-muted-foreground">
                      No rate changes in this range.
                    </td>
                  </tr>
                )}
                {(browseHistoryQ.data ?? []).map((h, i) => (
                  <tr key={i} className="text-muted-foreground">
                    <td className="p-2 whitespace-nowrap">
                      {safeFormat(h.created_at, "d MMM yyyy HH:mm")}
                    </td>
                    <td className="p-2 font-medium text-foreground max-w-[10rem] truncate">
                      {"user_name" in h ? String((h as { user_name?: string }).user_name ?? "—") : "—"}
                    </td>
                    <td className="p-2 capitalize">{h.role ?? "—"}</td>
                    <td className="p-2">
                      {FEE_TYPE_LABELS[h.fee_type as keyof typeof FEE_TYPE_LABELS] ?? h.fee_type}
                    </td>
                    <td className="p-2">
                      {h.pct_from != null ? `${h.pct_from}% → ` : "new "}
                      {h.pct_to}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ReportTableScroll>
          <ReportExportBox
            filename={`commission-rate-history-${new Date().toISOString().slice(0, 10)}`}
            label="Rate history"
            sheets={[rateHistoryToSheet(browseHistoryQ.data ?? [])]}
            pdfSections={[
              {
                title: "Commission rate history",
                headers: rateHistoryToSheet(browseHistoryQ.data ?? []).headers,
                rows: rateHistoryToSheet(browseHistoryQ.data ?? []).rows,
              },
            ]}
          />
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
      <ReportTableScroll visibleRows={5}>
        <table className="w-full text-xs sm:text-sm min-w-[640px]">
          <thead>
            <tr className="border-b text-left text-muted-foreground bg-muted/40">
              <th className="p-2 font-medium sticky top-0 bg-muted/40 whitespace-nowrap">When</th>
              <th className="p-2 font-medium sticky top-0 bg-muted/40">Kind</th>
              <th className="p-2 font-medium sticky top-0 bg-muted/40">Customer</th>
              <th className="p-2 font-medium sticky top-0 bg-muted/40">Case</th>
              <th className="p-2 font-medium sticky top-0 bg-muted/40">Type</th>
              <th className="p-2 font-medium text-right sticky top-0 bg-muted/40">Amount</th>
              <th className="p-2 font-medium sticky top-0 bg-muted/40">Receiver</th>
              <th className="p-2 font-medium sticky top-0 bg-muted/40">Ref</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => {
              const red = r.is_reversal || r.kind === "amend" || r.kind === "delete";
              const isCommission = r.kind === "commission";
              return (
                <tr key={r.id} className={red ? "text-destructive" : ""}>
                  <td className="p-2 whitespace-nowrap">
                    {safeFormat(r.created_at, "d MMM yy HH:mm")}
                  </td>
                  <td className="p-2 capitalize">{r.kind}</td>
                  <td className="p-2 max-w-[7rem] truncate">{r.customerName ?? "—"}</td>
                  <td className="p-2 font-mono text-[10px] sm:text-xs max-w-[5rem] truncate">
                    {r.caseRef ?? "—"}
                  </td>
                  <td className="p-2">{r.fee_type ?? "—"}</td>
                  <td className="p-2 text-right font-medium whitespace-nowrap">
                    £{(r.amount_pence / 100).toFixed(2)}
                  </td>
                  <td className="p-2 max-w-[7rem] truncate">
                    {isCommission ? r.receiverName ?? "—" : "—"}
                  </td>
                  <td className="p-2 font-mono text-[10px] sm:text-xs">
                    {isCommission ? r.receiverRef ?? "—" : "—"}
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

export function AdvisorAccessCard() {
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
      <h3 className="text-sm font-medium text-muted-foreground mb-3">Team roles</h3>
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

export function IntroducerAccessCard() {
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
export function RecentlyDeletedCard() {
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
export function InviteStaffCard() {
  const qc = useQueryClient();
  const createFn = useServerFn(createStaffInvite);
  const listFn = useServerFn(listStaffInvites);
  const revokeFn = useServerFn(revokeStaffInvite);

  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<"advisor" | "introducer" | "admin">("advisor");
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
                    Expires {safeFormatDistanceToNow(created.expires_at, { addSuffix: true })}.
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
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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
                    <button
                      type="button"
                      onClick={() => setRole("admin")}
                      className={`flex items-center gap-2 rounded-lg border p-3 text-sm text-left ${role === "admin" ? "border-primary bg-primary/5" : ""}`}
                    >
                      <UserCog className="w-4 h-4" /> Admin
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
                      ? `used ${safeFormatDistanceToNow(inv.used_at, { addSuffix: true })}`
                      : `expires ${safeFormatDistanceToNow(inv.expires_at, { addSuffix: true })}`}
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

export function RafLinksAccessCard() {
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
        <ManageListScroll visibleRows={5}>
        {links.map((l) => {
          const linkReferrals = referrals.filter((r) => r.code === l.code);
          return (
            <div key={l.id} className="p-3 sm:p-4 space-y-2 border-b last:border-b-0">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{l.referrer_name || "Referrer"}</div>
                  <p className="text-xs text-muted-foreground">
                    {l.referralCount} referral{l.referralCount === 1 ? "" : "s"} · code{" "}
                    <span className="font-mono">{l.code}</span>
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5 shrink-0">
                  <CopyLinkButton value={rafLinkForCode(l.code, shareBase)} label="Copy" />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={!l.referrer_phone || (text.isPending && text.variables?.id === l.id)}
                    onClick={() => text.mutate({ id: l.id })}
                  >
                    <Send className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              {linkReferrals.length > 0 && (
                <p className="text-[10px] text-muted-foreground">
                  {linkReferrals.length} referred friend{linkReferrals.length === 1 ? "" : "s"} — see Commission tab
                </p>
              )}
            </div>
          );
        })}
        </ManageListScroll>
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
                  <dd>{safeFormatDistanceToNow(r.created_at, { addSuffix: true })}</dd>
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

export function BulkAllocateDialog({
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

export function TransferDialog({
  sessionId,
  assigned,
  onDone,
}: {
  sessionId: string;
  assigned: AssignedAdvisor[];
  onDone: () => void;
}) {
  const advisorsFn = useServerFn(listAdvisors);
  const transferFn = useServerFn(transferSession);
  const [open, setOpen] = useState(false);
  const [fromAdvisorId, setFromAdvisorId] = useState("");
  const [toAdvisorId, setToAdvisorId] = useState("");

  const advisorsQ = useQuery({
    queryKey: ["advisors"],
    queryFn: () => advisorsFn(),
    enabled: open,
  });

  useEffect(() => {
    if (!open || fromAdvisorId || assigned.length === 0) return;
    setFromAdvisorId(assigned[0].id);
  }, [open, fromAdvisorId, assigned]);

  const transfer = useMutation({
    mutationFn: () =>
      transferFn({
        data: { sessionId, fromAdvisorId, toAdvisorId },
      }),
    onSuccess: () => {
      toast.success("Customer transferred");
      setOpen(false);
      setToAdvisorId("");
      onDone();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not transfer"),
  });

  const advisors = advisorsQ.data ?? [];
  const canSubmit =
    fromAdvisorId && toAdvisorId && fromAdvisorId !== toAdvisorId && assigned.length > 0;

  if (assigned.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" onClick={(e) => e.stopPropagation()}>
          <ArrowRightLeft className="w-4 h-4 mr-1.5" />
          Transfer
        </Button>
      </DialogTrigger>
      <DialogContent onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Transfer customer file</DialogTitle>
          <DialogDescription>
            Move this file from one advisor to another. The source advisor loses access; the target
            gains it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {assigned.length > 1 && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">From advisor</label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={fromAdvisorId}
                onChange={(e) => setFromAdvisorId(e.target.value)}
              >
                {assigned.map((a) => (
                  <option key={a.id} value={a.id}>
                    {advisorLabel(a)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">To advisor</label>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={toAdvisorId}
              onChange={(e) => setToAdvisorId(e.target.value)}
            >
              <option value="">— Select advisor —</option>
              {advisors
                .filter((a) => a.id !== fromAdvisorId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {advisorLabel(a)}
                    {(a as { code?: string | null }).code
                      ? ` (${(a as { code?: string | null }).code})`
                      : ""}
                  </option>
                ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!canSubmit || transfer.isPending} onClick={() => transfer.mutate()}>
            {transfer.isPending ? "Transferring…" : "Transfer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BulkTransferDialog({
  selectedIds,
  onDone,
}: {
  selectedIds: string[];
  onDone: () => void;
}) {
  const advisorsFn = useServerFn(listAdvisors);
  const bulkFn = useServerFn(bulkTransferSessions);
  const [open, setOpen] = useState(false);
  const [fromAdvisorId, setFromAdvisorId] = useState("");
  const [toAdvisorId, setToAdvisorId] = useState("");
  const [code, setCode] = useState("");

  const advisorsQ = useQuery({
    queryKey: ["advisors"],
    queryFn: () => advisorsFn(),
    enabled: open,
  });
  const advisors = advisorsQ.data ?? [];

  const transfer = useMutation({
    mutationFn: () =>
      bulkFn({
        data: {
          sessionIds: selectedIds,
          fromAdvisorId,
          toAdvisorId: toAdvisorId || undefined,
          toAdvisorCode: !toAdvisorId && code ? code : undefined,
        },
      }),
    onSuccess: (res) => {
      const skipped = res.skipped?.length ?? 0;
      if (skipped > 0) {
        toast.warning(
          `Transferred ${res.transferredCount}. Skipped ${skipped} (not assigned or at advisor limit).`,
        );
      } else {
        toast.success(
          `Transferred ${res.transferredCount} customer${res.transferredCount === 1 ? "" : "s"}.`,
        );
      }
      setOpen(false);
      setFromAdvisorId("");
      setToAdvisorId("");
      setCode("");
      onDone();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not transfer"),
  });

  const canSubmit =
    fromAdvisorId && (toAdvisorId || code.trim()) && fromAdvisorId !== toAdvisorId && selectedIds.length > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" disabled={selectedIds.length === 0}>
          <ArrowRightLeft className="w-4 h-4 mr-1.5" />
          Bulk transfer ({selectedIds.length})
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transfer {selectedIds.length} customer{selectedIds.length === 1 ? "" : "s"}</DialogTitle>
          <DialogDescription>
            Move selected files from one advisor to another. Files not assigned to the source advisor
            are skipped.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">From advisor</label>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={fromAdvisorId}
              onChange={(e) => setFromAdvisorId(e.target.value)}
            >
              <option value="">— Select advisor —</option>
              {advisors.map((a) => (
                <option key={a.id} value={a.id}>
                  {advisorLabel(a)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">To advisor</label>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={toAdvisorId}
              onChange={(e) => {
                setToAdvisorId(e.target.value);
                if (e.target.value) setCode("");
              }}
            >
              <option value="">— Select advisor —</option>
              {advisors
                .filter((a) => a.id !== fromAdvisorId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {advisorLabel(a)}
                  </option>
                ))}
            </select>
          </div>
          <div className="text-center text-xs text-muted-foreground">or target code</div>
          <Input
            placeholder="Advisor code"
            value={code}
            maxLength={5}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5));
              if (e.target.value) setToAdvisorId("");
            }}
            className="font-mono w-40 uppercase"
          />
        </div>
        <DialogFooter>
          <Button disabled={!canSubmit || transfer.isPending} onClick={() => transfer.mutate()}>
            {transfer.isPending ? "Transferring…" : "Transfer"}
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

export function DashboardSessionsListHeader({ showCheckbox }: { showCheckbox: boolean }) {
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
  const startedLabel = safeFormatDistanceToNow(row.startedAt, { addSuffix: true });

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

export function DashboardSessionRow({
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
    missingLenderAfterCompletion?: boolean;
    archivedFromAdvisor?: boolean;
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
  const missingLender = Boolean(session.missingLenderAfterCompletion);
  const archivedComplete = Boolean(session.archivedFromAdvisor);
  const name = session.customer?.full_name || session.customer?.email || "Unnamed customer";
  const contactLine =
    [session.customer?.email, session.customer?.phone].filter(Boolean).join(" · ") ||
    "No contact on file";
  const statusLabel = session.status === "submitted" ? "Submitted" : "In progress";
  const startedLabel = safeFormatDistanceToNow(session.started_at, { addSuffix: true });
  const advisorLine =
    assigned.length > 0
      ? assigned.map(advisorLabel).join(", ")
      : !isCase
        ? "Unallocated"
        : null;

  const navigate = useNavigate();

  const openSession = () => {
    if (callback) onCallbackOpen(callback.id);
    navigate({ to: "/sessions/$sessionId", params: { sessionId: session.id } });
  };

  const stopRowClick = (e: MouseEvent) => {
    e.stopPropagation();
  };

  const gridCols = isMainAdmin
    ? "sm:grid-cols-[auto_minmax(0,1.3fr)_6.75rem_5.25rem_minmax(0,1fr)_auto]"
    : "sm:grid-cols-[minmax(0,1.3fr)_6.75rem_5.25rem_minmax(0,1fr)_auto]";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openSession}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openSession();
        }
      }}
      className={cn(
        "grid grid-cols-[1fr_auto] items-start gap-x-3 gap-y-2 px-4 py-3.5 sm:items-center sm:gap-x-4 sm:py-3 border-b border-border/60 last:border-0 transition-colors cursor-pointer",
        gridCols,
        missingLender
          ? "bg-red-50/90 hover:bg-red-100/80 dark:bg-red-950/30 dark:hover:bg-red-950/45 border-l-4 border-l-red-500"
          : archivedComplete
            ? "bg-muted/40 hover:bg-muted/55 opacity-90"
            : callback
              ? "bg-primary/[0.04] hover:bg-primary/[0.07]"
              : "hover:bg-muted/25",
      )}
    >
      {isMainAdmin && (
        <Checkbox
          className="hidden sm:block shrink-0"
          checked={selected}
          onClick={stopRowClick}
          onCheckedChange={(v) => onToggleSelect(v === true)}
          aria-label="Select record"
        />
      )}

      <div className="min-w-0 col-start-1 row-start-1 sm:col-start-2 group/link">
        <div className="flex items-center gap-2 min-w-0">
          <p className="font-medium text-sm leading-snug truncate">{name}</p>
          {callback && (
            <span className="inline-flex shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
              New
            </span>
          )}
          {missingLender && (
            <span className="inline-flex shrink-0 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              Lender needed
            </span>
          )}
          {archivedComplete && !missingLender && (
            <span className="inline-flex shrink-0 rounded-full bg-muted-foreground/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Completed
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">{contactLine}</p>
      </div>

      <div className="hidden sm:flex sm:col-start-3">
        <SessionReferenceBadge caseRef={caseRef} />
      </div>

      <div className="hidden sm:flex sm:col-start-4">
        <SessionProgressBadge isCase={isCase} status={session.status} />
      </div>

      <div className="hidden sm:block min-w-0 text-xs text-muted-foreground space-y-1 sm:col-start-5">
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
                {safeFormat(nextContactAt, "EEE d MMM, HH:mm")}
              </span>
            )}
          </div>
        )}
      </div>

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
                {safeFormat(nextContactAt, "EEE d MMM")}
              </span>
            )}
          </div>
        )}
      </div>

      <div
        className="col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto flex items-center gap-0.5 shrink-0 self-center"
        onClick={stopRowClick}
      >
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
          >
            Customer
          </Button>
        </Link>
        {isMainAdmin && !isCase && (
          <AllocateDialog sessionId={session.id} assigned={assigned} onChanged={onInvalidate} />
        )}
        {isMainAdmin && assigned.length > 0 && (
          <TransferDialog sessionId={session.id} assigned={assigned} onDone={onInvalidate} />
        )}
        {(isOwner || isSupervisor) && (
          <DeleteButton sessionId={session.id} onDeleted={onInvalidate} />
        )}
        <ChevronRight className="w-4 h-4 text-muted-foreground hidden sm:block" />
      </div>
    </div>
  );
}

export function AdvisorsCard() {
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
export function ContactsCard({
  adminAccess,
  isOwner,
}: {
  adminAccess: AdminAccess | null;
  isOwner: boolean;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const contactsFn = useServerFn(listAdvisorContacts);
  const openFn = useServerFn(markContactOpened);
  const completeTaskFn = useServerFn(completeStaffContactTask);
  const [voicemailCallId, setVoicemailCallId] = useState<string | null>(null);
  const [advisorFilter, setAdvisorFilter] = useState<"all" | "unallocated" | string>("all");

  const canFilterByAdvisor = Boolean(
    isOwner || adminAccess?.isOwner || adminAccess?.isSupervisor || adminAccess?.isAdmin,
  );

  const contactsQ = useQuery({ queryKey: ["advisor-contacts"], queryFn: () => contactsFn() });
  const allContacts = (contactsQ.data ?? []) as AdvisorContact[];

  const advisorOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of allContacts) {
      if (c.advisorId && c.advisorName) map.set(c.advisorId, c.advisorName);
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allContacts]);

  const contacts = useMemo(() => {
    if (!canFilterByAdvisor || advisorFilter === "all") return allContacts;
    if (advisorFilter === "unallocated") {
      return allContacts.filter((c) => c.unallocated || !c.advisorId);
    }
    return allContacts.filter((c) => c.advisorId === advisorFilter);
  }, [allContacts, advisorFilter, canFilterByAdvisor]);

  const abandonedLeads = useMemo(
    () => contacts.filter((c) => c.kind === "abandoned"),
    [contacts],
  );
  const liveContacts = useMemo(
    () => contacts.filter((c) => c.kind !== "abandoned"),
    [contacts],
  );

  const open = useMutation({
    mutationFn: (vars: {
      contactType: "appointment" | "callback" | "phone_call" | "staff_task" | "abandoned";
      contactId: string;
    }) => openFn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["advisor-contacts"] }),
  });

  const completeTask = useMutation({
    mutationFn: (taskId: string) => completeTaskFn({ data: { taskId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["advisor-contacts"] }),
  });

  const unopenedCount = liveContacts.filter((c) => !c.opened).length;
  const unallocatedCount = allContacts.filter((c) => c.unallocated).length;
  const abandonedCount = abandonedLeads.length;

  const renderContactRow = (c: AdvisorContact) => {
          const overdue = c.kind === "staff_task" && isStaffTaskOverdue(c.dueAt, c.completedAt);
          const markSeen = () => {
            if (!c.opened) {
              if (c.kind === "staff_task") {
                open.mutate({ contactType: "staff_task", contactId: c.id });
              } else if (c.kind === "abandoned") {
                open.mutate({ contactType: "abandoned", contactId: c.id });
              } else if (c.kind !== "phone_call") {
                open.mutate({ contactType: c.kind === "appointment" ? "appointment" : "callback", contactId: c.id });
              } else {
                open.mutate({ contactType: "phone_call", contactId: c.id });
              }
            }
          };
          const archiveType =
            c.kind === "staff_task"
              ? null
              : c.kind === "abandoned"
                ? "abandoned"
                : c.kind === "phone_call"
                  ? "phone_call"
                  : c.kind === "appointment"
                    ? "appointment"
                    : "callback";
          const body = (
            <div
              className={`flex items-center gap-3 p-4 transition ${
                c.contacted
                  ? "opacity-60 bg-muted/30"
                  : overdue
                    ? "bg-red-50 dark:bg-red-950/30 border-l-4 border-red-500"
                    : c.kind === "abandoned"
                      ? "bg-amber-50/60 dark:bg-amber-950/20"
                      : c.opened
                        ? ""
                        : "bg-primary/5"
              }`}
            >
              <span
                className={`inline-flex w-9 h-9 items-center justify-center rounded-full shrink-0 ${
                  c.kind === "staff_task"
                    ? overdue
                      ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100"
                      : "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-100"
                    : c.kind === "abandoned"
                      ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
                      : c.kind === "appointment"
                        ? "bg-accent/30"
                        : "bg-primary/10 text-primary"
                }`}
              >
                {c.kind === "appointment" ? (
                  <CalendarCheck className="w-4 h-4" />
                ) : c.kind === "abandoned" ? (
                  <UserMinus className="w-4 h-4" />
                ) : c.kind === "staff_task" ? (
                  <PhoneCall className="w-4 h-4" />
                ) : (
                  <PhoneCall className="w-4 h-4" />
                )}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="font-medium truncate flex items-center gap-2 flex-wrap">
                  {c.customerName}
                  {!c.opened && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground">
                      New
                    </span>
                  )}
                  {c.kind === "abandoned" && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                      Abandoned
                    </span>
                  )}
                  {c.isVoicemail && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
                      Voicemail
                    </span>
                  )}
                  {c.kind === "phone_call" && !c.isVoicemail && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                      Outbound
                    </span>
                  )}
                  {c.contacted && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                      Contacted
                    </span>
                  )}
                  {c.unallocated && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                      Unallocated
                    </span>
                  )}
                  {overdue && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-red-600 text-white">
                      Overdue
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {c.kind === "abandoned"
                    ? `Incomplete fact-find${c.lastSection ? ` · ${c.lastSection}` : ""}${c.channel ? ` · ${c.channel === "text" ? "Chat" : "Voice"}` : ""} · ${safeFormatDistanceToNow(c.createdAt)}`
                    : c.kind === "staff_task"
                    ? `${STAFF_TASK_LABELS[c.taskType ?? "welcome_call"]} · due ${safeFormat(c.dueAt, "EEE d MMM, HH:mm")}`
                    : c.kind === "appointment"
                    ? c.startsAt
                      ? `Appointment · ${safeFormat(c.startsAt, "EEE d MMM, HH:mm")}`
                      : "Appointment"
                    : c.kind === "phone_call"
                      ? c.isVoicemail
                        ? "Voicemail · call back requested"
                        : `Outbound call · ${safeFormat(c.createdAt, "EEE d MMM, HH:mm")}`
                      : c.isVoicemail
                        ? "Voicemail · call back requested"
                        : `Call back · ${CALLBACK_WINDOW_LABELS[c.window ?? ""] ?? c.window}`}
                  {c.customerPhone && c.customerPhone !== "—" ? ` · ${c.customerPhone}` : ""}
                  {c.kind === "abandoned" && c.customerEmail ? ` · ${c.customerEmail}` : ""}
                </div>
                {(c.advisorName || c.unallocated || c.introducerCode) && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    {c.advisorName ? (
                      <span>
                        Advisor · <span className="font-medium text-foreground">{c.advisorName}</span>
                      </span>
                    ) : c.unallocated ? (
                      <span className="text-amber-800 dark:text-amber-200">Advisor · Unallocated</span>
                    ) : null}
                    {c.introducerCode && (
                      <span>
                        Introducer ·{" "}
                        <span className="font-medium text-foreground">
                          {c.introducerCompany ?? "Company"}
                        </span>{" "}
                        <span className="font-mono">({c.introducerCode})</span>
                      </span>
                    )}
                  </div>
                )}
                {c.summary && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{c.summary}</p>
                )}
              </div>
              <div className="flex flex-col gap-1 shrink-0 items-end">
                {c.unallocated && c.kind === "callback" && (
                  <AssignVoicemailAdvisor
                    callbackId={c.id}
                    onAssigned={() => qc.invalidateQueries({ queryKey: ["advisor-contacts"] })}
                  />
                )}
                {c.kind === "staff_task" && (
                  <Button
                    type="button"
                    size="sm"
                    variant={overdue ? "destructive" : "secondary"}
                    disabled={completeTask.isPending}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      completeTask.mutate(c.id);
                    }}
                  >
                    Mark done
                  </Button>
                )}
                {(c.kind === "callback" ||
                  c.kind === "phone_call" ||
                  c.kind === "appointment" ||
                  c.kind === "abandoned") &&
                  archiveType && (
                  <MarkContactedButton
                    contactType={archiveType}
                    contactId={c.id}
                    sessionId={c.sessionId}
                    contacted={c.contacted}
                    onDone={() => qc.invalidateQueries({ queryKey: ["advisor-contacts"] })}
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
            <div
              key={`${c.kind}-${c.id}`}
              role="button"
              tabIndex={0}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("button")) return;
                markSeen();
                navigate({ to: "/sessions/$sessionId", params: { sessionId: c.sessionId! } });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  markSeen();
                  navigate({ to: "/sessions/$sessionId", params: { sessionId: c.sessionId! } });
                }
              }}
              className="block hover:bg-muted/40 cursor-pointer"
            >
              {body}
            </div>
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
  };

  return (
    <div className="mt-2 space-y-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Inbox className="w-4 h-4" />
          Contacts &amp; tasks
        </h3>
        {unopenedCount > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
            {unopenedCount} new
          </span>
        )}
        {abandonedCount > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200 font-medium">
            {abandonedCount} abandoned
          </span>
        )}
        {unallocatedCount > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200 font-medium">
            {unallocatedCount} unallocated
          </span>
        )}
        {canFilterByAdvisor && (
          <div className="flex items-center gap-2 ml-auto">
            <Label htmlFor="contacts-advisor-filter" className="text-xs text-muted-foreground shrink-0">
              Advisor
            </Label>
            <select
              id="contacts-advisor-filter"
              className="h-8 rounded-md border bg-background px-2 text-sm max-w-[220px]"
              value={advisorFilter}
              onChange={(e) => setAdvisorFilter(e.target.value)}
            >
              <option value="all">All advisors</option>
              <option value="unallocated">Unallocated only</option>
              {advisorOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {abandonedCount > 0 && (
        <div className="rounded-2xl border bg-card divide-y overflow-hidden">
          <div className="p-4 text-xs text-muted-foreground flex items-center gap-2">
            <UserMinus className="w-3.5 h-3.5 shrink-0" />
            Abandoned leads — started a fact-find but didn&apos;t finish, and left an email and/or phone
            so you can follow up.
          </div>
          {abandonedLeads.map(renderContactRow)}
        </div>
      )}

      <div className="rounded-2xl border bg-card divide-y overflow-hidden">
        <div className="p-4 text-xs text-muted-foreground">
          Contact tasks (welcome call, next contact), booked appointments, call-backs, and office-line
          voicemails — sorted by due date. Overdue tasks show in red. Unallocated inbound call-backs /
          voicemails can be allocated to an advisor.
          {canFilterByAdvisor ? " Filter by advisor above." : ""}
        </div>
        {contactsQ.isLoading && <div className="p-4 text-sm text-muted-foreground">Loading contacts…</div>}
        {!contactsQ.isLoading && liveContacts.length === 0 && abandonedCount === 0 && (
          <div className="p-4 text-sm text-muted-foreground">
            {advisorFilter !== "all"
              ? "No contacts for this advisor filter."
              : "No appointments or call-backs yet."}
          </div>
        )}
        {!contactsQ.isLoading && liveContacts.length === 0 && abandonedCount > 0 && (
          <div className="p-4 text-sm text-muted-foreground">No open tasks or bookings right now.</div>
        )}
        {liveContacts.map(renderContactRow)}
      </div>
      <PhoneCallDetailDialog
        callId={voicemailCallId}
        open={Boolean(voicemailCallId)}
        onOpenChange={(open) => !open && setVoicemailCallId(null)}
      />
    </div>
  );
}
