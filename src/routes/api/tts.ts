import { createFileRoute } from "@tanstack/react-router";
import { getLovableApiKey } from "@/lib/ai-gateway.server";

export const Route = createFileRoute("/api/tts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { text } = (await request.json()) as { text: string };
        if (!text || text.length > 4000) return new Response("Bad request", { status: 400 });

        const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${getLovableApiKey()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "openai/gpt-4o-mini-tts",
            input: text,
            voice: "shimmer",
            instructions: "Speak as Susan, a warm, calm UK mortgage interview guide. Keep the pacing natural and reassuring.",
            response_format: "mp3",
          }),
        });
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          return new Response(`TTS failed: ${t}`, { status: res.status });
        }
        return new Response(res.body, {
          headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
