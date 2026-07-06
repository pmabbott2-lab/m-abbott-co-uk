import { createFileRoute } from "@tanstack/react-router";
import {
  handleInboundVoicemailWebhook,
  processVoicemailRecording,
  upsertInboundVoicemail,
} from "@/lib/inbound-voicemail.server";

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

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        let row: { id: string } | null = null;
        if (callIdFromQuery) {
          const byId = await supabaseAdmin
            .from("phone_calls")
            .select("id")
            .eq("id", callIdFromQuery)
            .maybeSingle();
          row = byId.data;
        }
        if (!row && callSid) {
          const byCall = await supabaseAdmin
            .from("phone_calls")
            .select("id")
            .eq("twilio_call_sid", callSid)
            .maybeSingle();
          row = byCall.data;
        }

        // Inbound voicemail: recording callback often arrives before voicemail-done.
        if (!row && callSid && from) {
          const upserted = await upsertInboundVoicemail({
            callSid,
            from,
            recordingUrl,
            recordingSid,
          });
          if (upserted.callId) row = { id: upserted.callId };
        }

        if (!row) {
          if (callSid && from) {
            await handleInboundVoicemailWebhook({
              callSid,
              from,
              recordingUrl,
              recordingSid,
            });
          }
          return new Response("ok");
        }

        try {
          await processVoicemailRecording(row.id, recordingUrl, recordingSid || undefined);
        } catch (e) {
          console.error("[recording] AI processing failed", e);
        }

        return new Response("ok");
      },
    },
  },
});
