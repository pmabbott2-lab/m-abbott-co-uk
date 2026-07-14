import { createFileRoute } from "@tanstack/react-router";
import { getServerAppOrigin } from "@/lib/app-url.server";

/**
 * Completes Microsoft OAuth and stores Teams calendar tokens on the advisor profile.
 * Redirect URI to register in Entra: {APP_URL}/api/teams/callback
 */
export const Route = createFileRoute("/api/teams/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = getServerAppOrigin(request);
        const error = url.searchParams.get("error");
        const errorDesc = url.searchParams.get("error_description");
        if (error) {
          const msg = encodeURIComponent(errorDesc || error);
          return Response.redirect(`${origin}/diary?teams=error&reason=${msg}`, 302);
        }

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) {
          return Response.redirect(
            `${origin}/diary?teams=error&reason=${encodeURIComponent("Missing code")}`,
            302,
          );
        }

        try {
          const { verifyOAuthState, completeTeamsOAuth } = await import(
            "@/lib/teams-calendar.server"
          );
          const userId = verifyOAuthState(state);
          await completeTeamsOAuth(code, userId, request);
          return Response.redirect(`${origin}/diary?teams=linked`, 302);
        } catch (e) {
          const msg = encodeURIComponent(
            e instanceof Error ? e.message : "Could not link Teams calendar",
          );
          return Response.redirect(`${origin}/diary?teams=error&reason=${msg}`, 302);
        }
      },
    },
  },
});
