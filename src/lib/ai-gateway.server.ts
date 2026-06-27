// Backward-compatible re-exports — all AI now goes direct to OpenAI.
export {
  chatCompletion,
  type ChatMessage,
} from "./openai.server";
