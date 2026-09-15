import { createFileRoute } from "@tanstack/react-router";
import { handleAmdStatusCallback } from "@/lib/telephony-routing.server";

/** Async AMD: Vodafone (or other carrier) voicemail answered — redirect caller to Hub Susan. */
export const Route = createFileRoute("/api/twilio/voice/amd-status")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  let callSid = url.searchParams.get("CallSid");
  let parentCallSid = url.searchParams.get("ParentCallSid");
  let answeredBy = url.searchParams.get("AnsweredBy");

  if (request.method === "POST") {
    try {
      const form = await request.formData();
      callSid = String(form.get("CallSid") ?? callSid ?? "");
      parentCallSid = String(form.get("ParentCallSid") ?? parentCallSid ?? "");
      answeredBy = String(form.get("AnsweredBy") ?? answeredBy ?? "");
    } catch {
      /* ignore */
    }
  }

  try {
    await handleAmdStatusCallback({ callSid, parentCallSid, answeredBy });
  } catch (e) {
    console.error("[telephony] amd-status handler failed", e);
  }

  return new Response("ok", { status: 200 });
}
