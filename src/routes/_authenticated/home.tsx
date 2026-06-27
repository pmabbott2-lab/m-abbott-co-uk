import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMySessions, createSession, getMyRole, listAllSessionsForAdvisor, deleteSession, listUsersWithRoles, setAdvisorRole } from "@/lib/sessions.functions";
import { checkIsIntroducer } from "@/lib/introducer.functions";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
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
import { Mic, MessageSquare, FileText, ArrowRight, Trash2, RotateCcw, ShieldCheck, ShieldOff, CalendarCheck, CalendarDays, Link2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
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

function AdvisorAccessCard() {
  const qc = useQueryClient();
  const usersFn = useServerFn(listUsersWithRoles);
  const setRoleFn = useServerFn(setAdvisorRole);

  const usersQ = useQuery({ queryKey: ["users-with-roles"], queryFn: () => usersFn() });

  const setRole = useMutation({
    mutationFn: (vars: { userId: string; makeAdvisor: boolean }) => setRoleFn({ data: vars }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users-with-roles"] });
      toast.success("Access updated");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not update access"),
  });

  const users = usersQ.data ?? [];

  return (
    <div className="mt-10">
      <h3 className="text-sm font-medium text-muted-foreground mb-3">Team access</h3>
      <div className="rounded-2xl border bg-card divide-y">
        <div className="p-4 text-xs text-muted-foreground">
          Advisors can view every customer&apos;s fact-find. Grant access to colleagues below.
        </div>
        {usersQ.isLoading && <div className="p-4 text-sm text-muted-foreground">Loading people…</div>}
        {usersQ.isError && (
          <div className="p-4 text-sm text-muted-foreground">Couldn&apos;t load the people list.</div>
        )}
        {!usersQ.isLoading && users.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">No accounts yet.</div>
        )}
        {users.map((u) => (
          <div key={u.id} className="flex items-center gap-3 p-4">
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{u.full_name || u.email || "Unnamed user"}</div>
              <div className="text-xs text-muted-foreground truncate">
                {u.email}
                {u.isAdvisor && <span className="ml-2 text-accent-foreground">· Advisor</span>}
                {u.isSelf && <span className="ml-2">· You</span>}
              </div>
            </div>
            {u.isAdvisor ? (
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

  const roleQ = useQuery({ queryKey: ["my-role"], queryFn: () => roleFn() });
  const isAdvisor = roleQ.data?.isAdvisor ?? false;

  const introducerQ = useQuery({ queryKey: ["is-introducer"], queryFn: () => introducerFn() });
  const isIntroducer = introducerQ.data?.isIntroducer ?? false;

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
    const sessions = allQ.data ?? [];
    return (
      <AppShell title="Advisor dashboard">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <h2 className="text-2xl font-semibold">Customer fact-finds</h2>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => create.mutate("voice")} disabled={create.isPending}>
              <Mic className="w-4 h-4 mr-2" />
              {create.isPending && create.variables === "voice" ? "Starting…" : "Spoken"}
            </Button>
            <Button variant="outline" onClick={() => create.mutate("chat")} disabled={create.isPending}>
              <MessageSquare className="w-4 h-4 mr-2" />
              {create.isPending && create.variables === "chat" ? "Starting…" : "Type"}
            </Button>
            <Link to="/diary">
              <Button variant="secondary">
                <CalendarDays className="w-4 h-4 mr-2" />
                Diary
              </Button>
            </Link>
            {isIntroducer && (
              <Link to="/introducer">
                <Button variant="secondary">
                  <Link2 className="w-4 h-4 mr-2" />
                  Introducer portal
                </Button>
              </Link>
            )}
          </div>
        </div>
        <div className="rounded-2xl border bg-card divide-y">
          {sessions.length === 0 && <div className="p-6 text-muted-foreground text-sm">No fact-finds yet.</div>}
          {sessions.map((s) => (
            <div key={s.id} className="flex items-center gap-2 p-4 hover:bg-muted/40 transition">
              <Link
                to="/sessions/$sessionId"
                params={{ sessionId: s.id }}
                className="flex-1 flex items-center justify-between"
              >
                <div>
                  <div className="font-medium">{s.customer?.full_name || s.customer?.email || "Unnamed customer"}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.status === "submitted" ? "Submitted" : "In progress"} ·{" "}
                    {formatDistanceToNow(new Date(s.started_at), { addSuffix: true })}
                  </div>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full mr-2 ${s.status === "submitted" ? "bg-accent/30" : "bg-muted"}`}>
                  {s.status === "submitted" ? "Ready to review" : "In progress"}
                </span>
              </Link>
              <DeleteButton sessionId={s.id} onDeleted={() => qc.invalidateQueries({ queryKey: ["all-sessions"] })} />
            </div>
          ))}
        </div>
        <AdvisorAccessCard />
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
