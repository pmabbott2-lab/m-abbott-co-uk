// Server-only Azure Neural TTS for Susan (interview avatar).
// AZURE_SPEECH_KEY / AZURE_SPEECH_REGION are never sent to the browser.
// Same British lock as the marketing films: en-GB-SoniaNeural, uksouth.
// Do not apply film atempo here — interview lines stay natural pace.

import { escapeXml } from "@/lib/xml-escape.server";

export const SUSAN_AZURE_VOICE = "en-GB-SoniaNeural";
export const SUSAN_AZURE_LANG = "en-GB";

function getAzureSpeechConfig(): { key: string; region: string } {
  const key = process.env.AZURE_SPEECH_KEY?.trim();
  const region = (process.env.AZURE_SPEECH_REGION?.trim() || "uksouth").toLowerCase();
  if (!key) throw new Error("AZURE_SPEECH_KEY is not configured");
  return { key, region };
}

/** Conversational SSML: British Sonia, slightly slower, short pauses at sentence breaks. */
function toSsml(text: string): string {
  const cleaned = text.trim().replace(/\s+/g, " ");
  const parts = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const body =
    parts.length > 0
      ? parts.map((p) => `${escapeXml(p)}<break time="280ms"/>`).join("")
      : escapeXml(cleaned);

  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${SUSAN_AZURE_LANG}'>` +
    `<voice name='${SUSAN_AZURE_VOICE}'>` +
    `<prosody rate='-5%'>${body}</prosody>` +
    `</voice></speak>`
  );
}

/**
 * Synthesize Susan's line as MP3 for /api/tts.
 * Output matches what Avatar already decodes for Simli lip-sync (MP3 → PCM 16 kHz mono).
 */
export async function synthesizeSpeech(text: string): Promise<ArrayBuffer> {
  const { isOpenAiEnvironmentAllowed } = await import("@/lib/app-environment.server");
  // Azure TTS is part of the paid Susan/AI stack — same staging opt-in as OpenAI.
  if (!isOpenAiEnvironmentAllowed()) {
    throw new Error("Speech synthesis is disabled in this environment.");
  }
  const { key, region } = getAzureSpeechConfig();
  const ssml = toSsml(text);
  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-160kbitrate-mono-mp3",
      "User-Agent": "MortgageEasySusanSonia",
    },
    body: ssml,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Azure TTS ${res.status}: ${txt.slice(0, 300)}`);
  }
  return res.arrayBuffer();
}
