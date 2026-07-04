import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format, formatDistanceToNow } from "date-fns";
import {
  ArrowRight,
  Briefcase,
  FileText,
  Link2,
  Trash2,
  User,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { TabPageNav } from "@/components/TabPageNav";
import { CustomerHubBookingDialog } from "@/components/CustomerHubBookingDialog";
import { Button } from "@/components/ui/button";
import {
  getCustomerHub,
  deleteSession,
  getMyRole,
  promoteSessionToCaseAsStaff,
  type CustomerHubCase,
  type CustomerHubFactFind,
} from "@/lib/sessions.functions";
import { canAmend } from "@/lib/admin-access";
import { referralLinkForSlug } from "@/lib/referral";
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
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/customers/$customerId")({
  component: CustomerHubPage,
});

function CustomerHubPage() {
  const { customerId } = Route.useParams();
  const qc = useQueryClient();
  const hubFn = useServerFn(getCustomerHub);
  const roleFn = useServerFn(getMyRole);

  const roleQ = useQuery({ queryKey: ["my-role"], queryFn: () => roleFn() });
  const hubQ = useQuery({
    queryKey: ["customer-hub", customerId],
    queryFn: () => hubFn({ data: { customerId } }),
  });

  const adminAccess = roleQ.data?.adminAccess ?? null;
  const canDelete =
    roleQ.data?.isOwner ||
    roleQ.data?.isSupervisor ||
    canAmend(adminAccess, "customers");

  if (hubQ.isLoading || roleQ.isLoading) {
    return (
      <AppShell title="Customer">
        <div className="py-16 text-center text-muted-foreground">Loading…</div>
      </AppShell>
    );
  }

  if (hubQ.isError || !hubQ.data) {
    return (
      <AppShell title="Customer">
        <div className="py-16 text-center space-y-3">
          <p className="text-muted-foreground">Could not load this customer.</p>
          <Link to="/home">
            <Button variant="outline">Back to dashboard</Button>
          </Link>
        </div>
      </AppShell>
    );
  }

  const { customer, introducer, factFinds, cases } = hubQ.data;
  const displayName = customer.full_name || customer.email || "Customer";
  const invalidateHub = () => {
    qc.invalidateQueries({ queryKey: ["customer-hub", customerId] });
    qc.invalidateQueries({ queryKey: ["all-sessions"] });
  };

  return (
    <AppShell title={displayName}>
      <div className="max-w-3xl mx-auto space-y-6">
        <TabPageNav backTo="/home" backLabel="Dashboard" />

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold flex items-center gap-2">
              <User className="w-6 h-6 text-muted-foreground" />
              {displayName}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Customer record — contact details and introducer. Book an appointment here to open a
              case (including legacy customers who pre-date the case system).
            </p>
          </div>
          <CustomerHubBookingDialog
            customerId={customerId}
            customerName={displayName}
            customerEmail={customer.email}
            customerPhone={customer.phone}
            factFinds={factFinds}
            triggerVariant="default"
            triggerLabel="Book appointment"
            onBooked={invalidateHub}
          />
        </div>

        <div className="rounded-2xl border bg-card p-5 space-y-4">
          <h3 className="font-semibold">Contact details</h3>
          <dl className="grid sm:grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Name</dt>
              <dd className="font-medium">{customer.full_name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Email</dt>
              <dd className="font-medium break-all">{customer.email ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Mobile</dt>
              <dd className="font-medium">{customer.phone ?? "—"}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-2xl border bg-card p-5 space-y-3">
          <h3 className="font-semibold flex items-center gap-2">
            <Link2 className="w-4 h-4 text-muted-foreground" />
            Introducer
          </h3>
          {introducer ? (
            <dl className="grid sm:grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Company</dt>
                <dd className="font-medium">{introducer.companyName ?? "—"}</dd>
              </div>
              {introducer.companyCode && (
                <div>
                  <dt className="text-xs text-muted-foreground">Reference</dt>
                  <dd className="font-mono font-medium">{introducer.companyCode}</dd>
                </div>
              )}
              {introducer.slug && (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">Referral link</dt>
                  <dd className="text-xs font-mono break-all">{referralLinkForSlug(introducer.slug)}</dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">No introducer linked to this customer yet.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Introducer attribution stays at customer level and applies across all cases for finance reporting.
          </p>
        </div>

        <section className="space-y-3">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Fact-finds
              <span className="text-sm font-normal text-muted-foreground">({factFinds.length})</span>
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              In progress or submitted — not yet linked to an appointment. Becomes a case when an appointment is
              booked.
            </p>
          </div>
          <div className="rounded-2xl border bg-card divide-y">
            {factFinds.length === 0 && (
              <div className="p-5 text-sm text-muted-foreground">No open fact-finds.</div>
            )}
            {factFinds.map((ff) => (
              <FactFindRow
                key={ff.id}
                factFind={ff}
                canDelete={canDelete}
                customerId={customerId}
                customerName={displayName}
                customerEmail={customer.email}
                customerPhone={customer.phone}
                allFactFinds={factFinds}
                onChanged={invalidateHub}
              />
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <Briefcase className="w-4 h-4" />
              Cases
              <span className="text-sm font-normal text-muted-foreground">({cases.length})</span>
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Opened when an appointment is booked — journey, finance, CRM and fact-find data live here.
            </p>
          </div>
          <div className="rounded-2xl border bg-card divide-y">
            {cases.length === 0 && (
              <div className="p-5 text-sm text-muted-foreground">
                No cases yet — use Book appointment above to open one.
              </div>
            )}
            {cases.map((c) => (
              <CaseRow key={c.id} caseItem={c} canDelete={canDelete} customerId={customerId} />
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function FactFindRow({
  factFind,
  canDelete,
  customerId,
  customerName,
  customerEmail,
  customerPhone,
  allFactFinds,
  onChanged,
}: {
  factFind: CustomerHubFactFind;
  canDelete: boolean;
  customerId: string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  allFactFinds: CustomerHubFactFind[];
  onChanged: () => void;
}) {
  const deleteFn = useServerFn(deleteSession);
  const promoteFn = useServerFn(promoteSessionToCaseAsStaff);
  const del = useMutation({
    mutationFn: () => deleteFn({ data: { sessionId: factFind.id } }),
    onSuccess: () => {
      toast.success("Fact-find removed");
      onChanged();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not delete"),
  });
  const promote = useMutation({
    mutationFn: () => promoteFn({ data: { sessionId: factFind.id, customerId } }),
    onSuccess: (result) => {
      toast.success(`Case created — ${result.caseRef}`);
      onChanged();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not create case"),
  });

  return (
    <div className="flex items-center gap-2 p-4 hover:bg-muted/30 transition flex-wrap sm:flex-nowrap">
      <Link
        to="/sessions/$sessionId"
        params={{ sessionId: factFind.id }}
        className="flex-1 min-w-0"
      >
        <div className="font-medium">
          {factFind.status === "submitted" ? "Submitted fact-find" : "Fact-find in progress"}
          {factFind.hasAppointment && (
            <span className="ml-2 text-xs font-normal text-amber-600 dark:text-amber-500">
              · Appointment on file — create case
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          Started {formatDistanceToNow(new Date(factFind.startedAt), { addSuffix: true })}
          {factFind.channel ? ` · ${factFind.channel === "text" ? "Chat" : "Voice"}` : ""}
        </div>
        {factFind.assignedAdvisors.length > 0 && (
          <div className="text-xs text-muted-foreground mt-0.5">
            Advisors: {factFind.assignedAdvisors.map((a) => a.full_name || a.email).join(", ")}
          </div>
        )}
      </Link>
      <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
        {factFind.hasAppointment ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={promote.isPending}
            onClick={() => promote.mutate()}
          >
            {promote.isPending ? "Creating…" : "Create case"}
          </Button>
        ) : (
          <CustomerHubBookingDialog
            customerId={customerId}
            customerName={customerName}
            customerEmail={customerEmail}
            customerPhone={customerPhone}
            factFinds={allFactFinds}
            sessionId={factFind.id}
            triggerLabel="Book"
            triggerVariant="outline"
            onBooked={onChanged}
          />
        )}
        <Link to="/sessions/$sessionId" params={{ sessionId: factFind.id }}>
          <Button variant="ghost" size="sm">
            Review <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        </Link>
        {canDelete && (
          <DeleteRecordButton
            title="Remove this fact-find?"
            description="The fact-find moves to Recently deleted. It has not become a case yet."
            pending={del.isPending}
            onConfirm={() => del.mutate()}
          />
        )}
      </div>
    </div>
  );
}

function CaseRow({
  caseItem,
  canDelete,
  customerId,
}: {
  caseItem: CustomerHubCase;
  canDelete: boolean;
  customerId: string;
}) {
  const qc = useQueryClient();
  const deleteFn = useServerFn(deleteSession);
  const del = useMutation({
    mutationFn: () => deleteFn({ data: { sessionId: caseItem.id } }),
    onSuccess: () => {
      toast.success("Case removed");
      qc.invalidateQueries({ queryKey: ["customer-hub", customerId] });
      qc.invalidateQueries({ queryKey: ["all-sessions"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not delete"),
  });

  return (
    <div className="flex items-center gap-2 p-4 hover:bg-muted/30 transition">
      <Link to="/sessions/$sessionId" params={{ sessionId: caseItem.id }} className="flex-1 min-w-0">
        <div className="font-medium font-mono">{caseItem.caseRef}</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {caseItem.status === "submitted" ? "Submitted" : "In progress"}
          {caseItem.appointmentAt
            ? ` · Appt ${format(new Date(caseItem.appointmentAt), "d MMM yyyy")}`
            : ""}
        </div>
      </Link>
      <Link to="/sessions/$sessionId" params={{ sessionId: caseItem.id }}>
        <Button variant="ghost" size="sm">
          Open case <ArrowRight className="w-4 h-4 ml-1" />
        </Button>
      </Link>
      {canDelete && (
        <DeleteRecordButton
          title="Delete this case?"
          description="The case moves to Recently deleted. Journey, finance and fact-find data are kept for restore."
          pending={del.isPending}
          onConfirm={() => del.mutate()}
        />
      )}
    </div>
  );
}

function DeleteRecordButton({
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
          className="text-muted-foreground hover:text-destructive shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={(e) => { e.preventDefault(); onConfirm(); }}>
            {pending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
