import { createFileRoute } from "@tanstack/react-router";
import { buildDialDoneTwiml } from "@/lib/telephony-routing.server";
import { withTwilioSignature, type TwilioWebhookContext } from "@/lib/twilio-webhook.server";

/** After an inbound Dial finishes (answered, busy, no-answer, failed, or machine). */
export const Route = createFileRoute("/api/twilio/voice/inbound-dial-done")({
  server: {
    handlers: {
      GET: withTwilioSignature(handle),
      POST: withTwilioSignature(handle),
    },
  },
});

async function handle({ request, params }: TwilioWebhookContext): Promise<Response> {
  const url = new URL(request.url);
  const dialCallStatus = params.get("DialCallStatus") ?? url.searchParams.get("DialCallStatus");
  const answeredBy = params.get("AnsweredBy") ?? url.searchParams.get("AnsweredBy");
  const noAnswer = url.searchParams.get("noAnswer");
  const personal = url.searchParams.get("personal");
  const fallback = url.searchParams.get("fallback");
  const reason = url.searchParams.get("reason");
  const step = url.searchParams.get("step");
  const nextNumbers = url.searchParams.get("nextNumbers");

  const twiml = await buildDialDoneTwiml({
    dialCallStatus,
    answeredBy,
    noAnswer,
    personal,
    fallback,
    reason,
    step,
    nextNumbers,
  });
  return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
}
