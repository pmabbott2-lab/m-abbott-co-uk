import { openAIFetch } from "@/lib/openai.server";

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
      model: opts.model ?? "gpt-4o-mini",
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
