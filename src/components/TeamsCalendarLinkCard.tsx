import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { CalendarDays, Link2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  disconnectTeamsCalendar,
  getTeamsCalendarConnectUrl,
  getTeamsCalendarStatus,
} from "@/lib/teams-calendar.functions";
import { toast } from "sonner";

type Props = {
  search?: Record<string, unknown>;
};

export function TeamsCalendarLinkCard({ search }: Props) {
  const qc = useQueryClient();
  const statusFn = useServerFn(getTeamsCalendarStatus);
  const connectFn = useServerFn(getTeamsCalendarConnectUrl);
  const disconnectFn = useServerFn(disconnectTeamsCalendar);

  const statusQ = useQuery({
    queryKey: ["teams-calendar-status"],
    queryFn: () => statusFn(),
  });

  useEffect(() => {
    const teams = typeof search?.teams === "string" ? search.teams : null;
    if (teams === "linked") {
      toast.success("Microsoft Teams diary linked");
      qc.invalidateQueries({ queryKey: ["teams-calendar-status"] });
    } else if (teams === "error") {
      const reason =
        typeof search?.reason === "string" ? decodeURIComponent(search.reason) : "Link failed";
      toast.error(reason);
    }
  }, [search?.teams, search?.reason, qc]);

  const connect = useMutation({
    mutationFn: async () => {
      const { url } = await connectFn();
      window.location.href = url;
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not start Teams connection"),
  });

  const disconnect = useMutation({
    mutationFn: () => disconnectFn(),
    onSuccess: () => {
      toast.success("Teams diary disconnected");
      qc.invalidateQueries({ queryKey: ["teams-calendar-status"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not disconnect"),
  });

  const status = statusQ.data;

  return (
    <div className="rounded-2xl border bg-card p-5 space-y-3 mb-6">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2">
          <CalendarDays className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold">Microsoft Teams diary</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Connect your Outlook / Teams calendar so Hub appointments sync as Teams meetings.
          </p>
        </div>
      </div>

      {statusQ.isLoading && (
        <p className="text-sm text-muted-foreground">Checking connection…</p>
      )}

      {status && !status.configured && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Teams linking is not configured on the server yet. Add{" "}
          <code className="text-xs">TEAMS_CLIENT_ID</code>,{" "}
          <code className="text-xs">TEAMS_CLIENT_SECRET</code> and{" "}
          <code className="text-xs">TEAMS_TENANT_ID</code> to <code className="text-xs">.env</code>.
        </p>
      )}

      {status?.configured && status.linked && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div className="text-sm">
            <span className="font-medium text-green-700 dark:text-green-400">Connected</span>
            {status.email && (
              <span className="text-muted-foreground"> · {status.email}</span>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={disconnect.isPending}
            onClick={() => disconnect.mutate()}
          >
            <Unlink className="w-4 h-4 mr-1.5" />
            Disconnect
          </Button>
        </div>
      )}

      {status?.configured && !status.linked && (
        <Button size="sm" disabled={connect.isPending} onClick={() => connect.mutate()}>
          <Link2 className="w-4 h-4 mr-1.5" />
          {connect.isPending ? "Redirecting…" : "Connect Teams diary"}
        </Button>
      )}
    </div>
  );
}
