import { createFileRoute } from "@tanstack/react-router";

const POLL_INTERVAL_MS = 1200;
const POLL_TIMEOUT_MS = 60_000;

function didAuthHeader(key: string) {
  const trimmed = key.trim();
  if (trimmed.toLowerCase().startsWith("basic ") || trimmed.toLowerCase().startsWith("bearer ")) {
    return trimmed;
  }
  // D-ID API keys are usually base64 of email:secret. Use Basic.
  return `Basic ${trimmed}`;
}

export const Route = createFileRoute("/api/talking-head")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.DID_API_KEY;
        if (!apiKey) return new Response("DID_API_KEY not configured", { status: 500 });

        let text = "";
        try {
          const body = (await request.json()) as { text?: string };
          text = (body.text ?? "").trim();
        } catch {
          return new Response("Bad request", { status: 400 });
        }
        if (!text || text.length > 4000) return new Response("Bad request", { status: 400 });

        // Get a short-lived signed URL for Susan's photo so D-ID can fetch it.
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: signed, error: signErr } = await supabaseAdmin.storage
          .from("avatars")
          .createSignedUrl("susan.png", 60 * 60);
        if (signErr || !signed?.signedUrl) {
          return new Response(`Avatar image unavailable: ${signErr?.message ?? "unknown"}`, { status: 500 });
        }

        const authHeader = didAuthHeader(apiKey);

        // Create the talk
        const createRes = await fetch("https://api.d-id.com/talks", {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            source_url: signed.signedUrl,
            script: {
              type: "text",
              input: text,
              provider: {
                type: "microsoft",
                voice_id: "en-GB-SoniaNeural",
              },
            },
            config: { stitch: true, fluent: true },
          }),
        });
        if (!createRes.ok) {
          const t = await createRes.text().catch(() => "");
          return new Response(`D-ID create failed: ${t}`, { status: createRes.status });
        }
        const { id } = (await createRes.json()) as { id: string };
        if (!id) return new Response("D-ID returned no id", { status: 502 });

        // Poll for completion
        const started = Date.now();
        while (Date.now() - started < POLL_TIMEOUT_MS) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          const pollRes = await fetch(`https://api.d-id.com/talks/${id}`, {
            headers: { Authorization: authHeader, Accept: "application/json" },
          });
          if (!pollRes.ok) {
            const t = await pollRes.text().catch(() => "");
            return new Response(`D-ID poll failed: ${t}`, { status: pollRes.status });
          }
          const data = (await pollRes.json()) as { status: string; result_url?: string; error?: unknown };
          if (data.status === "done" && data.result_url) {
            return Response.json({ url: data.result_url });
          }
          if (data.status === "error" || data.status === "rejected") {
            return new Response(`D-ID failed: ${JSON.stringify(data.error ?? data.status)}`, { status: 502 });
          }
        }
        return new Response("D-ID timed out", { status: 504 });
      },
    },
  },
});
