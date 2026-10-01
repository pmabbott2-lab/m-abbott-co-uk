import { createFileRoute } from "@tanstack/react-router";
import { handleAmdStatusCallback } from "@/lib/telephony-routing.server";
import { withTwilioSignature, type TwilioWebhookContext } from "@/lib/twilio-webhook.server";

/** Async AMD: Vodafone (or other carrier) voicemail answered — redirect caller to Hub Susan. */
export const Route = createFileRoute("/api/twilio/voice/amd-status")({
  server: {
    handlers: {
      GET: withTwilioSignature(handle),
      POST: withTwilioSignature(handle),
    },
  },
});

async function handle({ request, params }: TwilioWebhookContext): Promise<Response> {
  const url = new URL(request.url);
  const get = (key: string) => params.get(key) ?? url.searchParams.get(key);
  const callSid = get("CallSid");
  const parentCallSid = get("ParentCallSid");
  const answeredBy = get("AnsweredBy");

  try {
    await handleAmdStatusCallback({ callSid, parentCallSid, answeredBy });
  } catch (e) {
    console.error("[telephony] amd-status handler failed", e);
  }

  return new Response("ok", { status: 200 });
}
