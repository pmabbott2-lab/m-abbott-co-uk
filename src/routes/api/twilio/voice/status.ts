import { createFileRoute } from "@tanstack/react-router";
import { syncRecordingFromTwilioCall } from "@/lib/phone-call-recording.server";

const STATUS_MAP: Record<string, string> = {
  queued: "initiated",
  initiated: "initiated",
  ringing: "ringing",
  "in-progress": "in_progress",
  completed: "completed",
  busy: "busy",
  "no-answer": "no_answer",
  failed: "failed",
  canceled: "canceled",
};

export const Route = createFileRoute("/api/twilio/voice/status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const form = await request.formData();
        const callSid = String(form.get("CallSid") ?? "");
        const dialCallSid = String(form.get("DialCallSid") ?? "");
        const dialStatus = String(form.get("DialCallStatus") ?? "");
        const callStatus = String(form.get("CallStatus") ?? dialStatus);
        const duration = Number(form.get("CallDuration") ?? form.get("DialCallDuration") ?? 0);
        const callId =
          url.searchParams.get("callId") ||
          String(form.get("CallId") ?? form.get("callId") ?? "");

        if (!callSid && !callId) return new Response("ok");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const mapped = STATUS_MAP[callStatus] ?? "in_progress";
        const patch: Record<string, unknown> = { status: mapped };
        if (callSid) patch.twilio_call_sid = callSid;
        if (mapped === "completed") {
          patch.ended_at = new Date().toISOString();
          if (duration > 0) patch.duration_seconds = duration;
        }

        if (callId) {
          await supabaseAdmin.from("phone_calls").update(patch).eq("id", callId);
        } else if (callSid) {
          await supabaseAdmin.from("phone_calls").update(patch).eq("twilio_call_sid", callSid);
        }

        // Backup: pull recording from Twilio when the dial leg completes (outbound softphone).
        if (mapped === "completed" && (callSid || dialCallSid)) {
          const hint = callId || null;
          void syncRecordingFromTwilioCall(callSid, hint).catch((e) =>
            console.error("[status] recording sync failed (parent)", e),
          );
          if (dialCallSid && dialCallSid !== callSid) {
            void syncRecordingFromTwilioCall(dialCallSid, hint).catch((e) =>
              console.error("[status] recording sync failed (dial leg)", e),
            );
          }
        }

        return new Response("ok");
      },
    },
  },
});
