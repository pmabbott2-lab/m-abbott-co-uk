import { createFileRoute } from "@tanstack/react-router";
import {
  estimateCalculatorRate,
  estimateRateInput,
} from "@/lib/calculator-estimate-rate.server";

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

export const Route = createFileRoute("/api/calculator/estimate-rate")({
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
          estimateRateInput.parse(body);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Please check your calculator inputs.";
          return jsonResponse({ ok: false, error: message }, 400, origin);
        }

        try {
          const result = await estimateCalculatorRate(body);
          return jsonResponse(result, 200, origin);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Could not estimate rate.";
          return jsonResponse({ ok: false, error: message }, 400, origin);
        }
      },
    },
  },
});
