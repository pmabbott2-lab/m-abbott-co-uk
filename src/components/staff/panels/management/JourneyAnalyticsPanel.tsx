import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { TenantAppLink as Link } from "@/components/tenant/TenantAppLink";
import { BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ReportTableScroll } from "@/components/ReportTableScroll";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { BrowserSoftphone } from "@/components/BrowserSoftphone";
import { CustomerHubBookingDialog } from "@/components/CustomerHubBookingDialog";
import { prepareBrowserCall } from "@/lib/telephony.functions";
import { promoteSessionToCaseAsStaff } from "@/lib/sessions.functions";
import {
  listJourneyAnalyticsLeads,
  type JourneyAnalyticsGenerator,
  type JourneyAnalyticsJourney,
  type JourneyAnalyticsLead,
} from "@/lib/journey-analytics.functions";

type LeadGenerator = "all" | JourneyAnalyticsGenerator;
type JourneyType = "all" | JourneyAnalyticsJourney;

const GENERATOR_LABEL: Record<JourneyAnalyticsGenerator, string> = {
  direct: "Direct",
  raf: "Refer a friend",
  introducer: "Introducer",
  google: "Google / paid",
  unknown: "Unknown",
};

const JOURNEY_LABEL: Record<JourneyAnalyticsJourney, string> = {
  voice: "Voice fact-find",
  chat: "Chat fact-find",
  book: "Book first",
};

function pct(n: number, d: number) {
  if (d <= 0) return "0%";
  return `${Math.round((n / d) * 100)}%`;
}

function AbandonedLeadEngageSheet({
  lead,
  open,
  onOpenChange,
}: {
  lead: JourneyAnalyticsLead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const prepareFn = useServerFn(prepareBrowserCall);
  const promoteFn = useServerFn(promoteSessionToCaseAsStaff);

  if (!lead) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{lead.name}</SheetTitle>
          <SheetDescription>
            Abandoned {JOURNEY_LABEL[lead.journey].toLowerCase()} · {lead.stage}
            {lead.caseRef ? ` · ${lead.caseRef}` : ""}. Soft call or book to bring them back into the
            live pipeline — same customer profile is kept.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Phone</dt>
              <dd className="font-medium">{lead.customerPhone || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Email</dt>
              <dd className="font-medium break-all">{lead.customerEmail || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Lead generator</dt>
              <dd className="font-medium">{GENERATOR_LABEL[lead.generator]}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Journey</dt>
              <dd className="font-medium">{JOURNEY_LABEL[lead.journey]}</dd>
            </div>
          </dl>

          <div className="rounded-xl border p-4 space-y-3">
            <h4 className="text-sm font-semibold">Soft call</h4>
            <p className="text-xs text-muted-foreground">
              Opens a case on this fact-find if needed (same customer), then dials from the browser.
            </p>
            {lead.customerPhone && lead.customerId ? (
              <BrowserSoftphone
                customerName={lead.name}
                customerPhone={lead.customerPhone}
                onCall={async () => {
                  await promoteFn({
                    data: { sessionId: lead.id, customerId: lead.customerId! },
                  });
                  return prepareFn({
                    data: { sessionId: lead.id, customerPhone: lead.customerPhone! },
                  });
                }}
                onCallComplete={() => {
                  qc.invalidateQueries({ queryKey: ["journey-analytics-leads"] });
                  qc.invalidateQueries({ queryKey: ["all-sessions"] });
                  qc.invalidateQueries({ queryKey: ["advisor-contacts"] });
                }}
              />
            ) : (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                Add a phone number on the customer profile to soft call.
              </p>
            )}
          </div>

          <div className="rounded-xl border p-4 space-y-3">
            <h4 className="text-sm font-semibold">Book appointment</h4>
            <p className="text-xs text-muted-foreground">
              Books into an advisor diary and links this fact-find — customer stays on the same
              profile and re-enters Customers / Contacts.
            </p>
            {lead.customerId ? (
              <CustomerHubBookingDialog
                customerId={lead.customerId}
                customerName={lead.name}
                customerEmail={lead.customerEmail}
                customerPhone={lead.customerPhone}
                factFinds={[]}
                sessionId={lead.id}
                reengageExistingSession
                triggerLabel="Book appointment"
                triggerVariant="default"
                onBooked={() => {
                  toast.success("Appointment booked — customer back in the live pipeline");
                  qc.invalidateQueries({ queryKey: ["journey-analytics-leads"] });
                  qc.invalidateQueries({ queryKey: ["all-sessions"] });
                  qc.invalidateQueries({ queryKey: ["advisor-contacts"] });
                  onOpenChange(false);
                }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Customer link unavailable.</p>
            )}
            {!lead.customerEmail && lead.customerId && (
              <p className="text-xs text-muted-foreground">
                You can enter an email in the booking dialog if one is missing on the profile.
              </p>
            )}
          </div>

          <Link
            to="/sessions/$sessionId"
            params={{ sessionId: lead.id }}
            className="text-sm text-muted-foreground hover:text-primary hover:underline"
          >
            Open full case (optional) →
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function JourneyAnalyticsPanel() {
  const listFn = useServerFn(listJourneyAnalyticsLeads);
  const [generator, setGenerator] = useState<LeadGenerator>("all");
  const [journey, setJourney] = useState<JourneyType>("all");
  const [selectedAbandoned, setSelectedAbandoned] = useState<JourneyAnalyticsLead | null>(null);

  const leadsQ = useQuery({
    queryKey: ["journey-analytics-leads"],
    queryFn: () => listFn(),
  });

  const leads: JourneyAnalyticsLead[] = leadsQ.data?.leads ?? [];
  const isLive = leadsQ.data?.live ?? false;

  const filtered = useMemo(
    () =>
      leads.filter(
        (l) =>
          (generator === "all" || l.generator === generator) &&
          (journey === "all" || l.journey === journey),
      ),
    [leads, generator, journey],
  );

  const started = filtered.length;
  const completed = filtered.filter((l) => l.outcome === "completed" || l.outcome === "booked").length;
  const booked = filtered.filter((l) => l.outcome === "booked").length;
  const abandoned = filtered.filter((l) => l.outcome === "abandoned").length;
  const inProgress = filtered.filter((l) => l.outcome === "in_progress").length;

  const byGenerator = useMemo(() => {
    const keys = Object.keys(GENERATOR_LABEL) as JourneyAnalyticsGenerator[];
    return keys
      .map((g) => {
        const rows = filtered.filter((l) => l.generator === g);
        if (!rows.length) return null;
        const done = rows.filter((l) => l.outcome === "completed" || l.outcome === "booked").length;
        const left = rows.filter((l) => l.outcome === "abandoned").length;
        return {
          label: GENERATOR_LABEL[g],
          started: rows.length,
          completion: pct(done, rows.length),
          abandonment: pct(left, rows.length),
        };
      })
      .filter(Boolean) as Array<{
      label: string;
      started: number;
      completion: string;
      abandonment: string;
    }>;
  }, [filtered]);

  const byJourney = useMemo(() => {
    const keys = Object.keys(JOURNEY_LABEL) as JourneyAnalyticsJourney[];
    return keys
      .map((j) => {
        const rows = filtered.filter((l) => l.journey === j);
        if (!rows.length) return null;
        const done = rows.filter((l) => l.outcome === "completed" || l.outcome === "booked").length;
        const left = rows.filter((l) => l.outcome === "abandoned").length;
        return {
          label: JOURNEY_LABEL[j],
          started: rows.length,
          completion: pct(done, rows.length),
          abandonment: pct(left, rows.length),
        };
      })
      .filter(Boolean) as Array<{
      label: string;
      started: number;
      completion: string;
      abandonment: string;
    }>;
  }, [filtered]);

  const abandonedRows = filtered.filter((l) => l.outcome === "abandoned");

  const funnel = [
    { label: "Started", value: started },
    {
      label: "Past contact",
      value: filtered.filter((l) => l.stage !== "Started").length,
    },
    {
      label: "Mid fact-find+",
      value: filtered.filter((l) =>
        ["Fact-find mid", "Fact-find done", "Booked"].includes(l.stage),
      ).length,
    },
    { label: "Completed", value: completed },
    { label: "Booked", value: booked },
  ];

  return (
    <div className="mt-2 space-y-4">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="inline-flex w-10 h-10 items-center justify-center rounded-full bg-primary/10 text-primary shrink-0">
          <BarChart3 className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">Journey analytics</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Lead start → fact-find progress → completion / booking. Click an abandoned lead to soft
            call or book them back into the pipeline on the same customer profile.
          </p>
        </div>
      </div>

      {leadsQ.isLoading && (
        <p className="text-sm text-muted-foreground">Loading live journey data…</p>
      )}
      {leadsQ.isError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Could not load analytics: {(leadsQ.error as Error).message}
        </div>
      )}
      {isLive && !leadsQ.isLoading && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 dark:border-emerald-900 dark:bg-emerald-950/30 px-4 py-3 text-sm text-emerald-950 dark:text-emerald-100">
          Live data from the last 90 days · {leads.length} lead{leads.length === 1 ? "" : "s"}
        </div>
      )}

      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1.5">
          <Label htmlFor="analytics-generator" className="text-xs text-muted-foreground">
            Lead generator
          </Label>
          <select
            id="analytics-generator"
            className="h-9 rounded-md border bg-background px-2 text-sm min-w-[160px]"
            value={generator}
            onChange={(e) => setGenerator(e.target.value as LeadGenerator)}
          >
            <option value="all">All generators</option>
            <option value="direct">Direct</option>
            <option value="raf">Refer a friend</option>
            <option value="introducer">Introducer</option>
            <option value="google">Google / paid</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="analytics-journey" className="text-xs text-muted-foreground">
            Journey
          </Label>
          <select
            id="analytics-journey"
            className="h-9 rounded-md border bg-background px-2 text-sm min-w-[160px]"
            value={journey}
            onChange={(e) => setJourney(e.target.value as JourneyType)}
          >
            <option value="all">All journeys</option>
            <option value="voice">Voice fact-find</option>
            <option value="chat">Chat fact-find</option>
            <option value="book">Book first</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Leads started" value={String(started)} />
        <StatCard label="Completion rate" value={pct(completed, started)} tone="good" />
        <StatCard label="Abandonment rate" value={pct(abandoned, started)} tone="warn" />
        <StatCard label="Booked after start" value={pct(booked, started)} />
      </div>

      <div className="rounded-2xl border bg-card p-4 space-y-3">
        <h4 className="text-sm font-medium">Funnel (last 90 days)</h4>
        <div className="space-y-2">
          {funnel.map((step, i) => {
            const width = started ? Math.max(8, Math.round((step.value / started) * 100)) : 0;
            return (
              <div key={step.label} className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    {i + 1}. {step.label}
                  </span>
                  <span>
                    {step.value} · {pct(step.value, started)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-primary/80" style={{ width: `${width}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">In progress right now: {inProgress}.</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <div className="rounded-2xl border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b text-sm font-medium">By lead generator</div>
          <ReportTableScroll visibleRows={8} className="rounded-none border-0">
            <table className="w-full text-sm min-w-[28rem]">
              <thead className="text-xs text-muted-foreground bg-muted/40 sticky top-0">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Generator</th>
                  <th className="text-right font-medium px-4 py-2">Started</th>
                  <th className="text-right font-medium px-4 py-2">Complete</th>
                  <th className="text-right font-medium px-4 py-2">Abandoned</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {byGenerator.map((row) => (
                  <tr key={row.label}>
                    <td className="px-4 py-2">{row.label}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{row.started}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{row.completion}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{row.abandonment}</td>
                  </tr>
                ))}
                {byGenerator.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-muted-foreground text-center">
                      No leads for this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </ReportTableScroll>
        </div>

        <div className="rounded-2xl border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b text-sm font-medium">By journey type</div>
          <ReportTableScroll visibleRows={8} className="rounded-none border-0">
            <table className="w-full text-sm min-w-[28rem]">
              <thead className="text-xs text-muted-foreground bg-muted/40 sticky top-0">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Journey</th>
                  <th className="text-right font-medium px-4 py-2">Started</th>
                  <th className="text-right font-medium px-4 py-2">Complete</th>
                  <th className="text-right font-medium px-4 py-2">Abandoned</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {byJourney.map((row) => (
                  <tr key={row.label}>
                    <td className="px-4 py-2">{row.label}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{row.started}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{row.completion}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{row.abandonment}</td>
                  </tr>
                ))}
                {byJourney.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-muted-foreground text-center">
                      No leads for this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </ReportTableScroll>
        </div>
      </div>

      <div className="rounded-2xl border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b text-sm font-medium">
          Abandoned leads with contact ({abandonedRows.length})
        </div>
        <ReportTableScroll visibleRows={10} className="rounded-none border-0">
          <table className="w-full text-sm min-w-[44rem]">
            <thead className="text-xs text-muted-foreground bg-muted/40 sticky top-0">
              <tr>
                <th className="text-left font-medium px-4 py-2">Customer</th>
                <th className="text-left font-medium px-4 py-2">Generator</th>
                <th className="text-left font-medium px-4 py-2">Journey</th>
                <th className="text-left font-medium px-4 py-2">Last stage</th>
                <th className="text-left font-medium px-4 py-2">Contact</th>
                <th className="text-right font-medium px-4 py-2">Re-engage</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {abandonedRows.map((row) => (
                <tr
                  key={row.id}
                  className="hover:bg-muted/30 cursor-pointer"
                  onClick={() => setSelectedAbandoned(row)}
                >
                  <td className="px-4 py-2 font-medium">{row.name}</td>
                  <td className="px-4 py-2">{GENERATOR_LABEL[row.generator]}</td>
                  <td className="px-4 py-2">{JOURNEY_LABEL[row.journey]}</td>
                  <td className="px-4 py-2">{row.stage}</td>
                  <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{row.contact}</td>
                  <td className="px-4 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedAbandoned(row)}
                    >
                      Soft call / book
                    </Button>
                  </td>
                </tr>
              ))}
              {abandonedRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-muted-foreground text-center">
                    No abandoned leads for this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </ReportTableScroll>
      </div>

      <AbandonedLeadEngageSheet
        lead={selectedAbandoned}
        open={Boolean(selectedAbandoned)}
        onOpenChange={(next) => {
          if (!next) setSelectedAbandoned(null);
        }}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn";
}) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div
        className={`text-2xl font-semibold tabular-nums ${
          tone === "good"
            ? "text-emerald-700 dark:text-emerald-400"
            : tone === "warn"
              ? "text-amber-700 dark:text-amber-400"
              : ""
        }`}
      >
        {value}
      </div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  );
}
