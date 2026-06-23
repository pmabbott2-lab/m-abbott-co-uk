import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  prompt: z.string().min(1).max(8000),
  model: z.string().optional(),
});

// Example server function calling OpenAI directly with the user's key.
// The key stays server-side; the client only sees the resulting text.
export const openAIChat = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }) => {
    const { openAIFetch } = await import("./openai.server");
    const res = await openAIFetch("/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: data.model ?? "gpt-4o-mini",
        messages: [{ role: "user", content: data.prompt }],
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`OpenAI request failed (${res.status}): ${errText}`);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return { text: json.choices?.[0]?.message?.content ?? "" };
  });
