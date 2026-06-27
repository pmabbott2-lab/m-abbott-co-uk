import { createFileRoute } from "@tanstack/react-router";
import { requireApiAuth } from "@/lib/api-auth.server";
import { createSimliSessionToken, getSimliConfig } from "@/lib/simli.server";

/**
 * Mints a short-lived Simli session token for the realtime avatar.
 * Mirrors the auth pattern in `src/routes/api/tts.ts` (requireApiAuth). The
 * SIMLI_API_KEY stays server-side; the browser only receives the session token.
 *
 * Responses:
 *   200 { session_token }  — ready to start a Simli WebRTC session
 *   401                    — not authenticated
 *   501                    — realtime avatar not configured (client falls back)
 *   502                    — upstream Simli error (client falls back)
 */
export const Route = createFileRoute("/api/avatar-token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireApiAuth(request);
        if (!auth.ok) return auth.response;

        if (!getSimliConfig()) {
          return new Response("Realtime avatar not configured", { status: 501 });
        }

        try {
          const token = await createSimliSessionToken();
          return new Response(JSON.stringify(token), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Simli token failed";
          return new Response(msg, { status: 502 });
        }
      },
    },
  },
});
