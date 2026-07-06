import { createFileRoute } from "@tanstack/react-router";
import { clientDialCustomerTwiml, getVoiceConfig, voiceWebhookUrl } from "@/lib/voice.server";
import { normaliseUkPhone } from "@/lib/sms.server";

/** Twilio fetches this when the browser softphone places an outbound call. */
export const Route = createFileRoute("/api/twilio/voice/client-outbound")({
  server: {
    handlers: {
      GET: async ({ request }) => twimlForRequest(request),
      POST: async ({ request }) => twimlForRequest(request),
    },
  },
});

async function twimlForRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  let form: FormData | null = null;
  if (request.method === "POST") {
    try {
      form = await request.formData();
    } catch {
      form = null;
    }
  }

  const get = (key: string) => String(form?.get(key) ?? url.searchParams.get(key) ?? "");

  let customerPhone = get("To");
  const callId = get("CallId") || get("callId");

  if (callId && !customerPhone) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("phone_calls")
      .select("to_number")
      .eq("id", callId)
      .maybeSingle();
    customerPhone = row?.to_number ?? "";
  }

  if (!customerPhone) {
    return twiml('<Response><Say>No customer number provided for this call.</Say></Response>');
  }

  const { fromNumber } = getVoiceConfig();
  const body = clientDialCustomerTwiml({
    customerPhone: normaliseUkPhone(customerPhone),
    callId: callId || "unknown",
    callerId: fromNumber,
    recordCallback: voiceWebhookUrl("/api/twilio/voice/recording"),
    statusCallback: voiceWebhookUrl("/api/twilio/voice/status"),
  });
  return twiml(body);
}

function twiml(body: string): Response {
  return new Response(body, { headers: { "Content-Type": "text/xml" } });
}
