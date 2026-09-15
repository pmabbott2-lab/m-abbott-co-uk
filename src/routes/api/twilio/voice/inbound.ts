import { createFileRoute } from "@tanstack/react-router";
import { buildInboundTwiml, voicemailResponseTwiml } from "@/lib/telephony-routing.server";

/** Twilio hits this when someone dials the firm landline. */
export const Route = createFileRoute("/api/twilio/voice/inbound")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});

async function handle(request: Request): Promise<Response> {
  try {
    const from = await readFrom(request);
    const twiml = await buildInboundTwiml(from || "+440000000000");
    return xml(twiml);
  } catch (e) {
    console.error("inbound voice routing failed", e);
    return xml(await voicemailResponseTwiml("default"));
  }
}

async function readFrom(request: Request): Promise<string> {
  const url = new URL(request.url);
  const q = url.searchParams.get("From");
  if (q) return q;
  if (request.method === "GET") return "";
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    const form = await request.formData();
    return String(form.get("From") ?? "");
  }
  return "";
}

function xml(body: string): Response {
  return new Response(body, { headers: { "Content-Type": "text/xml" } });
}
