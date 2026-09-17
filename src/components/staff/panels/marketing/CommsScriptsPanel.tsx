import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  getCommunicationSettingsFn,
  listCommunicationTemplates,
  updateCommunicationSettingsFn,
  updateCommunicationTemplateFn,
  type CommunicationTemplateRow,
} from "@/lib/comms.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export function CommsScriptsPanel({ canAmend }: { canAmend: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listCommunicationTemplates);
  const settingsFn = useServerFn(getCommunicationSettingsFn);
  const saveSettingsFn = useServerFn(updateCommunicationSettingsFn);
  const saveTemplateFn = useServerFn(updateCommunicationTemplateFn);

  const [channelFilter, setChannelFilter] = useState<"all" | "sms" | "email" | "voice">("all");
  const [editing, setEditing] = useState<CommunicationTemplateRow | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [emailFooter, setEmailFooter] = useState("");
  const [smsFooter, setSmsFooter] = useState("");

  const templatesQ = useQuery({
    queryKey: ["comms-templates"],
    queryFn: () => listFn(),
  });
  const settingsQ = useQuery({
    queryKey: ["comms-settings"],
    queryFn: () => settingsFn(),
  });

  useEffect(() => {
    if (!settingsQ.data) return;
    setEmailFooter(settingsQ.data.email_regulatory_footer);
    setSmsFooter(settingsQ.data.sms_regulatory_footer);
  }, [settingsQ.data]);

  const templates = (templatesQ.data?.templates ?? []).filter(
    (t) => channelFilter === "all" || t.channel === channelFilter,
  );

  const saveSettings = useMutation({
    mutationFn: () =>
      saveSettingsFn({
        data: {
          emailRegulatoryFooter: emailFooter,
          smsRegulatoryFooter: smsFooter,
        },
      }),
    onSuccess: () => {
      toast.success("Regulatory statements saved — applied across all communications");
      qc.invalidateQueries({ queryKey: ["comms-settings"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  const saveTemplate = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error("No template selected");
      return saveTemplateFn({
        data: {
          templateId: editing.id,
          subject: editing.channel === "email" ? editSubject : null,
          body: editBody,
        },
      });
    },
    onSuccess: () => {
      toast.success("Template updated");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["comms-templates"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold text-lg">Email / Text / Voice Scripts</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Friendly wording for Hub messages. Regulatory statements below are shared and auto-added
          to every communication — do not paste them into each template.
        </p>
      </div>

      <div className="rounded-2xl border bg-card p-4 space-y-4">
        <h4 className="font-medium">Regulatory statements (shared)</h4>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Email footer</label>
          <Textarea
            rows={4}
            value={emailFooter}
            disabled={!canAmend || settingsQ.isLoading}
            onChange={(e) => setEmailFooter(e.target.value)}
            placeholder="Full regulatory / disclosure footer for emails"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">
            Text / SMS disclosure (starts with *)
          </label>
          <Textarea
            rows={2}
            value={smsFooter}
            disabled={!canAmend || settingsQ.isLoading}
            onChange={(e) => setSmsFooter(e.target.value)}
            placeholder="*Your firm is authorised and regulated by the FCA…"
          />
          <p className="text-[11px] text-muted-foreground">
            If you omit the leading *, Hub adds it automatically before sending.
          </p>
        </div>
        {canAmend && (
          <Button disabled={saveSettings.isPending} onClick={() => saveSettings.mutate()}>
            {saveSettings.isPending ? "Saving…" : "Save regulatory statements"}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", "All"],
            ["sms", "Text"],
            ["email", "Email"],
            ["voice", "Voice"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={channelFilter === value ? "secondary" : "ghost"}
            onClick={() => setChannelFilter(value)}
          >
            {label}
          </Button>
        ))}
      </div>

      <div className="rounded-2xl border bg-card divide-y">
        {templatesQ.isLoading && (
          <p className="p-4 text-sm text-muted-foreground">Loading templates…</p>
        )}
        {!templatesQ.isLoading && templates.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">No templates found for this filter.</p>
        )}
        {templates.map((t) => (
          <div key={t.id} className="p-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-sm">{t.name}</span>
                <span className="text-[10px] uppercase tracking-wide rounded-full border px-2 py-0.5 text-muted-foreground">
                  {t.channel}
                </span>
                {!t.active && (
                  <span className="text-[10px] uppercase tracking-wide rounded-full border px-2 py-0.5 text-destructive">
                    inactive
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{t.description}</p>
              <p className="text-xs font-mono text-muted-foreground/80 line-clamp-2 whitespace-pre-wrap">
                {t.body}
              </p>
            </div>
            {canAmend && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditing(t);
                  setEditSubject(t.subject ?? "");
                  setEditBody(t.body);
                }}
              >
                Amend
              </Button>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <div className="rounded-2xl border bg-muted/30 p-4 space-y-3">
          <h4 className="font-medium">Amend: {editing.name}</h4>
          <p className="text-xs text-muted-foreground">
            Tokens such as {"{customer_first_name}"}, {"{appointment_date}"}, {"{booking_url}"} are
            filled by the system. Leave the regulatory statement out of the body.
          </p>
          {editing.channel === "email" && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Subject</label>
              <Input value={editSubject} onChange={(e) => setEditSubject(e.target.value)} />
            </div>
          )}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Body</label>
            <Textarea rows={8} value={editBody} onChange={(e) => setEditBody(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={saveTemplate.isPending || !editBody.trim()}
              onClick={() => saveTemplate.mutate()}
            >
              {saveTemplate.isPending ? "Saving…" : "Save template"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
