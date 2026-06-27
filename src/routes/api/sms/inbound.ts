import { createFileRoute } from "@tanstack/react-router";
import { isTwilioConfigured } from "@/lib/sms.server";

export const Route = createFileRoute("/api/sms/inbound")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const form = await request.formData();
        const from = String(form.get("From") ?? "");
        const to = String(form.get("To") ?? "");
        const body = String(form.get("Body") ?? "").trim();
        const sid = String(form.get("MessageSid") ?? "");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin.from("sms_messages").insert({
          direction: "inbound",
          from_number: from,
          to_number: to,
          body,
          twilio_sid: sid || null,
        });

        const baseUrl = process.env.APP_BASE_URL ?? "https://your-domain.com";
        const reply =
          body.toUpperCase().includes("BOOK") || body.toUpperCase().includes("APPOINTMENT")
            ? `Book your mortgage appointment here: ${baseUrl}/book`
            : `Thanks for your message. To book an appointment visit ${baseUrl}/book or call us.`;

        if (!isTwilioConfigured()) {
          return new Response("<Response></Response>", {
            headers: { "Content-Type": "text/xml" },
          });
        }

        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(reply)}</Message></Response>`,
          { headers: { "Content-Type": "text/xml" } },
        );
      },
    },
  },
});

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
