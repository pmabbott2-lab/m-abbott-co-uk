import { createFileRoute } from "@tanstack/react-router";
import { handleInboundVoicemailWebhook } from "@/lib/inbound-voicemail.server";
import { withTwilioSignature } from "@/lib/twilio-webhook.server";

/** Twilio hits this after the caller finishes leaving a voicemail. */
export const Route = createFileRoute("/api/twilio/voice/voicemail-done")({
  server: {
    handlers: {
      POST: withTwilioSignature(async ({ params: form }) => {
        await handleInboundVoicemailWebhook({
          callSid: String(form.get("CallSid") ?? ""),
          from: String(form.get("From") ?? ""),
          recordingUrl: String(form.get("RecordingUrl") ?? "") || null,
          recordingSid: String(form.get("RecordingSid") ?? "") || null,
        });

        return new Response(
          '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
          { headers: { "Content-Type": "text/xml" } },
        );
      }),
    },
  },
});
