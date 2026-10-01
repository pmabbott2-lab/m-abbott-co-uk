import { createFileRoute } from "@tanstack/react-router";
import { buildInboundTwiml, voicemailResponseTwiml } from "@/lib/telephony-routing.server";
import { withTwilioSignature, type TwilioWebhookContext } from "@/lib/twilio-webhook.server";

/** Twilio hits this when someone dials the firm landline. */
export const Route = createFileRoute("/api/twilio/voice/inbound")({
  server: {
    handlers: {
      GET: withTwilioSignature(handle),
      POST: withTwilioSignature(handle),
    },
  },
});

async function handle({ request, params }: TwilioWebhookContext): Promise<Response> {
  try {
    const from = new URL(request.url).searchParams.get("From") || params.get("From") || "";
    const twiml = await buildInboundTwiml(from || "+440000000000");
    return xml(twiml);
  } catch (e) {
    console.error("inbound voice routing failed", e);
    return xml(await voicemailResponseTwiml("default"));
  }
}

function xml(body: string): Response {
  return new Response(body, { headers: { "Content-Type": "text/xml" } });
}
