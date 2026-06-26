import { createFileRoute } from "@tanstack/react-router";
import { openAIFetch } from "@/lib/openai.server";

export const Route = createFileRoute("/api/stt")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File)) return new Response("No file", { status: 400 });
        if (file.size < 800) return Response.json({ text: "" });

        const upstream = new FormData();
        upstream.append("model", "gpt-4o-mini-transcribe");
        upstream.append("file", file, file.name || "recording.webm");

        const res = await openAIFetch("/audio/transcriptions", {
          method: "POST",
          body: upstream,
        });
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          return new Response(`STT failed: ${t}`, { status: res.status });
        }
        const json = (await res.json()) as { text?: string };
        return Response.json({ text: json.text ?? "" });
      },
    },
  },
});
