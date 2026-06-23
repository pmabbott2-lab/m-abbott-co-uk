// Server-only helper for OpenAI API access.
// OPENAI_API_KEY is read from process.env at call time and never sent to the browser.

export function getOpenAIKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not configured");
  return key;
}

export const OPENAI_BASE_URL = "https://api.openai.com/v1";

export async function openAIFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${getOpenAIKey()}`);
  if (!headers.has("Content-Type") && init.body && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${OPENAI_BASE_URL}${path}`, { ...init, headers });
}
