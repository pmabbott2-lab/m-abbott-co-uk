/** Helpers for the admin storage API (Cloudflare KV binding ADMIN_KV). Only used behind adminGuard. */

const MAX_BODY_BYTES = 200 * 1024;

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store, private" },
  });
}

export const fail = (status, error) => json({ ok: false, error }, status);

export function kvOf(env) {
  return env && env.ADMIN_KV && typeof env.ADMIN_KV.get === "function" ? env.ADMIN_KV : null;
}

/** Same-origin JSON writes only (Access cookies would otherwise ride along on cross-site requests). */
export async function readJsonBody(request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) throw Object.assign(new Error("Cross-origin request refused"), { status: 403 });
  if (!/^application\/json\b/i.test(request.headers.get("content-type") || "")) {
    throw Object.assign(new Error("Expected JSON"), { status: 415 });
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw Object.assign(new Error("Request too large"), { status: 413 });
  try {
    return JSON.parse(text);
  } catch (_err) {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}

export function errorResponse(err) {
  return fail(err && err.status ? err.status : 400, (err && err.message) || "Request failed");
}
