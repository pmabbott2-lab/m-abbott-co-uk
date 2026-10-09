// Local preview of /admin only (127.0.0.1). Runs the real API handlers against a file-backed
// stand-in for KV in admin-private.local/ (gitignored). Skips the Access check, so never deploy this.
//   node marketing/mortgage-easy-internal/admin-dev/server.mjs   → http://127.0.0.1:8789/admin/
import http from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { withSecurityHeaders } from "../../../functions/_lib/admin-access.js";
import * as assumptions from "../../../functions/api/admin/assumptions.js";
import * as scenarios from "../../../functions/api/admin/scenarios.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const site = join(here, "../../mortgage-hub-website");
const privateDir = join(here, "../admin-private.local");
const kvFile = join(privateDir, "dev-kv.json");
const PORT = Number(process.env.PORT || 8789);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

function fileKv() {
  let data = {};
  if (existsSync(kvFile)) data = JSON.parse(readFileSync(kvFile, "utf8"));
  else if (existsSync(join(privateDir, "defaults.json"))) {
    data = { assumptions: { value: readFileSync(join(privateDir, "defaults.json"), "utf8"), metadata: null } };
  }
  const persist = () => writeFile(kvFile, JSON.stringify(data, null, 2));
  return {
    async get(key, type) {
      const hit = data[key];
      if (!hit) return null;
      return type === "json" ? JSON.parse(hit.value) : hit.value;
    },
    async put(key, value, opts) { data[key] = { value: String(value), metadata: (opts && opts.metadata) || null }; await persist(); },
    async delete(key) { delete data[key]; await persist(); },
    async list({ prefix = "" } = {}) {
      return { keys: Object.keys(data).filter((k) => k.startsWith(prefix)).map((name) => ({ name, metadata: data[name].metadata })), list_complete: true };
    },
  };
}

const env = { ADMIN_KV: fileKv() };
const handlers = { "/api/admin/assumptions": assumptions, "/api/admin/scenarios": scenarios };

async function serveStatic(pathname) {
  let rel;
  if (pathname.startsWith("/admin/") || pathname.startsWith("/assets/")) rel = pathname.slice(1) + (pathname.endsWith("/") ? "index.html" : "");
  else return new Response("Not found", { status: 404 });
  const full = normalize(join(site, rel));
  if (!full.startsWith(site) || !existsSync(full)) return new Response("Not found", { status: 404 });
  return new Response(await readFile(full), { headers: { "content-type": TYPES[extname(full)] || "application/octet-stream" } });
}

async function handle(req) {
  const url = new URL(req.url);
  if (url.pathname === "/admin" || url.pathname === "/admin/owner") return Response.redirect(`${url.origin}${url.pathname}/`, 308);
  const mod = handlers[url.pathname];
  if (mod) {
    const fn = mod[`onRequest${req.method[0]}${req.method.slice(1).toLowerCase()}`];
    if (!fn) return new Response("Method not allowed", { status: 405 });
    return withSecurityHeaders(await fn({ request: req, env, data: { adminEmail: "local-preview@localhost" } }));
  }
  const res = await serveStatic(url.pathname);
  return url.pathname.startsWith("/admin") ? withSecurityHeaders(res) : res;
}

http.createServer(async (nodeReq, nodeRes) => {
  try {
    const chunks = [];
    for await (const c of nodeReq) chunks.push(c);
    const headers = new Headers();
    for (const [k, v] of Object.entries(nodeReq.headers)) if (typeof v === "string") headers.set(k, v);
    const body = chunks.length && !["GET", "HEAD"].includes(nodeReq.method) ? Buffer.concat(chunks) : undefined;
    const res = await handle(new Request(`http://127.0.0.1:${PORT}${nodeReq.url}`, { method: nodeReq.method, headers, body }));
    nodeRes.writeHead(res.status, Object.fromEntries(res.headers));
    nodeRes.end(Buffer.from(await res.arrayBuffer()));
  } catch (err) {
    nodeRes.writeHead(500, { "content-type": "text/plain" });
    nodeRes.end(String(err && err.message));
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Admin preview: http://127.0.0.1:${PORT}/admin/`));
