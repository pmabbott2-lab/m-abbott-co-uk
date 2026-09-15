import { createFileRoute } from "@tanstack/react-router";
import { buildDialDoneTwiml } from "@/lib/telephony-routing.server";

/** After an inbound Dial finishes (answered, busy, no-answer, failed, or machine). */
export const Route = createFileRoute("/api/twilio/voice/inbound-dial-done")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  let dialCallStatus = url.searchParams.get("DialCallStatus");
  let answeredBy = url.searchParams.get("AnsweredBy");
  const noAnswer = url.searchParams.get("noAnswer");
  const personal = url.searchParams.get("personal");
  const fallback = url.searchParams.get("fallback");
  const reason = url.searchParams.get("reason");
  const step = url.searchParams.get("step");
  const nextNumbers = url.searchParams.get("nextNumbers");

  if (request.method === "POST") {
    try {
      const form = await request.formData();
      dialCallStatus = String(form.get("DialCallStatus") ?? dialCallStatus ?? "");
      answeredBy = String(form.get("AnsweredBy") ?? answeredBy ?? "");
    } catch {
      /* ignore */
    }
  }

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
