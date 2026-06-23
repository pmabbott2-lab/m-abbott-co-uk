import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, Check } from "lucide-react";
import { toast } from "sonner";
import type { Question, CompositeField, ChoiceOption } from "@/lib/interview-script";

interface Props {
  question: Question;
  /** Called with the assembled answer string when the user submits. */
  onSubmit: (assembled: string) => void;
  disabled?: boolean;
}

function ChoiceGrid({ options, value, onChange, disabled }: { options: ChoiceOption[]; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 w-full">
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <button
            type="button"
            key={o.value}
            onClick={() => onChange(o.value)}
            disabled={disabled}
            className={`rounded-2xl border px-4 py-3 text-sm font-medium transition-colors text-left ${
              selected ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card hover:bg-accent"
            } disabled:opacity-50`}
          >
            {selected && <Check className="inline w-4 h-4 mr-1" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function VoiceCapture({ value, onChange, hint, disabled }: { value: string; onChange: (v: string) => void; hint?: string; disabled?: boolean }) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = ["audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) || "audio/webm";
      const mr = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      mr.onstop = async () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: mr.mimeType });
        if (blob.size < 1024) return;
        setTranscribing(true);
        try {
          const ext = mr.mimeType.includes("mp4") ? "mp4" : "webm";
          const form = new FormData();
          form.append("file", blob, `recording.${ext}`);
          const res = await fetch("/api/stt", { method: "POST", body: form });
          if (!res.ok) throw new Error("Transcription failed");
          const { text } = (await res.json()) as { text: string };
          if (text.trim()) onChange((value ? value + " " : "") + text.trim());
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Transcription failed");
        } finally {
          setTranscribing(false);
        }
      };
      mr.start();
      mediaRef.current = mr;
      setRecording(true);
    } catch {
      toast.error("Microphone access needed");
    }
  };
  const stop = () => {
    if (mediaRef.current?.state === "recording") {
      try { mediaRef.current.stop(); } catch { /* noop */ }
    }
  };

  useEffect(() => () => {
    try { mediaRef.current?.stop(); } catch { /* noop */ }
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  return (
    <div className="w-full space-y-2">
      <div className="rounded-2xl border bg-muted/40 p-3 min-h-[3.5rem] text-sm text-left">
        {value ? value : <span className="text-muted-foreground">{transcribing ? "Transcribing…" : hint || "Tap the mic and speak your answer"}</span>}
      </div>
      <div className="flex gap-2 justify-center">
        {recording ? (
          <Button type="button" onClick={stop} variant="destructive" className="rounded-full" disabled={disabled}>
            <Square className="w-4 h-4 mr-2" /> Stop
          </Button>
        ) : (
          <Button type="button" onClick={start} variant="outline" className="rounded-full" disabled={disabled || transcribing}>
            <Mic className="w-4 h-4 mr-2" /> {value ? "Add more" : "Tap to speak"}
          </Button>
        )}
        {value && !recording && (
          <Button type="button" variant="ghost" className="rounded-full" onClick={() => onChange("")} disabled={disabled}>
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

export function QuestionInput({ question, onSubmit, disabled }: Props) {
  const input = question.input;
  const [singleVal, setSingleVal] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});

  if (!input || input.kind === "voice") return null;

  if (input.kind === "single") {
    return (
      <div className="w-full space-y-4">
        <ChoiceGrid options={input.options} value={singleVal} onChange={setSingleVal} disabled={disabled} />
        <div className="flex justify-center">
          <Button
            onClick={() => onSubmit(`${question.label}: ${singleVal}`)}
            disabled={disabled || !singleVal}
            size="lg"
            className="rounded-full"
          >
            Continue
          </Button>
        </div>
      </div>
    );
  }

  // composite
  const fields = input.fields.filter((f) => !f.showWhen || f.showWhen(values));
  const allFilled = fields.every((f) => (values[f.key] ?? "").trim().length > 0);

  const setField = (key: string, v: string) => setValues((prev) => ({ ...prev, [key]: v }));

  const handleSubmit = () => {
    const parts = fields.map((f) => `${f.label}: ${values[f.key] ?? ""}`);
    onSubmit(parts.join(". "));
  };

  return (
    <div className="w-full space-y-5">
      {fields.map((f: CompositeField) => (
        <div key={f.key} className="space-y-2 text-left">
          <p className="text-sm font-medium">{f.label}</p>
          {f.kind === "single" ? (
            <ChoiceGrid options={f.options} value={values[f.key] ?? ""} onChange={(v) => setField(f.key, v)} disabled={disabled} />
          ) : (
            <VoiceCapture value={values[f.key] ?? ""} onChange={(v) => setField(f.key, v)} hint={f.hint} disabled={disabled} />
          )}
        </div>
      ))}
      <div className="flex justify-center pt-2">
        <Button onClick={handleSubmit} disabled={disabled || !allFilled} size="lg" className="rounded-full">
          Continue
        </Button>
      </div>
    </div>
  );
}
