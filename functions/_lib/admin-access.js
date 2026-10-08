/**
 * Server-side check for the owner-only admin area (/admin, /api/admin). Cloudflare Access is the
 * front gate; this verifies Access's signed token on every request and fails closed if anything is
 * missing or wrong.
 *
 * Pages environment variables (production and preview):
 *   ACCESS_TEAM_DOMAIN  e.g. "<team>.cloudflareaccess.com"
 *   ACCESS_ADMIN_AUD    Application Audience (AUD) tag of the admin Access application only
 *   ADMIN_EMAILS        comma-separated allow-list
 */

const CERTS_TTL_MS = 60 * 60 * 1000;
const CERTS_MIN_REFETCH_MS = 30 * 1000;
const CLOCK_SKEW_S = 60;
const TEAM_DOMAIN_RE = /^[a-z0-9-]+\.cloudflareaccess\.com$/;

export const SECURITY_HEADERS = {
  "cache-control": "no-store, private",
  "x-robots-tag": "noindex, nofollow, noarchive",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
    "font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

export function readConfig(env) {
  const teamDomain = String((env && env.ACCESS_TEAM_DOMAIN) || "")
    .trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const audience = String((env && env.ACCESS_ADMIN_AUD) || "").trim();
  const emails = new Set(
    String((env && env.ADMIN_EMAILS) || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean),
  );
  if (!TEAM_DOMAIN_RE.test(teamDomain) || !audience || emails.size === 0) return null;
  return { teamDomain, audience, emails };
}

function b64urlBytes(part) {
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const b64urlJson = (part) => JSON.parse(new TextDecoder().decode(b64urlBytes(part)));

/**
 * Verifies an Access JWT. getKey(kid) must resolve to an RS256 verify CryptoKey or null.
 * Returns { ok: true, email, claims } or { ok: false, reason }.
 */
export async function verifyAccessJwt(token, { teamDomain, audience, getKey, now = Date.now() }) {
  try {
    if (typeof token !== "string" || token.length > 8192) return { ok: false, reason: "malformed" };
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return { ok: false, reason: "malformed" };
    const header = b64urlJson(parts[0]);
    if (!header || header.alg !== "RS256" || typeof header.kid !== "string") return { ok: false, reason: "alg" };
    const key = await getKey(header.kid);
    if (!key) return { ok: false, reason: "kid" };
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5", key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) return { ok: false, reason: "signature" };
    const claims = b64urlJson(parts[1]);
    const nowS = Math.floor(now / 1000);
    if (claims.iss !== `https://${teamDomain}`) return { ok: false, reason: "iss" };
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(audience)) return { ok: false, reason: "aud" };
    if (typeof claims.exp !== "number" || claims.exp < nowS - CLOCK_SKEW_S) return { ok: false, reason: "exp" };
    if (typeof claims.nbf === "number" && claims.nbf > nowS + CLOCK_SKEW_S) return { ok: false, reason: "nbf" };
    if (typeof claims.iat === "number" && claims.iat > nowS + CLOCK_SKEW_S) return { ok: false, reason: "iat" };
    if (typeof claims.email !== "string" || !claims.email) return { ok: false, reason: "email" };
    return { ok: true, email: claims.email.trim().toLowerCase(), claims };
  } catch (_err) {
    return { ok: false, reason: "error" };
  }
}

let certs = { teamDomain: null, keys: new Map(), fetchedAt: 0 };

async function loadCerts(teamDomain) {
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, { cf: { cacheTtl: 300 } });
  if (!res.ok) throw new Error(`certs ${res.status}`);
  const body = await res.json();
  const keys = new Map();
  for (const jwk of (body && body.keys) || []) {
    if (jwk.kty !== "RSA" || typeof jwk.kid !== "string") continue;
    const key = await crypto.subtle.importKey(
      "jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"],
    );
    keys.set(jwk.kid, key);
  }
  certs = { teamDomain, keys, fetchedAt: Date.now() };
}

export async function accessKey(teamDomain, kid) {
  const age = Date.now() - certs.fetchedAt;
  const stale = certs.teamDomain !== teamDomain || age > CERTS_TTL_MS;
  if (stale || (!certs.keys.has(kid) && age > CERTS_MIN_REFETCH_MS)) await loadCerts(teamDomain);
  return certs.keys.get(kid) || null;
}

export function withSecurityHeaders(response) {
  const res = new Response(response.body, response);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
  return res;
}

function deny(status = 403) {
  return withSecurityHeaders(new Response("Forbidden", { status, headers: { "content-type": "text/plain; charset=utf-8" } }));
}

export function createAdminGuard({ getKey = accessKey } = {}) {
  return async function onRequest(context) {
    const cfg = readConfig(context.env);
    if (!cfg) return deny();
    const token = context.request.headers.get("cf-access-jwt-assertion");
    if (!token) return deny();
    let result;
    try {
      result = await verifyAccessJwt(token, { ...cfg, getKey: (kid) => getKey(cfg.teamDomain, kid) });
    } catch (_err) {
      return deny();
    }
    if (!result.ok || !cfg.emails.has(result.email)) return deny();
    context.data.adminEmail = result.email;
    return withSecurityHeaders(await context.next());
  };
}

export const adminGuard = createAdminGuard();
