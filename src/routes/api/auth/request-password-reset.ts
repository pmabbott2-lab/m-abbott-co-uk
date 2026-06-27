import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getServerPasswordResetUrl } from "@/lib/app-url.server";

const SUPABASE_REDIRECT_HINT =
  "Add your app URL (e.g. http://localhost:8080/**) to Supabase → Authentication → URL Configuration → Redirect URLs.";

function isLocalRedirectTarget(redirectTo: string): boolean {
  try {
    const host = new URL(redirectTo).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/auth/request-password-reset")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { email?: string };
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, error: "Invalid request body" }, { status: 400 });
        }

        const email = body.email?.trim().toLowerCase();
        if (!email) {
          return Response.json({ ok: false, error: "Email is required" }, { status: 400 });
        }

        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !supabaseKey) {
          return Response.json(
            { ok: false, error: "Server Supabase configuration is missing." },
            { status: 500 },
          );
        }

        const redirectTo = getServerPasswordResetUrl(request);

        // Localhost: return a direct Supabase recovery link (no email delivery required).
        if (isLocalRedirectTarget(redirectTo)) {
          if (!serviceRoleKey) {
            return Response.json(
              {
                ok: false,
                error:
                  "Local password reset needs SUPABASE_SERVICE_ROLE_KEY in .env. Copy it from Supabase Dashboard → Settings → API, then restart npm run dev.",
              },
              { status: 500 },
            );
          }

          try {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { data, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
              type: "recovery",
              email,
              options: { redirectTo },
            });
            if (linkError) {
              return Response.json({ ok: false, error: linkError.message }, { status: 400 });
            }

            const resetLink = data.properties?.action_link;
            if (!resetLink) {
              return Response.json({ ok: false, error: "Could not generate reset link." }, { status: 500 });
            }

            const encoded = encodeURIComponent(redirectTo);
            const redirectLooksCorrect =
              resetLink.includes(encoded) || resetLink.includes(redirectTo);

            return Response.json({
              ok: true,
              redirectTo,
              mode: "direct_link",
              resetLink,
              setupHint: redirectLooksCorrect ? undefined : SUPABASE_REDIRECT_HINT,
            });
          } catch (err) {
            return Response.json(
              {
                ok: false,
                error: err instanceof Error ? err.message : "Could not generate reset link.",
              },
              { status: 500 },
            );
          }
        }

        const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
        });

        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) {
          return Response.json({ ok: false, error: error.message }, { status: 400 });
        }

        return Response.json({
          ok: true,
          redirectTo,
          mode: "email",
          setupHint: SUPABASE_REDIRECT_HINT,
        });
      },
    },
  },
});
