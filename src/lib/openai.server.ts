// Server-only OpenAI API access.
// OPENAI_API_KEY is read from process.env at call time and never sent to the browser.

export const OPENAI_BASE_URL = "https://api.openai.com/v1";

export const OPENAI_CHAT_MODEL = "gpt-4o-mini";
export const OPENAI_TTS_MODEL = "gpt-4o-mini-tts";
export const OPENAI_STT_MODEL = "gpt-4o-mini-transcribe";
export const OPENAI_STT_FALLBACK_MODEL = "whisper-1";

/** Warm British English female guide — OpenAI voices: coral, sage, nova are female-optimised. */
export const SUSAN_TTS_VOICE = "sage";
export const SUSAN_TTS_INSTRUCTIONS =
  "You are Susan, a warm, friendly British woman with a natural UK accent, guiding someone " +
  "through their mortgage fact-find. Speak conversationally and personally — like a real adviser " +
  "having a relaxed, encouraging chat with a client you genuinely want to help. Sound human and " +
  "spontaneous, never robotic, flat or like you're reading a script. Use natural rhythm and gentle, " +
  "expressive intonation: a little warmth and lift on key words, small natural pauses at commas and " +
  "full stops, and an upbeat, reassuring tone. Keep it clear and professional at a calm, natural pace.";

export function getOpenAIKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not configured");
  return key;
}

export async function openAIFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${getOpenAIKey()}`);
  if (!headers.has("Content-Type") && init.body && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${OPENAI_BASE_URL}${path}`, { ...init, headers });
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function chatCompletion(opts: {
  model?: string;
  messages: ChatMessage[];
  response_format?: { type: "json_object" };
  temperature?: number;
}): Promise<string> {
  const res = await openAIFetch("/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model ?? OPENAI_CHAT_MODEL,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.3,
      ...(opts.response_format ? { response_format: opts.response_format } : {}),
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`OpenAI chat ${res.status}: ${txt}`);
  }
  const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return json.choices[0]?.message?.content ?? "";
}

export async function synthesizeSpeech(text: string): Promise<ArrayBuffer> {
  const res = await openAIFetch("/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_TTS_MODEL,
      input: text,
      voice: SUSAN_TTS_VOICE,
      instructions: SUSAN_TTS_INSTRUCTIONS,
      response_format: "mp3",
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`OpenAI TTS ${res.status}: ${txt}`);
  }
  return res.arrayBuffer();
}

export async function transcribeAudio(file: File): Promise<string> {
  const attempt = async (model: string) => {
    const form = new FormData();
    form.append("model", model);
    form.append("file", file, file.name || "recording.webm");
    form.append("language", "en");
    form.append(
      "prompt",
      "British English mortgage fact-find interview. Names, addresses, income, employment, property details.",
    );

    const res = await openAIFetch("/audio/transcriptions", {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`OpenAI STT ${res.status}: ${txt}`);
    }
    const json = (await res.json()) as { text?: string };
    return json.text ?? "";
  };

  try {
    return await attempt(OPENAI_STT_MODEL);
  } catch (primaryError) {
    try {
      return await attempt(OPENAI_STT_FALLBACK_MODEL);
    } catch {
      throw primaryError;
    }
  }
}
