import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMySessions, createSession, getMyRole, listAllSessionsForAdvisor, deleteSession } from "@/lib/sessions.functions";
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
import { Mic, FileText, ArrowRight, Trash2, MessageSquare, CalendarCheck, CalendarDays } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

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

function Home() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const roleFn = useServerFn(getMyRole);
  const sessionsFn = useServerFn(listMySessions);
  const allFn = useServerFn(listAllSessionsForAdvisor);
  const createFn = useServerFn(createSession);

  const roleQ = useQuery({ queryKey: ["my-role"], queryFn: () => roleFn() });
  const isAdvisor = roleQ.data?.isAdvisor ?? false;

  const sessionsQ = useQuery({
    queryKey: ["my-sessions"],
    queryFn: () => sessionsFn(),
    enabled: !roleQ.isLoading,
  });

  const allQ = useQuery({
    queryKey: ["all-sessions"],
    queryFn: () => allFn(),
    enabled: !roleQ.isLoading && isAdvisor,
  });

  const createVoice = useMutation({
    mutationFn: () => createFn({ data: { channel: "voice" } }),
    onSuccess: (s) => navigate({ to: "/interview/$sessionId", params: { sessionId: s.id } }),
  });

  const createText = useMutation({
    mutationFn: () => createFn({ data: { channel: "text" } }),
    onSuccess: (s) => navigate({ to: "/text/$sessionId", params: { sessionId: s.id } }),
  });

  if (roleQ.isLoading) {
    return <AppShell title="Home"><div className="py-16 text-center text-muted-foreground">Loading…</div></AppShell>;
  }

  const sessions = sessionsQ.data ?? [];
  const advisorSessions = allQ.data ?? [];
  const creating = createVoice.isPending || createText.isPending;

  return (
    <AppShell title="Home">
      <div className="rounded-3xl bg-card border p-6 sm:p-8 mb-8">
        <h2 className="text-2xl sm:text-3xl font-semibold mb-2">
          Complete your fact-find or book an appointment
        </h2>
        <p className="text-muted-foreground text-sm sm:text-base max-w-2xl">
          Talk to Susan for a quick mortgage fact-find, type your answers at your own pace, or skip
          straight to booking a call with your advisor — whatever works best for you.
        </p>
      </div>

      <div className="grid sm:grid-cols-3 gap-4 mb-10">
        <button
          type="button"
          onClick={() => createVoice.mutate()}
          disabled={creating}
          className="rounded-2xl border bg-card p-6 text-left hover:border-accent/50 hover:bg-accent/5 transition disabled:opacity-50"
        >
          <Mic className="w-8 h-8 mb-3 text-accent" />
          <h3 className="font-semibold">Verbal interview</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Talk to Susan, your guide. Takes around 5–10 minutes, then you can book an appointment.
          </p>
          <span className="inline-block mt-4 text-sm font-medium text-accent">
            {createVoice.isPending ? "Starting…" : "Start verbal →"}
          </span>
        </button>

        <button
          type="button"
          onClick={() => createText.mutate()}
          disabled={creating}
          className="rounded-2xl border bg-card p-6 text-left hover:border-accent/50 hover:bg-accent/5 transition disabled:opacity-50"
        >
          <MessageSquare className="w-8 h-8 mb-3 text-accent" />
          <h3 className="font-semibold">Text interview</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Type your answers at your own pace — same questions, then book an appointment when done.
          </p>
          <span className="inline-block mt-4 text-sm font-medium text-accent">
            {createText.isPending ? "Starting…" : "Start text →"}
          </span>
        </button>

        <Link
          to="/booking"
          className="rounded-2xl border-2 border-accent/40 bg-accent/5 p-6 text-left hover:border-accent hover:bg-accent/10 transition block"
        >
          <CalendarCheck className="w-8 h-8 mb-3 text-accent" />
          <h3 className="font-semibold">Book an appointment</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Pick a date and time to speak with your advisor — no fact-find required first.
          </p>
          <span className="inline-block mt-4 text-sm font-medium text-accent">Book now →</span>
        </Link>
      </div>

      <h3 className="text-sm font-medium text-muted-foreground mb-3">Your fact-finds</h3>
      <div className="rounded-2xl border bg-card divide-y mb-10">
        {sessions.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
            <FileText className="w-4 h-4" /> No sessions yet — start a verbal or text interview above, or book an appointment.
          </div>
        )}
        {sessions.map((s) => {
          const channel = (s as { channel?: string }).channel ?? "voice";
          const resumeRoute = channel === "text" ? "/text/$sessionId" : "/interview/$sessionId";
          return (
            <div key={s.id} className="flex items-center gap-2 p-4 hover:bg-muted/40 transition">
              <Link
                to={s.status === "in_progress" ? resumeRoute : "/sessions/$sessionId"}
                params={{ sessionId: s.id }}
                className="flex-1 flex items-center justify-between"
              >
                <div>
                  <div className="font-medium">
                    {s.status === "submitted" ? "Submitted fact-find" : "In progress"}
                    <span className="text-xs text-muted-foreground font-normal ml-2">
                      · {channel === "text" ? "Text" : "Verbal"}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Started {formatDistanceToNow(new Date(s.started_at), { addSuffix: true })}
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground mr-2" />
              </Link>
              <DeleteButton sessionId={s.id} onDeleted={() => qc.invalidateQueries({ queryKey: ["my-sessions"] })} />
            </div>
          );
        })}
      </div>

      {isAdvisor && (
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h3 className="text-lg font-semibold">Advisor dashboard</h3>
            <Link to="/diary">
              <Button variant="secondary" size="sm">
                <CalendarDays className="w-4 h-4 mr-2" />
                View diary
              </Button>
            </Link>
          </div>
          <div className="rounded-2xl border bg-card divide-y">
            {advisorSessions.length === 0 && (
              <div className="p-6 text-muted-foreground text-sm">No customer fact-finds yet.</div>
            )}
            {advisorSessions.map((s) => (
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
        </section>
      )}
    </AppShell>
  );
}
