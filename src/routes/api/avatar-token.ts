import { createFileRoute } from "@tanstack/react-router";
import { requireApiAuth } from "@/lib/api-auth.server";
import { createSimliSessionToken, getSimliConfig } from "@/lib/simli.server";
import {
  readTenantHints,
  requireSusanApiAccess,
  susanDeniedResponse,
} from "@/lib/susan-feature-guard.server";

/**
 * Mints a short-lived Simli session token for the realtime avatar.
 * G5: requires susan_ai_journey for the resolved tenant.
 */
export const Route = createFileRoute("/api/avatar-token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireApiAuth(request);
        if (!auth.ok) return auth.response;

        let body: Record<string, unknown> | null = null;
        try {
          body = (await request.clone().json()) as Record<string, unknown>;
        } catch {
          body = null;
        }
        const hints = readTenantHints(request, body);
        try {
          await requireSusanApiAccess({
            actingUserId: auth.userId,
            tenantSlug: hints.tenantSlug,
            tenantId: hints.tenantId,
            featureKey: "susan_ai_journey",
          });
        } catch (e) {
          return susanDeniedResponse(e);
        }

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
