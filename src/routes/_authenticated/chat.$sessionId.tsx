import { createFileRoute } from "@tanstack/react-router";
import { ChatInterview } from "@/components/ChatInterview";

export const Route = createFileRoute("/_authenticated/chat/$sessionId")({
  component: ChatPage,
});

function ChatPage() {
  const { sessionId } = Route.useParams();
  return <ChatInterview sessionId={sessionId} />;
}
