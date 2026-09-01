import { createFileRoute } from "@tanstack/react-router";
import {
  calculatorLeadInput,
  captureIntroducerCalculatorLead,
} from "@/lib/introducer-calculator-lead.server";

function isAllowedOrigin(origin: string | null): origin is string {
  if (!origin) return false;
  if (origin === "http://127.0.0.1:8081" || origin === "http://localhost:8081") return true;
  if (/^https:\/\/[\w-]+\.ngrok-free\.dev$/.test(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    if (host === "localhost" || host === "127.0.0.1") return true;
  } catch {
    return false;
  }
  return false;
}

function corsHeaders(origin: string | null): HeadersInit {
  if (!isAllowedOrigin(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, ngrok-skip-browser-warning",
    Vary: "Origin",
  };
}

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
  return Response.json(body, { status, headers: corsHeaders(origin) });
}

export const Route = createFileRoute("/api/introducer/calculator-lead")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        const origin = request.headers.get("Origin");
        if (!isAllowedOrigin(origin)) {
          return new Response(null, { status: 204 });
        }
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      },
      POST: async ({ request }) => {
        const origin = request.headers.get("Origin");
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return jsonResponse({ ok: false, error: "Invalid request body" }, 400, origin);
        }

        try {
          calculatorLeadInput.parse(body);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Please check your details and try again.";
          return jsonResponse({ ok: false, error: message }, 400, origin);
        }

        try {
          const result = await captureIntroducerCalculatorLead(body);
          return jsonResponse(result, 200, origin);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Something went wrong.";
          const status = message.includes("Too many requests") ? 429 : 400;
          return jsonResponse({ ok: false, error: message }, status, origin);
        }
      },
    },
  },
});
