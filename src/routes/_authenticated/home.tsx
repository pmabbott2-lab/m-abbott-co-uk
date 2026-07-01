import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { listMySessions, createSession, getMyRole, listAllSessionsForAdvisor, deleteSession, listUsersWithRoles, setAdvisorRole, setIntroducerRole, listAdvisors, listAdvisorCustomers, allocateSession, unallocateSession, bulkAllocateSessions, softDeleteAdvisor, restoreAdvisor, softDeleteIntroducer, restoreIntroducer, listBinnedStaff, createStaffInvite, listStaffInvites, revokeStaffInvite } from "@/lib/sessions.functions";
import type { AdvisorCustomerRow } from "@/lib/sessions.functions";
import { listAdvisorContacts, markContactOpened } from "@/lib/booking.functions";
import type { AdvisorContact } from "@/lib/booking.functions";
import { checkIsIntroducer } from "@/lib/introducer.functions";
import { claimReferral, createReferralLink, textReferralLink, textRafInviteToFriend, getPublicShareBaseUrl, listReferralLinks, listAllReferrals, updateReferralBonusStatus, searchCustomers } from "@/lib/referrals.functions";
import { getRafCode, clearRafCookie, rafLinkForCode, rafShareMessage } from "@/lib/referral";
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
import { Mic, MessageSquare, FileText, ArrowRight, Trash2, RotateCcw, ShieldCheck, ShieldOff, CalendarCheck, CalendarDays, Link2, UserPlus, UserMinus, Users, UserCog, Search, Hash, KeyRound, Copy, Check, Clock, Mail, Gift, Send, Phone, Briefcase, ChevronRight, PhoneCall, Inbox } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/home")({
  component: Home,
});

function DeleteButton({ sessionId, onDeleted }: { sessionId: string; onDeleted: () => void }) {
  const deleteFn = useServerFn(deleteSession);
  const del = useMutation({
    mutationFn: () => deleteFn({ data: { sessionId } }),
    onSuccess: () => onDeleted(),
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive"
          onClick={(e) => e.stopPropagation()}
          aria-label="Delete fact-find"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this fact-find?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the session, all answers, messages and notes. This cannot be undone.
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
  const q = search.trim().toLowerCase();
  const filteredUsers = users.filter((u) => {
    if (!q) return true;
    return [u.full_name, u.email].filter(Boolean).join(" ").toLowerCase().includes(q);
  });

  return (
    <div className="mt-10">
      <h3 className="text-sm font-medium text-muted-foreground mb-3">Team access</h3>
      <div className="rounded-2xl border bg-card overflow-hidden">
        <div className="p-4 text-xs text-muted-foreground border-b">
          Advisors can view every customer&apos;s fact-find. Grant access to colleagues below.
        </div>
        <div className="p-3 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search people by name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <div className="max-h-[640px] overflow-y-auto divide-y">
        {usersQ.isLoading && <div className="p-4 text-sm text-muted-foreground">Loading people…</div>}
        {usersQ.isError && (
          <div className="p-4 text-sm text-muted-foreground">Couldn&apos;t load the people list.</div>
        )}
        {!usersQ.isLoading && users.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">No accounts yet.</div>
        )}
        {!usersQ.isLoading && users.length > 0 && filteredUsers.length === 0 && (
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
            ) : (
              <Button
                size="sm"
                disabled={setRole.isPending && setRole.variables?.userId === u.id}
                onClick={() => setRole.mutate({ userId: u.id, makeAdvisor: true })}
              >
                <ShieldCheck className="w-4 h-4 mr-1.5" />
                Make advisor
              </Button>
            )}
          </div>
        ))}
        </div>
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
  const q = search.trim().toLowerCase();
  const filteredUsers = users.filter((u) => {
    if (!q) return true;
    return [u.full_name, u.email].filter(Boolean).join(" ").toLowerCase().includes(q);
  });

  return (
    <div className="mt-10">
      <h3 className="text-sm font-medium text-muted-foreground mb-3">Introducer access</h3>
      <div className="rounded-2xl border bg-card overflow-hidden">
        <div className="p-4 text-xs text-muted-foreground border-b">
          Introducers get a referral portal with shareable links and lead tracking. Multiple
          introducers can share a company via its 4-digit code so referrals credit the company.
        </div>
        <div className="p-3 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search people by name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <div className="max-h-[640px] overflow-y-auto divide-y">
        {usersQ.isLoading && <div className="p-4 text-sm text-muted-foreground">Loading people…</div>}
        {usersQ.isError && (
          <div className="p-4 text-sm text-muted-foreground">Couldn&apos;t load the people list.</div>
        )}
        {!usersQ.isLoading && users.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">No accounts yet.</div>
        )}
        {!usersQ.isLoading && users.length > 0 && filteredUsers.length === 0 && (
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
        </div>
      </div>
    </div>
  );
}

// "Recently deleted" bin: lists soft-deleted advisors & introducers with a
// Restore action that re-grants the role and clears the bin state.
function RecentlyDeletedCard() {
  const qc = useQueryClient();
  const binnedFn = useServerFn(listBinnedStaff);
  const restoreAdvisorFn = useServerFn(restoreAdvisor);
  const restoreIntroducerFn = useServerFn(restoreIntroducer);

  const binnedQ = useQuery({ queryKey: ["binned-staff"], queryFn: () => binnedFn() });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["binned-staff"] });
    qc.invalidateQueries({ queryKey: ["users-with-roles"] });
    qc.invalidateQueries({ queryKey: ["is-introducer"] });
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

  const advisors = binnedQ.data?.advisors ?? [];
  const introducers = binnedQ.data?.introducers ?? [];
  const isEmpty = advisors.length === 0 && introducers.length === 0;

  return (
    <div className="mt-10">
      <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
        <Trash2 className="w-4 h-4" />
        Recently deleted
      </h3>
      <div className="rounded-2xl border bg-card divide-y">
        <div className="p-4 text-xs text-muted-foreground">
          Binned advisors and introducers are kept here and can be restored any time. Restoring
          re-grants their role (advisors keep their original code; introducers keep their company).
          Accounts and customer data are never deleted.
        </div>
        {binnedQ.isLoading && <div className="p-4 text-sm text-muted-foreground">Loading bin…</div>}
        {!binnedQ.isLoading && isEmpty && (
          <div className="p-4 text-sm text-muted-foreground">Nothing in the bin.</div>
        )}
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

function ReferAFriendCard() {
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
    <div className="mt-2">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Gift className="w-4 h-4" />
          Referral links
        </h3>
        <CreateReferralLinkDialog
          onCreated={() => qc.invalidateQueries({ queryKey: ["referral-links"] })}
        />
      </div>

      <div className="rounded-2xl border bg-card divide-y">
        <div className="p-4 text-xs text-muted-foreground">
          Each link is tied to a referrer who shares it with friends. Friends self-serve from the
          landing page; their referral is credited to the referrer below.
        </div>
        {linksQ.isLoading && <div className="p-4 text-sm text-muted-foreground">Loading links…</div>}
        {!linksQ.isLoading && links.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">
            No referral links yet — create one above.
          </div>
        )}
        {links.map((l) => (
          <div key={l.id} className="flex items-center gap-3 p-4">
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{l.referrer_name || "Referrer"}</div>
              <div className="text-xs text-muted-foreground truncate flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1 font-mono text-foreground">
                  <Hash className="w-3 h-3" />
                  {l.code}
                </span>
                {l.referrer_phone && (
                  <span className="inline-flex items-center gap-1">
                    <Phone className="w-3 h-3" />
                    {l.referrer_phone}
                  </span>
                )}
                <span>· {l.referralCount} referral{l.referralCount === 1 ? "" : "s"}</span>
              </div>
            </div>
            <CopyLinkButton
              value={rafShareMessage(l.referrer_name, l.code, shareBase)}
              label="Copy message"
              successToast="Share message copied"
            />
            <CopyLinkButton value={rafLinkForCode(l.code, shareBase)} label="Link only" />
            <Button
              variant="outline"
              size="sm"
              disabled={!l.referrer_phone || (text.isPending && text.variables?.id === l.id)}
              title={l.referrer_phone ? "Texts the referrer so they can forward the link" : "No phone on file for this referrer"}
              onClick={() => text.mutate({ id: l.id })}
            >
              <Send className="w-4 h-4 mr-1.5" />
              Text referrer
            </Button>
          </div>
        ))}
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
          <div key={r.id} className="flex items-center gap-3 p-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">
                {r.referredName}
                <span className="text-muted-foreground font-normal"> ← {r.referrerName}</span>
              </div>
              <div className="text-xs text-muted-foreground truncate flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1 font-mono">
                  <Hash className="w-3 h-3" />
                  {r.code}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-muted">
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
                <span>· {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</span>
              </div>
            </div>
            <span
              className={`text-xs px-2 py-1 rounded-full shrink-0 ${r.bonus_status === "paid" ? "bg-accent/30" : r.bonus_status === "eligible" ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400" : "bg-muted"}`}
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
              <option value="eligible">Eligible</option>
              <option value="paid">Paid</option>
            </select>
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

function AdvisorCustomerRowView({ row }: { row: AdvisorCustomerRow }) {
  const c = row.customer;
  const contact = [c?.email, c?.phone].filter(Boolean).join(" · ");
  return (
    <Link
      to="/sessions/$sessionId"
      params={{ sessionId: row.sessionId }}
      className="flex items-center gap-3 p-4 hover:bg-muted/40 transition"
    >
      <div className="min-w-0 flex-1">
        <div className="font-medium truncate">
          {c?.full_name || c?.email || "Unnamed customer"}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {contact || "No contact details on file"}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1">
            {row.channel === "text" ? (
              <MessageSquare className="w-3 h-3" />
            ) : (
              <Mic className="w-3 h-3" />
            )}
            {row.channel === "text" ? "Chat" : "Voice"}
          </span>
          <span>· {row.status === "submitted" ? "Submitted" : "In progress"}</span>
          <span>· {formatDistanceToNow(new Date(row.startedAt), { addSuffix: true })}</span>
          {row.source === "appointment" && (
            <span className="inline-flex items-center gap-1 text-accent-foreground">
              <CalendarCheck className="w-3 h-3" />
              Appointment
            </span>
          )}
        </div>
      </div>
      <span
        className={`text-xs px-2 py-1 rounded-full shrink-0 ${row.status === "submitted" ? "bg-accent/30" : "bg-muted"}`}
      >
        {row.status === "submitted" ? "Ready to review" : "In progress"}
      </span>
      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
    </Link>
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
              <div className="rounded-2xl border bg-card divide-y overflow-hidden">
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

  const contactsQ = useQuery({ queryKey: ["advisor-contacts"], queryFn: () => contactsFn() });
  const contacts = (contactsQ.data ?? []) as AdvisorContact[];

  const open = useMutation({
    mutationFn: (vars: { contactType: "appointment" | "callback"; contactId: string }) =>
      openFn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["advisor-contacts"] }),
  });

  const unopenedCount = contacts.filter((c) => !c.opened).length;

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Inbox className="w-4 h-4" />
          Appointments &amp; call-backs
        </h3>
        {unopenedCount > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
            {unopenedCount} new
          </span>
        )}
      </div>
      <div className="rounded-2xl border bg-card divide-y overflow-hidden">
        <div className="p-4 text-xs text-muted-foreground">
          Your booked appointments and customer call-back requests. New items you haven&apos;t opened
          are highlighted — opening one marks it as seen.
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
                <div className="font-medium truncate flex items-center gap-2">
                  {c.customerName}
                  {!c.opened && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground">
                      New
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {c.kind === "appointment"
                    ? c.startsAt
                      ? `Appointment · ${format(new Date(c.startsAt), "EEE d MMM, HH:mm")}`
                      : "Appointment"
                    : `Call back · ${CALLBACK_WINDOW_LABELS[c.window ?? ""] ?? c.window}`}
                  {c.customerPhone ? ` · ${c.customerPhone}` : ""}
                </div>
              </div>
              {c.sessionId && <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
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
    </div>
  );
}

function Home() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const roleFn = useServerFn(getMyRole);
  const sessionsFn = useServerFn(listMySessions);
  const allFn = useServerFn(listAllSessionsForAdvisor);
  const createFn = useServerFn(createSession);

  const introducerFn = useServerFn(checkIsIntroducer);
  const markOpenedFn = useServerFn(markContactOpened);

  const roleQ = useQuery({ queryKey: ["my-role"], queryFn: () => roleFn() });
  const isAdvisor = roleQ.data?.isAdvisor ?? false;
  const isMainAdmin = roleQ.data?.isMainAdmin ?? false;

  const introducerQ = useQuery({ queryKey: ["is-introducer"], queryFn: () => introducerFn() });
  const isIntroducer = introducerQ.data?.isIntroducer ?? false;
  const advisorCode = roleQ.data?.advisorCode ?? null;

  const [unallocatedOnly, setUnallocatedOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "next_contact">("recent");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const sessionsQ = useQuery({
    queryKey: ["my-sessions"],
    queryFn: () => sessionsFn(),
    enabled: !roleQ.isLoading && !isAdvisor,
  });

  const allQ = useQuery({
    queryKey: ["all-sessions"],
    queryFn: () => allFn(),
    enabled: !roleQ.isLoading && isAdvisor,
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

  if (isAdvisor) {
    const q = search.trim().toLowerCase();
    const sessions = (allQ.data ?? [])
      .filter((s) => {
        if (unallocatedOnly && ((s as { assignedAdvisors?: AssignedAdvisor[] }).assignedAdvisors ?? []).length !== 0) {
          return false;
        }
        if (!q) return true;
        const c = (s as { customer?: { full_name?: string | null; email?: string | null; phone?: string | null } | null }).customer;
        const haystack = [c?.full_name, c?.email, c?.phone].filter(Boolean).join(" ").toLowerCase();
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

    const tabCount = 2 + (isIntroducer ? 1 : 0) + (isMainAdmin ? 3 : 0);

    return (
      <AppShell title="Advisor dashboard">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-2xl font-semibold">
              {isMainAdmin ? "Admin dashboard" : "Your customers"}
            </h2>
            {advisorCode && (
              <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-sm">
                <KeyRound className="w-3.5 h-3.5 text-muted-foreground" />
                Your code: <span className="font-mono font-medium">{advisorCode}</span>
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => create.mutate("voice")} disabled={create.isPending}>
              <Mic className="w-4 h-4 mr-2" />
              {create.isPending && create.variables === "voice" ? "Starting…" : "Spoken"}
            </Button>
            <Button variant="outline" onClick={() => create.mutate("chat")} disabled={create.isPending}>
              <MessageSquare className="w-4 h-4 mr-2" />
              {create.isPending && create.variables === "chat" ? "Starting…" : "Type"}
            </Button>
            <Link to="/booking">
              <Button variant="outline">
                <CalendarCheck className="w-4 h-4 mr-2" />
                Book
              </Button>
            </Link>
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
            <TabsList className="mb-4 flex h-auto w-full flex-wrap justify-start gap-1">
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
              {isIntroducer && (
                <TabsTrigger value="introducer">
                  <Link2 className="w-4 h-4 mr-1.5" />
                  Introducer
                </TabsTrigger>
              )}
              {isMainAdmin && (
                <TabsTrigger value="raf">
                  <Gift className="w-4 h-4 mr-1.5" />
                  Refer a friend
                </TabsTrigger>
              )}
              {isMainAdmin && (
                <TabsTrigger value="manage">
                  <ShieldCheck className="w-4 h-4 mr-1.5" />
                  Manage
                </TabsTrigger>
              )}
            </TabsList>
          )}

          <TabsContent value="customers">
            {isMainAdmin && (
              <div className="space-y-3 mb-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-sm text-muted-foreground">
                    All fact-finds across the team. Assign advisors so they appear on each advisor&apos;s
                    dashboard.
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
            <div className="rounded-2xl border bg-card divide-y">
              {sessions.length === 0 && (
                <div className="p-6 text-muted-foreground text-sm">
                  {search.trim()
                    ? "No customers match your search."
                    : unallocatedOnly
                      ? "No unallocated fact-finds."
                      : "No fact-finds yet."}
                </div>
              )}
              {sessions.map((s) => {
                const assigned = ((s as { assignedAdvisors?: AssignedAdvisor[] }).assignedAdvisors ?? []);
                const phone = (s as { customer?: { phone?: string | null } | null }).customer?.phone;
                const nextContactAt = (s as { nextContactAt?: string | null }).nextContactAt;
                const callback = (s as { callback?: { id: string; window: string | null } | null }).callback ?? null;
                return (
                  <div
                    key={s.id}
                    className={`flex items-center gap-2 p-4 transition ${callback ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/40"}`}
                  >
                    {isMainAdmin && (
                      <Checkbox
                        className="shrink-0"
                        checked={selectedIds.includes(s.id)}
                        onCheckedChange={(v) => toggleSelected(s.id, v === true)}
                        aria-label="Select customer"
                      />
                    )}
                    <Link
                      to="/sessions/$sessionId"
                      params={{ sessionId: s.id }}
                      onClick={() => {
                        if (callback) markCallbackOpened.mutate({ contactId: callback.id });
                      }}
                      className="flex-1 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="font-medium truncate flex items-center gap-2">
                          {s.customer?.full_name || s.customer?.email || "Unnamed customer"}
                          {callback && (
                            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground shrink-0">
                              New
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {s.status === "submitted" ? "Submitted" : "In progress"} ·{" "}
                          {formatDistanceToNow(new Date(s.started_at), { addSuffix: true })}
                          {phone ? ` · ${phone}` : ""}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {assigned.length > 0 ? (
                            <span>Advisors: {assigned.map(advisorLabel).join(", ")}</span>
                          ) : (
                            <span className="text-amber-600 dark:text-amber-500">Unallocated</span>
                          )}
                        </div>
                        {callback && (
                          <div className="text-xs mt-0.5 inline-flex items-center gap-1.5 text-primary font-medium">
                            <PhoneCall className="w-3 h-3" />
                            Call-back requested
                            <span className="font-normal">
                              · {CALLBACK_WINDOW_LABELS[callback.window ?? ""] ?? callback.window}
                            </span>
                          </div>
                        )}
                        {nextContactAt && (
                          <div className="text-xs mt-0.5 inline-flex items-center gap-1 text-primary">
                            <Clock className="w-3 h-3" />
                            Next contact: {format(new Date(nextContactAt), "EEE d MMM, HH:mm")}
                          </div>
                        )}
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full shrink-0 ${s.status === "submitted" ? "bg-accent/30" : "bg-muted"}`}>
                        {s.status === "submitted" ? "Ready to review" : "In progress"}
                      </span>
                    </Link>
                    {isMainAdmin && (
                      <AllocateDialog sessionId={s.id} assigned={assigned} onChanged={invalidateSessions} />
                    )}
                    <DeleteButton sessionId={s.id} onDeleted={invalidateSessions} />
                  </div>
                );
              })}
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

          {isMainAdmin && (
            <TabsContent value="raf">
              <ReferAFriendCard />
            </TabsContent>
          )}

          {isMainAdmin && (
            <TabsContent value="manage">
              <InviteStaffCard />
              <AdvisorAccessCard />
              <IntroducerAccessCard />
              <RecentlyDeletedCard />
            </TabsContent>
          )}
        </Tabs>
      </AppShell>
    );
  }

  const sessions = sessionsQ.data ?? [];
  const inProgress = sessions.find((s) => s.status === "in_progress");
  const hasSubmitted = sessions.some((s) => s.status === "submitted");

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
        <div className="grid sm:grid-cols-3 gap-3 mt-5">
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
                  Skip the fact-find for now and pick a time to speak with your advisor.
                </div>
              </div>
            </div>
          </Link>
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
      <h3 className="text-sm font-medium text-muted-foreground mb-3">Previous sessions</h3>
      <div className="rounded-2xl border bg-card divide-y">
        {sessions.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
            <FileText className="w-4 h-4" /> No sessions yet — start your first interview above.
          </div>
        )}
        {sessions.map((s) => (
          <div key={s.id} className="flex items-center gap-2 p-4 hover:bg-muted/40 transition">
            <Link
              to={s.status === "in_progress" ? "/interview/$sessionId" : "/sessions/$sessionId"}
              params={{ sessionId: s.id }}
              className="flex-1 flex items-center justify-between"
            >
              <div>
                <div className="font-medium">
                  {s.status === "submitted" ? "Submitted fact-find" : "In progress"}
                </div>
                <div className="text-xs text-muted-foreground">
                  Started {formatDistanceToNow(new Date(s.started_at), { addSuffix: true })}
                </div>
              </div>
              <span className="text-xs text-muted-foreground mr-2 flex items-center gap-1">
                {s.status === "in_progress" ? (
                  <>
                    <RotateCcw className="w-3 h-3" /> Resume
                  </>
                ) : (
                  <>
                    View <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </span>
            </Link>
            <DeleteButton sessionId={s.id} onDeleted={() => qc.invalidateQueries({ queryKey: ["my-sessions"] })} />
          </div>
        ))}
      </div>
    </AppShell>
  );
}
