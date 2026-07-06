import { createFileRoute } from "@tanstack/react-router";

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
        const form = await request.formData();
        const callSid = String(form.get("CallSid") ?? "");
        const dialStatus = String(form.get("DialCallStatus") ?? "");
        const callStatus = String(form.get("CallStatus") ?? dialStatus);
        const duration = Number(form.get("CallDuration") ?? form.get("DialCallDuration") ?? 0);
        const callId = String(form.get("CallId") ?? form.get("callId") ?? "");

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

        return new Response("ok");
      },
    },
  },
});
