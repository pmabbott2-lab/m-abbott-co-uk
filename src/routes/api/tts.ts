import { createFileRoute } from "@tanstack/react-router";
import { requireApiAuth } from "@/lib/api-auth.server";
import { synthesizeSpeech } from "@/lib/openai.server";
import { getCachedTts, setCachedTts } from "@/lib/tts-cache.server";

export const Route = createFileRoute("/api/tts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireApiAuth(request);
        if (!auth.ok) return auth.response;

        const { text } = (await request.json()) as { text: string };
        if (!text || text.length > 4000) return new Response("Bad request", { status: 400 });

        const cached = getCachedTts(text);
        if (cached) {
          return new Response(cached, {
            headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600", "X-TTS-Cache": "hit" },
          });
        }

        try {
          const audio = await synthesizeSpeech(text);
          setCachedTts(text, audio);
          return new Response(audio, {
            headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600", "X-TTS-Cache": "miss" },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "TTS failed";
          return new Response(msg, { status: 502 });
        }
      },
    },
  },
});
