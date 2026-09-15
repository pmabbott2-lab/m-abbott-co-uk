import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Phone, CopyPlus, Save, Settings2, UserCog } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  addTelephonyMobileNumber,
  getTelephonyControlPanel,
  provisionAdvisorTelephony,
  updateAdvisorTelephony,
  updateTelephonyRoutingSettings,
  type AdvisorTelephonyRow,
  type TelephonyControlSnapshot,
  type TelephonyNumberRow,
} from "@/lib/telephony-manage.functions";

function formatUk(e164: string | null | undefined): string {
  if (!e164) return "—";
  if (e164.startsWith("+44") && e164.length > 3) return `0${e164.slice(3)}`;
  return e164;
}

type AmendView = "menu" | "routing" | "agent";

function AgentCard({
  agent,
  unallocatedMobiles,
  onSaved,
}: {
  agent: AdvisorTelephonyRow;
  unallocatedMobiles: Array<{ id: string; e164: string; label: string }>;
  onSaved: () => void;
}) {
  const updateFn = useServerFn(updateAdvisorTelephony);
  const [personal, setPersonal] = useState(agent.personalRerouteE164 ?? "");
  const [mobileId, setMobileId] = useState(agent.allocatedMobileNumberId ?? "");
  const [flags, setFlags] = useState({
    enabled: agent.enabled,
    ringSoftphone: agent.ringSoftphone,
    ringAllocatedMobile: agent.ringAllocatedMobile,
    ringPersonalMobile: agent.ringPersonalMobile,
    usePersonalRerouteAsFallback: agent.usePersonalRerouteAsFallback,
    respectOutlookBusy: agent.respectOutlookBusy,
    respectHubAppointments: agent.respectHubAppointments,
  });

  const save = useMutation({
    mutationFn: () =>
      updateFn({
        data: {
          userId: agent.userId,
          ...flags,
          personalRerouteE164: personal || null,
          allocatedMobileNumberId: mobileId || null,
        },
      }),
    onSuccess: () => {
      toast.success("Agent telephony saved");
      onSaved();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const mobileOptions = useMemo(() => {
    const opts = [...unallocatedMobiles];
    if (agent.allocatedMobileNumberId && agent.allocatedMobileE164) {
      opts.unshift({
        id: agent.allocatedMobileNumberId,
        e164: agent.allocatedMobileE164,
        label: "Current allocation",
      });
    }
    return opts;
  }, [agent, unallocatedMobiles]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-semibold">{agent.fullName || agent.email || "Advisor"}</div>
          <div className="text-xs text-muted-foreground">{agent.email}</div>
        </div>
        <div className="text-xs text-muted-foreground">
          Outlook: {agent.outlookLinked ? "linked" : "not linked"}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm space-y-1">
          <span className="text-muted-foreground">Allocated Twilio mobile</span>
          <select
            className="w-full h-9 rounded-md border bg-background px-2 text-sm"
            value={mobileId}
            onChange={(e) => setMobileId(e.target.value)}
          >
            <option value="">None</option>
            {mobileOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {formatUk(m.e164)} — {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm space-y-1">
          <span className="text-muted-foreground">Personal reroute mobile</span>
          <input
            className="w-full h-9 rounded-md border bg-background px-2 text-sm"
            value={personal}
            onChange={(e) => setPersonal(e.target.value)}
            placeholder="07…"
          />
        </label>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 text-sm">
        {(
          [
            ["enabled", "Profile enabled"],
            ["ringSoftphone", "Ring Hub softphone"],
            ["ringPersonalMobile", "Ring personal handset (078…)"],
            ["ringAllocatedMobile", "Also dial Twilio mobile number (unusual)"],
            ["usePersonalRerouteAsFallback", "Personal mobile if no answer / OOH"],
            ["respectOutlookBusy", "Respect Outlook busy"],
            ["respectHubAppointments", "Respect Hub diary"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={flags[key]}
              onChange={(e) => setFlags((f) => ({ ...f, [key]: e.target.checked }))}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>

      <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
        <Save className="w-3.5 h-3.5 mr-1.5" />
        {save.isPending ? "Saving…" : "Save agent"}
      </Button>
    </div>
  );
}

function RoutingRulesEditor({
  settings,
  onSaved,
}: {
  settings: TelephonyControlSnapshot["settings"];
  onSaved: () => void;
}) {
  const settingsFn = useServerFn(updateTelephonyRoutingSettings);
  const saveSettings = useMutation({
    mutationFn: (patch: Parameters<typeof settingsFn>[0]["data"]) => settingsFn({ data: patch }),
    onSuccess: () => {
      toast.success("Routing rules saved");
      onSaved();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm space-y-1 sm:col-span-2">
          <span className="text-muted-foreground">Voicemail brand (Susan&apos;s voice)</span>
          <select
            className="w-full h-9 rounded-md border bg-background px-2"
            value={settings.voiceBrand}
            onChange={(e) =>
              saveSettings.mutate({
                voiceBrand: e.target.value as "mortgage_easy" | "trent_valley",
              })
            }
          >
            <option value="mortgage_easy">MortgageEasy</option>
            <option value="trent_valley">Trent Valley Financial Services</option>
          </select>
          <span className="block text-xs text-muted-foreground mt-1">
            Each message uses Susan&apos;s British Sonia voice, with wording for the selected brand.
          </span>
        </label>
        <label className="text-sm space-y-1">
          <span className="text-muted-foreground">Out of hours</span>
          <select
            className="w-full h-9 rounded-md border bg-background px-2"
            value={settings.outOfHoursAction}
            onChange={(e) =>
              saveSettings.mutate({
                outOfHoursAction: e.target.value as "voicemail" | "reroute_personal" | "ring_anyway",
              })
            }
          >
            <option value="voicemail">Take a message</option>
            <option value="reroute_personal">Reroute to personal mobile</option>
            <option value="ring_anyway">Ring agent anyway</option>
          </select>
        </label>
        <label className="text-sm space-y-1">
          <span className="text-muted-foreground">In appointment</span>
          <select
            className="w-full h-9 rounded-md border bg-background px-2"
            value={settings.inAppointmentAction}
            onChange={(e) =>
              saveSettings.mutate({
                inAppointmentAction: e.target.value as "voicemail" | "reroute_personal" | "ring_anyway",
              })
            }
          >
            <option value="voicemail">Take a message</option>
            <option value="reroute_personal">Reroute to personal mobile</option>
            <option value="ring_anyway">Ring agent anyway</option>
          </select>
        </label>
        <label className="text-sm space-y-1">
          <span className="text-muted-foreground">No answer</span>
          <select
            className="w-full h-9 rounded-md border bg-background px-2"
            value={settings.noAnswerAction}
            onChange={(e) =>
              saveSettings.mutate({
                noAnswerAction: e.target.value as "voicemail" | "reroute_personal",
              })
            }
          >
            <option value="voicemail">Take a message</option>
            <option value="reroute_personal">Reroute to personal mobile</option>
          </select>
        </label>
        <label className="text-sm space-y-1">
          <span className="text-muted-foreground">Unknown caller</span>
          <select
            className="w-full h-9 rounded-md border bg-background px-2"
            value={settings.unownedCallerAction}
            onChange={(e) =>
              saveSettings.mutate({
                unownedCallerAction: e.target.value as "voicemail" | "ring_fallback_user",
              })
            }
          >
            <option value="voicemail">Take a message</option>
            <option value="ring_fallback_user">Ring fallback agent</option>
          </select>
        </label>
        <label className="text-sm space-y-1">
          <span className="text-muted-foreground">Ring timeout (seconds)</span>
          <input
            type="number"
            min={10}
            max={60}
            className="w-full h-9 rounded-md border bg-background px-2"
            defaultValue={settings.ringTimeoutSeconds}
            onBlur={(e) => {
              const n = Number(e.target.value);
              if (!Number.isFinite(n) || n === settings.ringTimeoutSeconds) return;
              saveSettings.mutate({ ringTimeoutSeconds: n });
            }}
          />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        Business hours default Mon–Fri 09:00–17:30 ({settings.timezone}). Known customers route to their
        allocated advisor; unknown callers follow the rule above.
      </p>
    </div>
  );
}

function ProvisionAgentForm({
  data,
  preferMobileId,
  onSaved,
}: {
  data: TelephonyControlSnapshot;
  preferMobileId?: string | null;
  onSaved: () => void;
}) {
  const provisionFn = useServerFn(provisionAdvisorTelephony);
  const alreadyProvisioned = new Set(data.agents.map((a) => a.userId));
  const provisionableStaff = data.staffOptions.filter((s) => !alreadyProvisioned.has(s.userId));
  const [newUserId, setNewUserId] = useState("");
  const [newMobileId, setNewMobileId] = useState(preferMobileId ?? "");
  const [newPersonal, setNewPersonal] = useState("");

  const provision = useMutation({
    mutationFn: () =>
      provisionFn({
        data: {
          userId: newUserId,
          mobileNumberId: newMobileId || null,
          personalRerouteE164: newPersonal || null,
          cloneFromUserId: data.agents[0]?.userId ?? null,
        },
      }),
    onSuccess: () => {
      toast.success("Agent mobile profile provisioned");
      setNewUserId("");
      setNewPersonal("");
      onSaved();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Provision failed"),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 font-medium text-sm">
        <CopyPlus className="w-4 h-4" />
        Provision advisor for this number
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm space-y-1">
          <span className="text-muted-foreground">Advisor</span>
          <select
            className="w-full h-9 rounded-md border bg-background px-2"
            value={newUserId}
            onChange={(e) => setNewUserId(e.target.value)}
          >
            <option value="">Select…</option>
            {provisionableStaff.map((s) => (
              <option key={s.userId} value={s.userId}>
                {s.fullName || s.email}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm space-y-1">
          <span className="text-muted-foreground">Twilio mobile</span>
          <select
            className="w-full h-9 rounded-md border bg-background px-2"
            value={newMobileId}
            onChange={(e) => setNewMobileId(e.target.value)}
          >
            <option value="">Allocate later</option>
            {data.unallocatedMobiles.map((m) => (
              <option key={m.id} value={m.id}>
                {formatUk(m.e164)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm space-y-1 sm:col-span-2">
          <span className="text-muted-foreground">Personal reroute</span>
          <input
            className="w-full h-9 rounded-md border bg-background px-2"
            value={newPersonal}
            onChange={(e) => setNewPersonal(e.target.value)}
            placeholder="07…"
          />
        </label>
      </div>
      <Button size="sm" disabled={!newUserId || provision.isPending} onClick={() => provision.mutate()}>
        {provision.isPending ? "Provisioning…" : "Clone profile for advisor"}
      </Button>
    </div>
  );
}

function NumberAmendDialog({
  number,
  data,
  open,
  onOpenChange,
  onSaved,
}: {
  number: TelephonyNumberRow | null;
  data: TelephonyControlSnapshot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [view, setView] = useState<AmendView>("menu");

  const agentForNumber = useMemo(() => {
    if (!number) return null;
    if (number.allocatedUserId) {
      return data.agents.find((a) => a.userId === number.allocatedUserId) ?? null;
    }
    if (number.kind === "mobile") {
      return data.agents.find((a) => a.allocatedMobileNumberId === number.id) ?? null;
    }
    // Firm landline — show first (owner) agent profile as the default soft-dial profile
    return data.agents[0] ?? null;
  }, [number, data.agents]);

  const title =
    view === "routing"
      ? "Routing rules"
      : view === "agent"
        ? "Agent profile"
        : number
          ? `Amend ${formatUk(number.e164)}`
          : "Amend number";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setView("menu");
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {view === "menu"
              ? "Choose what to change for this number."
              : number
                ? `${number.kind === "landline" ? "Landline" : "Mobile"} · ${formatUk(number.e164)}`
                : null}
          </DialogDescription>
        </DialogHeader>

        {view !== "menu" && (
          <div>
            <Button type="button" size="sm" variant="ghost" className="-ml-2 mb-2" onClick={() => setView("menu")}>
              ← Back to options
            </Button>
          </div>
        )}

        {view === "menu" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              className="rounded-xl border bg-card p-4 text-left hover:bg-muted/40 transition-colors space-y-2"
              onClick={() => setView("routing")}
            >
              <Settings2 className="w-5 h-5 text-primary" />
              <div className="font-semibold">Routing rules</div>
              <p className="text-xs text-muted-foreground">
                Out of hours, in appointment, no answer, unknown caller, voicemail brand.
              </p>
            </button>
            <button
              type="button"
              className="rounded-xl border bg-card p-4 text-left hover:bg-muted/40 transition-colors space-y-2"
              onClick={() => setView("agent")}
            >
              <UserCog className="w-5 h-5 text-primary" />
              <div className="font-semibold">Agent profile</div>
              <p className="text-xs text-muted-foreground">
                Softphone, personal handset, allocation, Outlook / diary busy rules.
              </p>
            </button>
          </div>
        )}

        {view === "routing" && (
          <RoutingRulesEditor
            settings={data.settings}
            onSaved={onSaved}
          />
        )}

        {view === "agent" && (
          <div className="space-y-4">
            {agentForNumber ? (
              <AgentCard
                key={`${agentForNumber.userId}-${agentForNumber.allocatedMobileNumberId ?? ""}`}
                agent={agentForNumber}
                unallocatedMobiles={data.unallocatedMobiles}
                onSaved={onSaved}
              />
            ) : (
              <ProvisionAgentForm
                data={data}
                preferMobileId={number?.kind === "mobile" ? number.id : null}
                onSaved={onSaved}
              />
            )}
            {agentForNumber && number?.kind === "mobile" && !number.allocatedUserId && (
              <p className="text-xs text-muted-foreground">
                This mobile is not allocated yet — assign it on the agent profile above, or provision a new
                advisor.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function TelephonyManagePanel() {
  const qc = useQueryClient();
  const panelFn = useServerFn(getTelephonyControlPanel);
  const addMobileFn = useServerFn(addTelephonyMobileNumber);

  const panelQ = useQuery({
    queryKey: ["telephony-control-panel"],
    queryFn: () => panelFn(),
  });

  const [newE164, setNewE164] = useState("");
  const [amendNumberId, setAmendNumberId] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["telephony-control-panel"] });

  const addMobile = useMutation({
    mutationFn: () => addMobileFn({ data: { e164: newE164, label: "Agent mobile" } }),
    onSuccess: () => {
      toast.success("Mobile number added — ready to allocate");
      setNewE164("");
      refresh();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not add number"),
  });

  if (panelQ.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading telephony…</div>;
  }
  if (panelQ.isError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
        {panelQ.error instanceof Error ? panelQ.error.message : "Could not load telephony"}
      </div>
    );
  }

  const data = panelQ.data!;
  const amendNumber = data.numbers.find((n) => n.id === amendNumberId) ?? null;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border bg-card p-5 space-y-2">
        <div className="flex items-center gap-2">
          <Phone className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Telephony</h2>
        </div>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Firm landline and Twilio mobiles. Use <span className="font-medium text-foreground">Amend</span> on
          a number to open routing rules or that number&apos;s agent profile.
        </p>
      </div>

      <div className="rounded-2xl border bg-card p-5 space-y-3">
        <h3 className="font-semibold">Numbers</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-2 pr-3">Kind</th>
                <th className="py-2 pr-3">Number</th>
                <th className="py-2 pr-3">Label</th>
                <th className="py-2 pr-3">Allocated to</th>
                <th className="py-2 text-right"> </th>
              </tr>
            </thead>
            <tbody>
              {data.numbers.map((n) => (
                <tr key={n.id} className="border-b last:border-0">
                  <td className="py-2 pr-3 capitalize">{n.kind}</td>
                  <td className="py-2 pr-3 font-mono">{formatUk(n.e164)}</td>
                  <td className="py-2 pr-3">{n.label}</td>
                  <td className="py-2 pr-3">
                    {n.kind === "landline"
                      ? n.isFirmInbound
                        ? "Firm inbound / soft-dial caller ID"
                        : "—"
                      : n.allocatedEmail || n.allocatedName || "Unallocated"}
                  </td>
                  <td className="py-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => setAmendNumberId(n.id)}>
                      Amend
                    </Button>
                  </td>
                </tr>
              ))}
              {data.numbers.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-muted-foreground">
                    No numbers in inventory yet. Add a Twilio mobile below, or seed the landline via SQL.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap gap-2 items-end pt-2">
          <label className="text-sm space-y-1">
            <span className="text-muted-foreground">Add Twilio mobile (for next advisor)</span>
            <input
              className="h-9 rounded-md border bg-background px-2 text-sm min-w-[14rem]"
              value={newE164}
              onChange={(e) => setNewE164(e.target.value)}
              placeholder="+447…"
            />
          </label>
          <Button
            size="sm"
            variant="outline"
            disabled={!newE164.trim() || addMobile.isPending}
            onClick={() => addMobile.mutate()}
          >
            Add mobile to inventory
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Env landline {formatUk(data.env.landlineFromEnv)} · Env mobile {formatUk(data.env.mobileFromEnv)}
        </p>
      </div>

      <NumberAmendDialog
        key={amendNumberId ?? "closed"}
        number={amendNumber}
        data={data}
        open={Boolean(amendNumberId)}
        onOpenChange={(open) => {
          if (!open) setAmendNumberId(null);
        }}
        onSaved={refresh}
      />
    </div>
  );
}
