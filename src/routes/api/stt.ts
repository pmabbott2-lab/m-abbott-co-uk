import { createFileRoute } from "@tanstack/react-router";
import { requireApiAuth } from "@/lib/api-auth.server";
import { transcribeAudio } from "@/lib/openai.server";

function toAudioFile(entry: FormDataEntryValue | null): File | null {
  if (!entry) return null;
  if (entry instanceof File) return entry;
  if (entry instanceof Blob && entry.size > 0) {
    const type = entry.type || "audio/webm";
    const ext = type.includes("mp4") ? "m4a" : "webm";
    return new File([entry], `recording.${ext}`, { type });
  }
  return null;
}

export const Route = createFileRoute("/api/stt")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireApiAuth(request);
        if (!auth.ok) return auth.response;

        const form = await request.formData();
        const file = toAudioFile(form.get("file"));
        if (!file) {
          return Response.json({ error: "No audio file received" }, { status: 400 });
        }
        if (file.size < 400) return Response.json({ text: "" });

        try {
          const text = await transcribeAudio(file);
          return Response.json({ text });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "STT failed";
          const quota = /429|quota|rate limit/i.test(msg);
          return Response.json({ error: msg, quota }, { status: quota ? 429 : 502 });
        }
      },
    },
  },
});
