import { createFileRoute, useParams } from "@tanstack/react-router";
import { ChatInterview } from "@/components/ChatInterview";

export const Route = createFileRoute("/_authenticated/chat/$sessionId")({
  component: ChatPage,
});

export function ChatPage() {
  const { sessionId } = useParams({ strict: false }) as { sessionId: string };
  return <ChatInterview sessionId={sessionId} />;
}
