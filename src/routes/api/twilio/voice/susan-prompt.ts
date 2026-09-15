import { createFileRoute } from "@tanstack/react-router";
import { synthesizeSpeech, SUSAN_AZURE_VOICE } from "@/lib/azure.server";
import { getCachedTts, setCachedTts } from "@/lib/tts-cache.server";
import {
  parseVoiceBrand,
  resolveVoicemailGreetingKey,
  verifySusanPromptSig,
  voicemailGreetingText,
  type VoicemailGreetingKey,
} from "@/lib/voice.server";

const KEYS = new Set<VoicemailGreetingKey>([
  "default",
  "out_of_hours",
  "in_appointment",
  "no_answer",
  "unowned_caller",
  "advisor_unavailable",
]);

/**
 * Public audio for Twilio &lt;Play&gt; — Susan's Azure Sonia voice.
 * Auth is a signed query string (brand + greeting key), not a user session.
 */
export const Route = createFileRoute("/api/twilio/voice/susan-prompt")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const brand = parseVoiceBrand(url.searchParams.get("brand"));
        const keyRaw = url.searchParams.get("key") ?? "default";
        const key = KEYS.has(keyRaw as VoicemailGreetingKey)
          ? (keyRaw as VoicemailGreetingKey)
          : resolveVoicemailGreetingKey(keyRaw);
        const sig = url.searchParams.get("sig");

        if (!verifySusanPromptSig(brand, key, sig)) {
          return new Response("Forbidden", { status: 403 });
        }

        const text = voicemailGreetingText(brand, key);
        const cacheKey = `susan-vm:${brand}:${key}:${text}`;
        const cached = getCachedTts(cacheKey);
        if (cached) {
          return new Response(cached, {
            headers: {
              "Content-Type": "audio/mpeg",
              "Cache-Control": "public, max-age=86400",
              "X-TTS-Cache": "hit",
              "X-TTS-Voice": SUSAN_AZURE_VOICE,
              "X-Voice-Brand": brand,
            },
          });
        }

        try {
          const audio = await synthesizeSpeech(text);
          setCachedTts(cacheKey, audio);
          return new Response(audio, {
            headers: {
              "Content-Type": "audio/mpeg",
              "Cache-Control": "public, max-age=86400",
              "X-TTS-Cache": "miss",
              "X-TTS-Voice": SUSAN_AZURE_VOICE,
              "X-Voice-Brand": brand,
            },
          });
        } catch (e) {
          console.error("Susan voicemail TTS failed", e);
          return new Response(e instanceof Error ? e.message : "TTS failed", { status: 502 });
        }
      },
    },
  },
});
