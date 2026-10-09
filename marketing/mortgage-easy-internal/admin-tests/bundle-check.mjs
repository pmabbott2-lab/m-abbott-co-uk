// Runs the built Pages Functions bundle (the code Cloudflare deploys) in Node with a fake static
// asset server, and checks every admin path fails closed without a valid Access token.
//   npx wrangler pages functions build functions --outdir /tmp/me-fnbuild
//   node marketing/mortgage-easy-internal/admin-tests/bundle-check.mjs /tmp/me-fnbuild/index.js
import { pathToFileURL } from "node:url";
import { memoryKv } from "./memory-kv.mjs";

const bundle = process.argv[2];
if (!bundle) throw new Error("Pass the path to the built index.js");
const worker = (await import(pathToFileURL(bundle).href)).default;

const env = {
  ACCESS_TEAM_DOMAIN: "example-team.cloudflareaccess.com",
  ACCESS_ADMIN_AUD: "admin-aud",
  ADMIN_EMAILS: "owner@example.com",
  ADMIN_KV: memoryKv({ assumptions: { rates: { secret: true } } }),
  ASSETS: { fetch: async (req) => new Response(`STATIC ${new URL(req.url).pathname}`, { status: 200 }) },
};
const ctx = { waitUntil() {}, passThroughOnException() {} };

const forged = [
  Buffer.from(JSON.stringify({ alg: "none", kid: "x" })).toString("base64url"),
  Buffer.from(JSON.stringify({ iss: "https://example-team.cloudflareaccess.com", aud: ["admin-aud"], email: "owner@example.com", exp: 9999999999 })).toString("base64url"),
  "",
].join(".");

const adminPaths = [
  "/admin", "/admin/", "/admin/index.html", "/admin/app.js", "/admin/model.js", "/admin/admin.css", "/admin/ui.js", "/admin/introducer.js",
  "/admin/owner", "/admin/owner/", "/admin/owner/index.html", "/admin/owner/owner.js", "/Admin/Owner/",
  "/api/admin/assumptions", "/api/admin/scenarios", "/api/admin/scenarios?all=1", "/api/admin/anything",
];
let failures = 0;
const check = (ok, msg) => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };

for (const path of adminPaths) {
  for (const [label, headers] of [["no token", {}], ["forged token", { "cf-access-jwt-assertion": forged }]]) {
    const res = await worker.fetch(new Request(`https://mortgageeasy.uk${path}`, { headers }), env, ctx);
    const body = await res.text();
    check(res.status === 403 && !body.includes("STATIC") && !body.includes("secret"), `${path} (${label}) → ${res.status}`);
  }
  const put = await worker.fetch(new Request(`https://mortgageeasy.uk${path}`, { method: "PUT", headers: { "content-type": "application/json", origin: "https://mortgageeasy.uk" }, body: "{}" }), env, ctx);
  check(put.status === 403, `${path} (PUT, no token) → ${put.status}`);
}

for (const path of ["/", "/index.html", "/calculator.html", "/styles.css", "/_lib/admin-access", "/_lib/admin-access.js"]) {
  const res = await worker.fetch(new Request(`https://mortgageeasy.uk${path}`), env, ctx);
  const body = await res.text();
  check(res.status === 200 && body === `STATIC ${path}`, `${path} → public static file, untouched`);
}

for (const path of ["/ADMIN/", "/Admin/app.js", "//admin/", "/%61dmin/", "/api/ADMIN/assumptions", "/API/admin/scenarios"]) {
  const res = await worker.fetch(new Request(`https://mortgageeasy.uk${path}`), env, ctx);
  const body = await res.text();
  check(!body.includes("secret"), `${path} → ${res.status} ${body.slice(0, 40)} (no admin data)`);
}

console.log(failures ? `\n${failures} FAILED` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
