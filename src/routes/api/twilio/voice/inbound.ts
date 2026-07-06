import { createFileRoute } from "@tanstack/react-router";
import { inboundVoicemailTwiml, voiceWebhookUrl } from "@/lib/voice.server";

export const Route = createFileRoute("/api/twilio/voice/inbound")({
  server: {
    handlers: {
      GET: async () => twiml(voicemailTwiml()),
      POST: async () => twiml(voicemailTwiml()),
    },
  },
});

function voicemailTwiml(): string {
  const recordingCallback = voiceWebhookUrl("/api/twilio/voice/recording");
  const voicemailDoneUrl = voiceWebhookUrl("/api/twilio/voice/voicemail-done");
  return inboundVoicemailTwiml({ recordingCallback, voicemailDoneUrl });
}

function twiml(body: string): Response {
  return new Response(body, { headers: { "Content-Type": "text/xml" } });
}
