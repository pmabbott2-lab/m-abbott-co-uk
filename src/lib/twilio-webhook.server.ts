// Server-only: trust boundary for Twilio-originated webhook requests (X-Twilio-Signature).

import twilio from "twilio";

const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;

export type TwilioWebhookContext = {
  request: Request;
  /** Form parameters covered by the verified signature (empty for GET). */
  params: URLSearchParams;
};

type TwilioWebhookVerification =
  | { ok: true; params: URLSearchParams }
  | { ok: false; response: Response };

function forbidden(): Response {
  return new Response("Forbidden", { status: 403, headers: { "Content-Type": "text/plain" } });
}

/**
 * The URL Twilio signed: the configured public origin (APP_BASE_URL, the same base used to
 * build every callback URL handed to Twilio) plus the request path and query as received.
 * Host, X-Forwarded-*, and Origin headers are never consulted.
 */
export function twilioWebhookVerificationUrl(request: Request): string | null {
  const configured = process.env.APP_BASE_URL?.trim();
  if (!configured) return null;
  let base: URL;
  let received: URL;
  try {
    base = new URL(configured);
    received = new URL(request.url);
  } catch {
    return null;
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") return null;
  if (base.username || base.password) return null;
  return `${base.origin}${received.pathname}${received.search}`;
}

function toSignatureParams(params: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    out[key] = values.length === 1 ? values[0]! : values;
  }
  return out;
}

async function readSignedFormParams(request: Request): Promise<URLSearchParams | null> {
  if (request.method === "GET" || request.method === "HEAD") return new URLSearchParams();

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BODY_BYTES) return null;

  const body = await request.text();
  if (body.length > MAX_WEBHOOK_BODY_BYTES) return null;
  if (!body) return new URLSearchParams();

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("application/x-www-form-urlencoded")) return null;
  return new URLSearchParams(body);
}

/** MISSING_SIGNATURE=DENY, INVALID_SIGNATURE=DENY, VALID_SIGNATURE=ALLOW. Consumes the body. */
export async function verifyTwilioWebhook(request: Request): Promise<TwilioWebhookVerification> {
  try {
    const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
    const signature = request.headers.get("x-twilio-signature")?.trim();
    const url = twilioWebhookVerificationUrl(request);
    if (!authToken || !signature || !url) return { ok: false, response: forbidden() };

    const params = await readSignedFormParams(request);
    if (!params) return { ok: false, response: forbidden() };

    if (!twilio.validateRequest(authToken, signature, url, toSignatureParams(params))) {
      return { ok: false, response: forbidden() };
    }
    return { ok: true, params };
  } catch {
    return { ok: false, response: forbidden() };
  }
}

/** Route handler wrapper: route logic runs only for requests carrying a valid Twilio signature. */
export function withTwilioSignature(
  handler: (ctx: TwilioWebhookContext) => Promise<Response>,
): (ctx: { request: Request }) => Promise<Response> {
  return async ({ request }) => {
    const verified = await verifyTwilioWebhook(request);
    if (!verified.ok) return verified.response;
    return handler({ request, params: verified.params });
  };
}
