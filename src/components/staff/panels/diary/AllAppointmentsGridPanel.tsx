import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays } from "lucide-react";
import { AppointmentAmendDialog } from "@/components/AppointmentAmendDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listAllUpcomingAppointments } from "@/lib/booking.functions";
import { safeFormat } from "@/lib/safe-format";

type GridRow = {
  id: string;
  starts_at: string;
  status: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string | null;
  lead_source?: string | null;
  notes?: string | null;
  ms_join_url?: string | null;
  advisor_id: string;
  advisor_name: string | null;
  advisor_code: string | null;
};

/** Forward-looking appointments across all advisors — grid / table view. */
export function AllAppointmentsGridPanel() {
  const listFn = useServerFn(listAllUpcomingAppointments);
  const [advisorFilter, setAdvisorFilter] = useState("");
  const [search, setSearch] = useState("");
  const [amendId, setAmendId] = useState<string | null>(null);

  const apptsQ = useQuery({
    queryKey: ["all-upcoming-appointments"],
    queryFn: () => listFn(),
    retry: 1,
  });

  const rows = (apptsQ.data ?? []) as GridRow[];
  const advisors = useMemo(() => {
    const map = new Map<string, { id: string; name: string; code: string | null }>();
    for (const r of rows) {
      if (!map.has(r.advisor_id)) {
        map.set(r.advisor_id, {
          id: r.advisor_id,
          name: r.advisor_name ?? "Advisor",
          code: r.advisor_code,
        });
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const q = search.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (advisorFilter && r.advisor_id !== advisorFilter) return false;
    if (!q) return true;
    const haystack = [r.customer_name, r.customer_phone, r.customer_email, r.advisor_name, r.advisor_code]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });

  const byDay = useMemo(() => {
    const groups = new Map<string, GridRow[]>();
    for (const r of filtered) {
      const day = safeFormat(r.starts_at, "yyyy-MM-dd");
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day)!.push(r);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const amendAppt = rows.find((a) => a.id === amendId);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-lg flex items-center gap-2">
          <CalendarDays className="w-5 h-5" />
          All appointments
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Forward-looking confirmed bookings across every advisor diary, grouped by day.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 max-w-2xl">
        <div className="space-y-1">
          <Label className="text-xs">Search</Label>
          <Input
            placeholder="Customer, advisor, code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Advisor</Label>
          <select
            className="w-full h-9 rounded-md border bg-background px-2 text-sm"
            value={advisorFilter}
            onChange={(e) => setAdvisorFilter(e.target.value)}
          >
            <option value="">All advisors</option>
            {advisors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.code ? ` · ${a.code}` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {apptsQ.isError && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Could not load appointments:{" "}
          {apptsQ.error instanceof Error ? apptsQ.error.message : "Unknown error"}
          <Button size="sm" variant="outline" className="ml-3" onClick={() => apptsQ.refetch()}>
            Retry
          </Button>
        </div>
      )}

      {apptsQ.isLoading && (
        <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">Loading…</div>
      )}

      {!apptsQ.isLoading && !apptsQ.isError && filtered.length === 0 && (
        <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
          No upcoming appointments match your filters.
        </div>
      )}

      {byDay.map(([day, dayRows]) => (
        <div key={day} className="rounded-2xl border bg-card overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/40 border-b text-sm font-medium">
            {safeFormat(dayRows[0]?.starts_at, "EEEE d MMMM yyyy")}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="p-3 font-medium">Time</th>
                  <th className="p-3 font-medium">Advisor</th>
                  <th className="p-3 font-medium">Customer</th>
                  <th className="p-3 font-medium">Contact</th>
                  <th className="p-3 font-medium w-20" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {dayRows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/20">
                    <td className="p-3 whitespace-nowrap font-medium">
                      {safeFormat(r.starts_at, "HH:mm")}
                    </td>
                    <td className="p-3">
                      <div className="font-medium">{r.advisor_name ?? "—"}</div>
                      {r.advisor_code && (
                        <div className="text-xs text-muted-foreground font-mono">{r.advisor_code}</div>
                      )}
                    </td>
                    <td className="p-3">{r.customer_name}</td>
                    <td className="p-3 text-muted-foreground text-xs">
                      {r.customer_phone}
                      {r.customer_email ? ` · ${r.customer_email}` : ""}
                    </td>
                    <td className="p-3">
                      <Button size="sm" variant="outline" onClick={() => setAmendId(r.id)}>
                        Amend
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {amendAppt && (
        <AppointmentAmendDialog
          appointment={{
            id: amendAppt.id,
            startsAt: amendAppt.starts_at,
            status: amendAppt.status,
            advisorName: amendAppt.advisor_name ?? "",
            customerName: amendAppt.customer_name,
            customerPhone: amendAppt.customer_phone,
            customerEmail: amendAppt.customer_email,
          }}
          open={Boolean(amendId)}
          onOpenChange={(open) => {
            if (!open) setAmendId(null);
          }}
          onAmended={() => apptsQ.refetch()}
        />
      )}
    </div>
  );
}
