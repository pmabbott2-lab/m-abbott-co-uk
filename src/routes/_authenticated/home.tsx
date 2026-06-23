import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMySessions, createSession, getMyRole, listAllSessionsForAdvisor } from "@/lib/sessions.functions";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Mic, FileText, ArrowRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/home")({
  component: Home,
});

function Home() {
  const navigate = useNavigate();
  const roleFn = useServerFn(getMyRole);
  const sessionsFn = useServerFn(listMySessions);
  const allFn = useServerFn(listAllSessionsForAdvisor);
  const createFn = useServerFn(createSession);

  const roleQ = useQuery({ queryKey: ["my-role"], queryFn: () => roleFn() });
  const isAdvisor = roleQ.data?.isAdvisor ?? false;

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
    mutationFn: () => createFn(),
    onSuccess: (s) => navigate({ to: "/interview/$sessionId", params: { sessionId: s.id } }),
  });

  if (roleQ.isLoading) {
    return <AppShell title="Home"><div className="py-16 text-center text-muted-foreground">Loading…</div></AppShell>;
  }

  if (isAdvisor) {
    const sessions = allQ.data ?? [];
    return (
      <AppShell title="Advisor dashboard">
        <h2 className="text-2xl font-semibold mb-6">Customer fact-finds</h2>
        <div className="rounded-2xl border bg-card divide-y">
          {sessions.length === 0 && <div className="p-6 text-muted-foreground text-sm">No fact-finds yet.</div>}
          {sessions.map((s) => (
            <Link
              key={s.id}
              to="/sessions/$sessionId"
              params={{ sessionId: s.id }}
              className="flex items-center justify-between p-4 hover:bg-muted/40 transition"
            >
              <div>
                <div className="font-medium">{s.customer?.full_name || s.customer?.email || "Unnamed customer"}</div>
                <div className="text-xs text-muted-foreground">
                  {s.status === "submitted" ? "Submitted" : "In progress"} ·{" "}
                  {formatDistanceToNow(new Date(s.started_at), { addSuffix: true })}
                </div>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full ${s.status === "submitted" ? "bg-accent/30" : "bg-muted"}`}>
                {s.status === "submitted" ? "Ready to review" : "In progress"}
              </span>
            </Link>
          ))}
        </div>
      </AppShell>
    );
  }

  const sessions = sessionsQ.data ?? [];
  return (
    <AppShell title="Your fact-finds">
      <div className="rounded-3xl bg-card border p-6 sm:p-8 mb-6">
        <div className="flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Start a new fact-find</h2>
            <p className="text-muted-foreground text-sm mt-1">Talk to your guide. It takes around 5–10 minutes.</p>
          </div>
          <Button size="lg" onClick={() => create.mutate()} disabled={create.isPending}>
            <Mic className="w-4 h-4 mr-2" />
            {create.isPending ? "Starting…" : "Start interview"}
          </Button>
        </div>
      </div>
      <h3 className="text-sm font-medium text-muted-foreground mb-3">Previous sessions</h3>
      <div className="rounded-2xl border bg-card divide-y">
        {sessions.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
            <FileText className="w-4 h-4" /> No sessions yet — start your first interview above.
          </div>
        )}
        {sessions.map((s) => (
          <Link
            key={s.id}
            to={s.status === "in_progress" ? "/interview/$sessionId" : "/sessions/$sessionId"}
            params={{ sessionId: s.id }}
            className="flex items-center justify-between p-4 hover:bg-muted/40 transition"
          >
            <div>
              <div className="font-medium">
                {s.status === "submitted" ? "Submitted fact-find" : "In progress"}
              </div>
              <div className="text-xs text-muted-foreground">
                Started {formatDistanceToNow(new Date(s.started_at), { addSuffix: true })}
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
