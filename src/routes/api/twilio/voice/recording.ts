import { createFileRoute } from "@tanstack/react-router";
import {
  handleInboundVoicemailWebhook,
  upsertInboundVoicemail,
} from "@/lib/inbound-voicemail.server";
import {
  findPhoneCallId,
  processPhoneCallRecording,
  syncRecordingFromTwilioCall,
} from "@/lib/phone-call-recording.server";

export const Route = createFileRoute("/api/twilio/voice/recording")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const callIdFromQuery = url.searchParams.get("callId");
        const form = await request.formData();
        const recordingSid = String(form.get("RecordingSid") ?? "");
        const recordingUrl = String(form.get("RecordingUrl") ?? "");
        const callSid = String(form.get("CallSid") ?? "");
        const from = String(form.get("From") ?? "");
        const recordingStatus = String(form.get("RecordingStatus") ?? "");

        if (!recordingUrl || recordingStatus === "in-progress") {
          return new Response("ok");
        }

        let callId = await findPhoneCallId({
          callId: callIdFromQuery,
          callSid,
          recordingSid,
        });

        // Outbound browser call — recording callback may arrive before CallSid is attached.
        if (!callId && callSid && from.startsWith("client:")) {
          const synced = await syncRecordingFromTwilioCall(callSid, callIdFromQuery).catch((e) => {
            console.error("[recording] outbound sync failed", e);
            return false;
          });
          if (synced) return new Response("ok");
        }

        // Inbound voicemail: recording callback often arrives before voicemail-done.
        if (!callId && callSid && from && !from.startsWith("client:")) {
          const upserted = await upsertInboundVoicemail({
            callSid,
            from,
            recordingUrl,
            recordingSid,
          });
          callId = upserted.callId;
        }

        if (!callId) {
          if (callSid && from && !from.startsWith("client:")) {
            await handleInboundVoicemailWebhook({
              callSid,
              from,
              recordingUrl,
              recordingSid,
            });
          } else {
            console.warn(
              `[recording] no phone_calls row (callSid=${callSid}, callId=${callIdFromQuery ?? ""}, from=${from})`,
            );
          }
          return new Response("ok");
        }

        try {
          await processPhoneCallRecording(callId, recordingUrl, recordingSid || undefined);
        } catch (e) {
          console.error("[recording] AI processing failed", e);
        }

        return new Response("ok");
      },
    },
  },
});
