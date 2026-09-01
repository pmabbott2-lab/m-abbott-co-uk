import { createFileRoute } from "@tanstack/react-router";
import { fetchMarketRatesSnapshot } from "@/lib/market-rates.server";

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
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, ngrok-skip-browser-warning",
    Vary: "Origin",
  };
}

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
  return Response.json(body, { status, headers: corsHeaders(origin) });
}

export const Route = createFileRoute("/api/calculator/market-rates")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        const origin = request.headers.get("Origin");
        if (!isAllowedOrigin(origin)) {
          return new Response(null, { status: 204 });
        }
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      },
      GET: async ({ request }) => {
        const origin = request.headers.get("Origin");
        try {
          const result = await fetchMarketRatesSnapshot();
          return jsonResponse(result, 200, origin);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Could not load rates.";
          return jsonResponse({ ok: false, error: message }, 500, origin);
        }
      },
    },
  },
});
