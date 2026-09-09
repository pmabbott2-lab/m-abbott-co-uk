/**
 * Single public port for ngrok: Hub app + MortgageEasy marketing under /mortgageeasy/
 * Usage: node scripts/mortgage-demo-proxy.mjs
 */
import http from "node:http";
import { request as httpRequest } from "node:http";

const PROXY_PORT = Number(process.env.DEMO_PROXY_PORT || 8090);
const HUB = process.env.HUB_INTERNAL_URL || "http://127.0.0.1:8080";
const MOCKUP = process.env.MOCKUP_INTERNAL_URL || "http://127.0.0.1:8081";
const PREFIX = "/mortgageeasy";

/** Hub routes that must never be served from the static marketing site. */
function isHubAppPath(pathname) {
  return (
    pathname === "/auth" ||
    pathname.startsWith("/auth/") ||
    pathname === "/home" ||
    pathname.startsWith("/home/") ||
    pathname === "/register" ||
    pathname.startsWith("/register/") ||
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname.startsWith("/diary") ||
    pathname.startsWith("/cases") ||
    pathname.startsWith("/booking") ||
    pathname.startsWith("/introducer") ||
    pathname.startsWith("/interview") ||
    pathname.startsWith("/chat") ||
    pathname.startsWith("/sessions") ||
    pathname.startsWith("/customers") ||
    pathname.startsWith("/raf") ||
    pathname.startsWith("/go") ||
    pathname.startsWith("/book") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/_serverFn")
  );
}

/** Hashed build assets can be cached; HTML/shell must not, or phones keep stale chunk URLs after rebuilds. */
function shouldBypassCache(pathname, contentType) {
  const ct = String(contentType || "").toLowerCase();
  if (ct.includes("text/html")) return true;
  if (pathname.startsWith("/_serverFn")) return true;
  if (pathname.startsWith("/assets/")) return false;
  return !/\.[a-z0-9]+$/i.test(pathname) || pathname.endsWith(".html");
}

function proxy(targetBase, req, res, rewritePath, locationPrefix = "") {
  const url = new URL(req.url || "/", "http://localhost");
  const path = rewritePath ?? url.pathname;
  const qs = url.search || "";
  const target = new URL(path + qs, targetBase);

  const headers = { ...req.headers, host: target.host };
  const upstream = httpRequest(
    target,
    { method: req.method, headers },
    (proxyRes) => {
      const status = proxyRes.statusCode ?? 502;
      const outHeaders = { ...proxyRes.headers };
      if (locationPrefix && status >= 300 && status < 400 && outHeaders.location) {
        const loc = String(outHeaders.location);
        if (!loc.startsWith("http") && !loc.startsWith(locationPrefix)) {
          outHeaders.location =
            locationPrefix + (loc.startsWith("/") ? loc : `/${loc}`);
        }
      }
      if (shouldBypassCache(path, outHeaders["content-type"])) {
        outHeaders["cache-control"] = "no-store, no-cache, must-revalidate";
        outHeaders.pragma = "no-cache";
        delete outHeaders.etag;
        delete outHeaders["last-modified"];
      }
      res.writeHead(status, outHeaders);
      proxyRes.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(`Upstream unavailable: ${targetBase}`);
    } else {
      res.end();
    }
  });
  req.on("error", () => upstream.destroy());
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname === PREFIX) {
    res.writeHead(302, { location: `${PREFIX}/` });
    res.end();
    return;
  }
  if (url.pathname.startsWith(PREFIX + "/") || url.pathname === PREFIX) {
    const stripped = url.pathname.slice(PREFIX.length) || "/";
    if (isHubAppPath(stripped)) {
      proxy(HUB, req, res, stripped);
      return;
    }
    proxy(MOCKUP, req, res, stripped, PREFIX);
    return;
  }
  if (url.pathname === "/dashboard" || url.pathname.startsWith("/dashboard/")) {
    res.writeHead(302, { location: "/home" + url.search });
    res.end();
    return;
  }
  proxy(HUB, req, res);
});

server.on("error", (err) => {
  console.error("Demo proxy error:", err);
  process.exit(1);
});

server.listen(PROXY_PORT, "127.0.0.1", () => {
  console.log(`Demo proxy listening on http://127.0.0.1:${PROXY_PORT}`);
  console.log(`  Hub:       ${HUB}`);
  console.log(`  Marketing: ${MOCKUP} at ${PREFIX}/`);
});
