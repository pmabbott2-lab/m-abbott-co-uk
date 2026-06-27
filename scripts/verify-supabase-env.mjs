#!/usr/bin/env node
/**
 * Verifies Supabase env vars without printing secrets.
 * Usage: node scripts/verify-supabase-env.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv(path) {
  const vars = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

function mask(value) {
  if (!value) return "(missing)";
  if (value.length <= 12) return "***";
  return `${value.slice(0, 12)}… (${value.length} chars)`;
}

async function testKey(url, key, label) {
  if (!url || !key) return { label, ok: false, error: "missing url or key" };
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/auth/v1/health`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (res.status === 401) {
      return { label, ok: false, error: "Invalid API key (401)" };
    }
    return { label, ok: res.ok, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (e) {
    return { label, ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

const envPath = resolve(process.cwd(), ".env");
const env = loadDotEnv(envPath);

const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const pub = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY;
const secret = env.SUPABASE_SERVICE_ROLE_KEY;

console.log("Supabase env check");
console.log("==================");
console.log(`Project URL: ${url || "(missing)"}`);
console.log(`Publishable: ${mask(pub)}`);
console.log(`Service role: ${mask(secret)}`);

const issues = [];
if (!url || !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url)) {
  issues.push("SUPABASE_URL / VITE_SUPABASE_URL must look like https://xxxx.supabase.co");
}
if (url && (url.includes("\n") || url.includes("VITE_"))) {
  issues.push("SUPABASE_URL looks corrupted (unclosed quote in .env?)");
}
if (pub && pub.startsWith("sb_publishable_") && pub.length < 40) {
  issues.push(
    "Publishable key looks truncated — copy the entire sb_publishable_ key from Supabase Dashboard → Settings → API",
  );
}
if (secret && secret.startsWith("sb_secret_") && secret.length < 40) {
  issues.push("Service role key looks truncated — copy the entire sb_secret_ key from the same page");
}

for (const issue of issues) console.log(`! ${issue}`);

const results = await Promise.all([
  testKey(url, pub, "publishable"),
  testKey(url, secret, "service_role"),
]);

for (const r of results) {
  console.log(r.ok ? `✓ ${r.label} key accepted` : `✗ ${r.label}: ${r.error}`);
}

process.exit(results.some((r) => !r.ok) || issues.length ? 1 : 0);
