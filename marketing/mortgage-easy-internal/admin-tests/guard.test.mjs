import test from "node:test";
import assert from "node:assert/strict";
import { createAdminGuard, verifyAccessJwt, readConfig } from "../../../functions/_lib/admin-access.js";
import * as assumptions from "../../../functions/api/admin/assumptions.js";
import * as scenarios from "../../../functions/api/admin/scenarios.js";
import { memoryKv } from "./memory-kv.mjs";

const TEAM = "example-team.cloudflareaccess.com";
const AUD = "admin-aud-tag";
const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_ADMIN_AUD: AUD, ADMIN_EMAILS: "owner@example.com" };
const ORIGIN = "https://mortgageeasy.example";

const algo = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
const good = await crypto.subtle.generateKey(algo, true, ["sign", "verify"]);
const other = await crypto.subtle.generateKey(algo, true, ["sign", "verify"]);

const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
const enc = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

async function sign(claims, { key = good.privateKey, header = { alg: "RS256", kid: "k1" } } = {}) {
  const input = `${enc(header)}.${enc(claims)}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

const nowS = () => Math.floor(Date.now() / 1000);
const claims = (over = {}) => ({ iss: `https://${TEAM}`, aud: [AUD], email: "owner@example.com", iat: nowS(), exp: nowS() + 600, ...over });
const getKey = async (_team, kid) => (kid === "k1" ? good.publicKey : null);
const guard = createAdminGuard({ getKey });

async function call(token, { cfgEnv = env, path = "/admin/" } = {}) {
  const headers = new Headers();
  if (token) headers.set("cf-access-jwt-assertion", token);
  let reached = false;
  const ctx = {
    request: new Request(ORIGIN + path, { headers }),
    env: cfgEnv,
    data: {},
    next: async () => {
      reached = true;
      return new Response("secret page", { headers: { "cache-control": "public, max-age=3600" } });
    },
  };
  const res = await guard(ctx);
  return { res, reached, ctx };
}

test("valid owner token passes and gets no-store/noindex/CSP headers", async () => {
  const { res, reached, ctx } = await call(await sign(claims()));
  assert.equal(res.status, 200);
  assert.ok(reached);
  assert.equal(ctx.data.adminEmail, "owner@example.com");
  assert.match(res.headers.get("cache-control"), /no-store/);
  assert.match(res.headers.get("x-robots-tag"), /noindex/);
  assert.match(res.headers.get("content-security-policy"), /frame-ancestors 'none'/);
});

const refusals = {
  "no token": async () => null,
  "garbage token": async () => "not.a.jwt",
  "alg none": async () => `${enc({ alg: "none", kid: "k1" })}.${enc(claims())}.`,
  "HS256 header": async () => sign(claims(), { header: { alg: "HS256", kid: "k1" } }),
  "signed with another key": async () => sign(claims(), { key: other.privateKey }),
  "unknown kid": async () => sign(claims(), { header: { alg: "RS256", kid: "k2" } }),
  "expired": async () => sign(claims({ exp: nowS() - 3600 })),
  "not yet valid": async () => sign(claims({ nbf: nowS() + 3600 })),
  "wrong audience (site gate app)": async () => sign(claims({ aud: ["site-gate-aud"] })),
  "wrong issuer": async () => sign(claims({ iss: "https://evil.cloudflareaccess.com" })),
  "allowed on site but not admin": async () => sign(claims({ email: "financialpromotions@example.com" })),
  "no email": async () => sign(claims({ email: undefined })),
  "tampered payload": async () => {
    const [h, , s] = (await sign(claims({ email: "someone@example.com" }))).split(".");
    return `${h}.${enc(claims())}.${s}`;
  },
};

for (const [name, make] of Object.entries(refusals)) {
  test(`refused: ${name}`, async () => {
    const { res, reached } = await call(await make());
    assert.equal(res.status, 403);
    assert.equal(reached, false);
    assert.match(res.headers.get("cache-control"), /no-store/);
  });
}

test("fails closed when configuration is missing or invalid", async () => {
  const token = await sign(claims());
  for (const bad of [{}, { ...env, ACCESS_ADMIN_AUD: "" }, { ...env, ADMIN_EMAILS: " , " }, { ...env, ACCESS_TEAM_DOMAIN: "evil.example.com" }]) {
    const { res, reached } = await call(token, { cfgEnv: bad });
    assert.equal(res.status, 403);
    assert.equal(reached, false);
  }
  assert.equal(readConfig({ ...env, ACCESS_TEAM_DOMAIN: `https://${TEAM}/` }).teamDomain, TEAM);
});

test("verifier rejects oversized tokens", async () => {
  const r = await verifyAccessJwt("a".repeat(9000), { teamDomain: TEAM, audience: AUD, getKey });
  assert.equal(r.ok, false);
});

const put = (path, body, origin = ORIGIN) =>
  new Request(ORIGIN + path, { method: "PUT", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });

test("storage API: 503 without KV, refuses cross-origin writes, validates input", async () => {
  const data = { adminEmail: "owner@example.com" };
  assert.equal((await assumptions.onRequestGet({ env: {}, data })).status, 503);
  const kv = memoryKv();
  const e = { ADMIN_KV: kv };
  assert.equal((await assumptions.onRequestPut({ request: put("/api/admin/assumptions", { rates: {} }, "https://evil.example"), env: e, data })).status, 403);
  assert.equal((await assumptions.onRequestPut({ request: put("/api/admin/assumptions", { rates: { adviserMortgagePct: 500 } }), env: e, data })).status, 400);
  const ok = await assumptions.onRequestPut({ request: put("/api/admin/assumptions", { rates: { adviserMortgagePct: 40 } }), env: e, data });
  assert.equal(ok.status, 200);
  const got = await (await assumptions.onRequestGet({ env: e, data })).json();
  assert.equal(got.assumptions.rates.adviserMortgagePct, 40);
  assert.equal(got.assumptions.updatedBy, "owner@example.com");
});

test("storage API: plans round trip", async () => {
  const data = { adminEmail: "owner@example.com" };
  const e = { ADMIN_KV: memoryKv() };
  const saved = await (await scenarios.onRequestPut({ request: put("/api/admin/scenarios", { plan: { name: "Adviser A" } }), env: e, data })).json();
  assert.ok(saved.ok);
  const list = await (await scenarios.onRequestGet({ request: new Request(ORIGIN + "/api/admin/scenarios"), env: e })).json();
  assert.equal(list.plans[0].name, "Adviser A");
  const one = await scenarios.onRequestGet({ request: new Request(`${ORIGIN}/api/admin/scenarios?id=${saved.plan.id}`), env: e });
  assert.equal(one.status, 200);
  assert.equal((await scenarios.onRequestGet({ request: new Request(`${ORIGIN}/api/admin/scenarios?id=../x`), env: e })).status, 404);
  const delCross = new Request(`${ORIGIN}/api/admin/scenarios?id=${saved.plan.id}`, { method: "DELETE", headers: { origin: "https://evil.example" } });
  assert.equal((await scenarios.onRequestDelete({ request: delCross, env: e })).status, 403);
  const del = new Request(`${ORIGIN}/api/admin/scenarios?id=${saved.plan.id}`, { method: "DELETE", headers: { origin: ORIGIN } });
  assert.equal((await scenarios.onRequestDelete({ request: del, env: e })).status, 200);
  assert.equal(e.ADMIN_KV.store.size, 0);
});
