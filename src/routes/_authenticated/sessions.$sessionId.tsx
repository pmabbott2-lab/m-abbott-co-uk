import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  getSession,
  submitSession,
  updateAnswer,
  getMyRole,
  addAdvisorNote,
  listNotes,
  generateLenderExample,
} from "@/lib/sessions.functions";
import { SECTIONS } from "@/lib/interview-script";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/sessions/$sessionId")({
  component: SessionDetail,
});

function SessionDetail() {
  const { sessionId } = Route.useParams();
  const qc = useQueryClient();
  const getFn = useServerFn(getSession);
  const submitFn = useServerFn(submitSession);
  const updateFn = useServerFn(updateAnswer);
  const roleFn = useServerFn(getMyRole);
  const noteFn = useServerFn(addAdvisorNote);
  const notesFn = useServerFn(listNotes);

  const q = useQuery({ queryKey: ["session", sessionId], queryFn: () => getFn({ data: { sessionId } }) });
  const roleQ = useQuery({ queryKey: ["my-role"], queryFn: () => roleFn() });
  const notesQ = useQuery({ queryKey: ["notes", sessionId], queryFn: () => notesFn({ data: { sessionId } }) });

  const [note, setNote] = useState("");

  const submit = useMutation({
    mutationFn: () => submitFn({ data: { sessionId } }),
    onSuccess: () => {
      toast.success("Submitted to your advisor");
      qc.invalidateQueries({ queryKey: ["session", sessionId] });
      qc.invalidateQueries({ queryKey: ["my-sessions"] });
    },
  });

  const addNote = useMutation({
    mutationFn: (text: string) => noteFn({ data: { sessionId, note: text } }),
    onSuccess: () => {
      setNote("");
      qc.invalidateQueries({ queryKey: ["notes", sessionId] });
    },
  });

  if (q.isLoading || !q.data) {
    return <AppShell title="Session"><div className="py-16 text-center text-muted-foreground">Loading…</div></AppShell>;
  }

  const { session, answers } = q.data;
  const isAdvisor = roleQ.data?.isAdvisor ?? false;
  const answerMap = new Map(answers.map((a) => [`${a.section}:${a.field_key}`, a]));

  const onEdit = async (section: string, fieldKey: string, fieldLabel: string, value: string) => {
    try {
      await updateFn({ data: { sessionId, section, fieldKey, fieldLabel, value } });
      qc.invalidateQueries({ queryKey: ["session", sessionId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };

  return (
    <AppShell title={isAdvisor ? "Customer fact-find" : "Your fact-find"}>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-2xl font-semibold">Fact-find summary</h2>
            <p className="text-sm text-muted-foreground">
              Started {format(new Date(session.started_at), "PPP")} ·{" "}
              <span className="font-medium">{session.status === "submitted" ? "Submitted" : "In progress"}</span>
            </p>
          </div>
          {!isAdvisor && session.status !== "submitted" && (
            <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
              {submit.isPending ? "Submitting…" : "Submit to advisor"}
            </Button>
          )}
        </div>

        {(session as { summary?: string | null }).summary && (
          <div className="rounded-2xl border bg-card p-5">
            <h3 className="font-semibold mb-2">AI summary for the advisor</h3>
            <div className="text-sm whitespace-pre-wrap leading-relaxed">
              {(session as { summary?: string | null }).summary}
            </div>
          </div>
        )}



        {SECTIONS.map((sec) => (
          <div key={sec.id} className="rounded-2xl border bg-card p-5">
            <h3 className="font-semibold mb-4">{sec.title}</h3>
            <dl className="divide-y">
              {sec.questions.map((qst) => {
                const a = answerMap.get(`${sec.id}:${qst.key}`);
                return (
                  <div key={qst.key} className="py-3 grid grid-cols-1 sm:grid-cols-3 gap-2 items-start">
                    <dt className="text-sm text-muted-foreground">{qst.label}</dt>
                    <dd className="sm:col-span-2">
                      {isAdvisor || session.status === "submitted" ? (
                        <span className="text-sm">{a?.value || <em className="text-muted-foreground">No answer</em>}</span>
                      ) : (
                        <EditableValue
                          value={a?.value ?? ""}
                          onSave={(v) => onEdit(sec.id, qst.key, qst.label, v)}
                        />
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ))}

        {isAdvisor && (
          <div className="rounded-2xl border bg-card p-5 space-y-3">
            <h3 className="font-semibold">Advisor notes</h3>
            <div className="space-y-2">
              {(notesQ.data ?? []).map((n) => (
                <div key={n.id} className="text-sm bg-muted/40 rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-1">{format(new Date(n.created_at), "PPp")}</div>
                  {n.note}
                </div>
              ))}
              {(notesQ.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No notes yet.</p>}
            </div>
            <textarea
              className="w-full border rounded-lg p-2 text-sm bg-background"
              placeholder="Add a note for the file…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
            />
            <Button size="sm" onClick={() => note.trim() && addNote.mutate(note.trim())} disabled={addNote.isPending}>
              Add note
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function EditableValue({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  if (!editing) {
    return (
      <div className="flex items-start gap-2">
        <span className="text-sm flex-1">{value || <em className="text-muted-foreground">No answer</em>}</span>
        <button className="text-xs text-accent-foreground underline" onClick={() => { setVal(value); setEditing(true); }}>
          Edit
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <textarea
        className="w-full border rounded-md bg-background p-2 text-sm"
        value={val}
        onChange={(e) => setVal(e.target.value)}
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => { onSave(val); setEditing(false); }}>Save</Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
      </div>
    </div>
  );
}
